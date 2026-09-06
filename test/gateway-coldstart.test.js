import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { setActiveConfig, loadConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'
import { createUser } from '../src/store/users.js'
import { createSpace, addSpaceMember } from '../src/store/spaces.js'
import { upsertInstance, updateInstance } from '../src/store/instances.js'
import { insertSession } from '../src/store/sessions.js'
import { setSetting } from '../src/store/settings.js'
import { initDocker } from '../src/orchestrator/docker.js'

const AUTH = { cookie: `dsh_session=${'a'.repeat(64)}` }

// fake docker：容器始终存在；start 后 inspect 报 Running，并记录调用。
// start 故意慢 50ms，让冷启动去重窗口在测试期间保持打开（否则 entry 会
// 在下一个请求到达前就被 finally 清掉，去重/超时分支都测不到）。
function fakeDockerStartable() {
  let running = false
  const calls = { create: [], start: [], stop: [], remove: [] }
  initDocker({
    createContainer: async (opts) => {
      calls.create.push(opts)
      return { id: 'fake', start: async () => { running = true } }
    },
    getContainer: (name) => ({
      inspect: async () => ({ State: { Running: running }, Image: 'sha256:' + '0'.repeat(64) }),
      start: async () => {
        calls.start.push(name)
        await new Promise((r) => setTimeout(r, 50))
        running = true
      },
      stop: async () => { calls.stop.push(name); running = false },
      remove: async () => { calls.remove.push(name); running = false },
    }),
    getVolume: () => ({ inspect: async () => ({}), remove: async () => {} }),
    createVolume: async () => ({}),
    listContainers: async () => [],
    listNetworks: async () => [{ Name: 'dsh-tenants' }],
  })
  return calls
}

function seedStopped({ status = 'stopped' } = {}) {
  const uid = createUser({ email: 'a@x.com', handle: 'alice' })
  const sid = createSpace({ slug: 'team-a', name: 'Team A', kind: 'team', ownerId: uid })
  addSpaceMember({ spaceId: sid, userId: uid, role: 'owner' })
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-team-a-alice' })
  updateInstance(inst.id, { status, port: 18901 })
  insertSession({ token: 'a'.repeat(64), userId: uid })
  setSetting('image_digest', 'sha256:' + '0'.repeat(64))
  return { uid, sid, inst }
}

// 健康探测必然失败（18901 无人监听）。超时必须是 0：waitHealthy 在
// deadline 未过时会退避 2s 重试，而 loopback 的 ECONNREFUSED 常在同一毫秒
// 返回——非 0 超时会让后台冷启动握着编排层的生命周期锁跨到下一个用例。
function testConfig(extra = {}) {
  const config = loadConfig({ INSTANCE_START_TIMEOUT_MS: '0', ...extra })
  setActiveConfig(config)
  return config
}

const noopProxy = () => ({ web: vi.fn(), ws: vi.fn(), on: vi.fn() })

beforeEach(() => {
  initDb(':memory:')
  testConfig()
})

test('stopped instance: 503 waiting page and start triggered', async () => {
  const calls = fakeDockerStartable()
  seedStopped()
  const app = await buildServer({ config: testConfig(), gatewayProxy: noopProxy() })
  const res = await app.inject({ method: 'GET', url: '/s/team-a/alice/', headers: AUTH })
  assert.equal(res.statusCode, 503)
  assert.match(res.headers['content-type'], /text\/html/)
  assert.match(res.body, /实例启动中/)
  // 后台启动已触发
  await new Promise((r) => setTimeout(r, 100))
  assert.ok(calls.start.length + calls.create.length > 0)
  await app.close()
})

test('duplicate concurrent requests converge to one start', async () => {
  const calls = fakeDockerStartable()
  seedStopped()
  const app = await buildServer({ config: testConfig(), gatewayProxy: noopProxy() })
  const [r1, r2] = await Promise.all([
    app.inject({ method: 'GET', url: '/s/team-a/alice/', headers: AUTH }),
    app.inject({ method: 'GET', url: '/s/team-a/alice/', headers: AUTH }),
  ])
  assert.equal(r1.statusCode, 503)
  assert.equal(r2.statusCode, 503)
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(calls.create.length <= 1, true)
  assert.equal(calls.start.length, 1)
  await app.close()
})

test('error instance: 502 rebuild page and rebuild triggered', async () => {
  const calls = fakeDockerStartable()
  seedStopped({ status: 'error' })
  const app = await buildServer({ config: testConfig(), gatewayProxy: noopProxy() })
  const res = await app.inject({ method: 'GET', url: '/s/team-a/alice/', headers: AUTH })
  assert.equal(res.statusCode, 502)
  assert.match(res.body, /重建/)
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(calls.remove.length, 1) // 重建先删容器（保留卷）
  await app.close()
})

test('json request after coldStartTimeoutMs gets 504', async () => {
  fakeDockerStartable()
  seedStopped()
  const config = testConfig({ COLD_START_TIMEOUT_MS: '1' }) // 立即超时
  const app = await buildServer({ config, gatewayProxy: noopProxy() })
  await app.inject({ method: 'GET', url: '/s/team-a/alice/', headers: AUTH }) // 建立 entry
  await new Promise((r) => setTimeout(r, 5))
  const res = await app.inject({
    method: 'GET', url: '/s/team-a/alice/',
    headers: { ...AUTH, accept: 'application/json' },
  })
  assert.equal(res.statusCode, 504)
  assert.equal(res.json().error.code, 'COLD_START_TIMEOUT')
  await app.close()
})

test('browser navigation past the timeout still gets the waiting page', async () => {
  fakeDockerStartable()
  seedStopped()
  const config = testConfig({ COLD_START_TIMEOUT_MS: '1' })
  const app = await buildServer({ config, gatewayProxy: noopProxy() })
  await app.inject({ method: 'GET', url: '/s/team-a/alice/', headers: AUTH })
  await new Promise((r) => setTimeout(r, 5))
  const res = await app.inject({
    method: 'GET', url: '/s/team-a/alice/',
    headers: { ...AUTH, accept: 'text/html' },
  })
  assert.equal(res.statusCode, 503)
  assert.match(res.body, /超时/)
  await app.close()
})
