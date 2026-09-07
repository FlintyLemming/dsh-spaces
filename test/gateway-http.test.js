import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { setActiveConfig, loadConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'
import { createUser } from '../src/store/users.js'
import { createSpace, addSpaceMember } from '../src/store/spaces.js'
import { upsertInstance, updateInstance } from '../src/store/instances.js'
import { insertSession } from '../src/store/sessions.js'
import { initDocker } from '../src/orchestrator/docker.js'

// fake docker 的方法面对齐 orchestrator containerRunning 的调用面：
// getContainer(name).inspect() → { State: { Running } }。
function fakeDockerRunning() {
  initDocker({
    getContainer: () => ({ inspect: async () => ({ State: { Running: true } }) }),
    listContainers: async () => [],
  })
}

// hijack 之后 fastify inject 的响应要由假 proxy 结束，否则 inject 永远不 resolve。
function fakeProxy() {
  return { web: vi.fn((req, res) => { res.end('proxied') }), ws: vi.fn(), on: vi.fn() }
}

function seed({ role = 'user', status = 'running' } = {}) {
  const uid = createUser({ email: 'a@x.com', handle: 'alice', role })
  const sid = createSpace({ slug: 'team-a', name: 'Team A', kind: 'team', ownerId: uid })
  addSpaceMember({ spaceId: sid, userId: uid, role: 'owner' })
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-team-a-alice' })
  updateInstance(inst.id, { status, port: 18901 })
  insertSession({ token: 'a'.repeat(64), userId: uid })
  return { uid, sid, inst }
}

const AUTH = { cookie: `dsh_session=${'a'.repeat(64)}` }

let config
beforeEach(() => {
  initDb(':memory:')
  config = loadConfig({})
  setActiveConfig(config)
  fakeDockerRunning()
})

test('logged-out request redirects to login with return_to', async () => {
  seed()
  const app = await buildServer({ config, gatewayProxy: fakeProxy() })
  const res = await app.inject({ method: 'GET', url: '/s/team-a/alice/' })
  assert.equal(res.statusCode, 302)
  assert.match(res.headers.location, /^\/login\?return_to=/)
  await app.close()
})

test('non-member gets 404 without existence leak', async () => {
  seed()
  const uid2 = createUser({ email: 'b@x.com', handle: 'bob' })
  insertSession({ token: 'b'.repeat(64), userId: uid2 })
  const app = await buildServer({ config, gatewayProxy: fakeProxy() })
  const res = await app.inject({
    method: 'GET', url: '/s/team-a/alice/',
    headers: { cookie: `dsh_session=${'b'.repeat(64)}` },
  })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'NOT_FOUND')
  await app.close()
})

test('bare root redirects to trailing slash', async () => {
  seed()
  const app = await buildServer({ config, gatewayProxy: fakeProxy() })
  const res = await app.inject({ method: 'GET', url: '/s/team-a/alice', headers: AUTH })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, '/s/team-a/alice/')
  await app.close()
})

test('running instance proxies the full prefixed path and query untouched', async () => {
  seed()
  const proxy = fakeProxy()
  const app = await buildServer({ config, gatewayProxy: proxy })
  const res = await app.inject({ method: 'GET', url: '/s/team-a/alice/api/x?q=1', headers: AUTH })
  assert.equal(res.statusCode, 200) // hijack 后由 fake proxy 结束响应
  assert.equal(proxy.web.mock.calls.length, 1)
  const [rawReq, , opts] = proxy.web.mock.calls[0]
  // 实例以 --base-path 起，只认带前缀的路径
  assert.equal(rawReq.url, '/s/team-a/alice/api/x?q=1')
  assert.equal(opts.target, 'http://127.0.0.1:18901')
  await app.close()
})
