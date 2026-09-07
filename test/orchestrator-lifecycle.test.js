import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { setSetting } from '../src/store/settings.js'
import { createUser } from '../src/store/users.js'
import { createSpace, addSpaceMember } from '../src/store/spaces.js'
import { upsertInstance, getInstanceById, updateInstance } from '../src/store/instances.js'
import {
  effectiveQuota, checkStartQuota, checkInstanceCountQuota, startInstance, stopInstance,
} from '../src/orchestrator/index.js'

// fake docker：容器 start 后 waitHealthy 需要一个真 HTTP 200；
// 用 ephemeral HTTP server 顶替（allocatePort 会避开被占用端口——测试先起 server 再 allocate）。
import http from 'node:http'

let docker
let uid, sid
async function makeInstance() {
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  return inst
}

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development', INSTANCE_START_TIMEOUT_MS: '15000' }))
  setSetting('image_digest', 'sha256:' + 'b'.repeat(64))
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  sid = createSpace({ slug: 'p-aa', name: 'P', kind: 'personal', ownerId: uid })
  addSpaceMember({ spaceId: sid, userId: uid, role: 'owner' })
  docker = {
    containers: new Map(),
    async createContainer(opts) {
      this.containers.set(opts.name, { State: { Running: false }, Image: opts.Image })
      return { id: opts.name }
    },
    getContainer(name) {
      const self = this
      return {
        async inspect() {
          const c = self.containers.get(name)
          if (!c) { const e = new Error(`no such container: ${name}`); e.statusCode = 404; throw e }
          return c
        },
        async start() { self.containers.get(name).State.Running = true },
        async stop() { self.containers.get(name).State.Running = false },
        async remove() { self.containers.delete(name) },
      }
    },
    async createVolume() { return {} },
    getVolume(name) {
      return {
        async inspect() {
          const e = new Error(`no such volume: ${name}`); e.statusCode = 404; throw e
        },
        async remove() {},
      }
    },
    async listNetworks() { return [{ Name: 'dsh-tenants' }] },
  }
  initDocker(docker)
})

test('effectiveQuota falls back to settings defaults; space override wins', () => {
  const space = { quota_cpu: null, quota_mem_mb: null, quota_instances: null }
  assert.deepEqual(effectiveQuota(space), { cpu: 4, memMb: 8192, instances: 8 })
  assert.equal(effectiveQuota({ ...space, quota_cpu: 16 }).cpu, 16)
})

test('checkStartQuota blocks when running sum would exceed', () => {
  // 默认 4 核 / 每实例 2 核 → 第二个并行启动被拒绝
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'c-x' })
  updateInstance(inst.id, { status: 'running' })
  const uid2 = createUser({ email: 'b@x.com', handle: 'bb' })
  addSpaceMember({ spaceId: sid, userId: uid2 })
  const inst2 = upsertInstance({ spaceId: sid, userId: uid2, containerName: 'c-y' })
  updateInstance(inst2.id, { status: 'running' })
  assert.throws(() => checkStartQuota({ id: sid, quota_cpu: null, quota_mem_mb: null }),
    /QUOTA_EXCEEDED|配额/)
})

test('checkInstanceCountQuota blocks beyond limit', () => {
  setSetting('default_quota_instances', '1')
  assert.equal(countRunningSafe(), 0)
  const space = { id: sid, quota_instances: null }
  checkInstanceCountQuota(space) // 0 个实例，通过
  upsertInstance({ spaceId: sid, userId: uid, containerName: 'c-1' })
  assert.throws(() => checkInstanceCountQuota(space), (err) => err.code === 'QUOTA_EXCEEDED')
})
function countRunningSafe() { return 0 }

test('startInstance creates container, waits healthy, marks running', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const inst = await makeInstance()
  // 预占端口，逼 allocatePort 选到我们的健康 server 端口之外——
  // 改为直接给实例指定端口，跳过分配不确定性：
  updateInstance(inst.id, { port })
  const result = await startInstance(inst.id)
  assert.equal(result.status, 'running')
  assert.equal(result.image_digest, 'sha256:' + 'b'.repeat(64))
  assert.ok(docker.containers.get('dsh-p-aa-aa').State.Running)
  srv.close()
})

test('startInstance without image digest fails with IMAGE_NOT_CONFIGURED', async () => {
  setSetting('image_digest', '')
  const inst = await makeInstance()
  await assert.rejects(() => startInstance(inst.id), (err) => err.code === 'IMAGE_NOT_CONFIGURED')
})

test('startInstance marks error when health check times out', { timeout: 15000 }, async () => {
  const inst = await makeInstance()
  // 分配一个端口但不提供服务：找一个空闲端口直接写进实例
  const probe = http.createServer()
  await new Promise((r) => probe.listen(0, '127.0.0.1', r))
  const port = probe.address().port
  probe.close() // 端口空闲、无人服务 → 健康检查必超时
  updateInstance(inst.id, { port })
  setActiveConfig(loadConfig({ INSTANCE_START_TIMEOUT_MS: '2500' }))
  const result = await startInstance(inst.id)
  assert.equal(result.status, 'error')
  assert.match(result.error, /health/i)
})

// 回归：digest 变更走的是「删旧容器保留卷再重建」分支，而 startInstance 已经持有
// 该容器名的生命周期锁——用带锁的 removeContainerKeepVolumes 会自我死锁，请求永远挂住。
test('digest change rebuilds the container instead of deadlocking', { timeout: 10000 }, async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const inst = await makeInstance()
  updateInstance(inst.id, { port: srv.address().port })
  await startInstance(inst.id)
  await stopInstance(inst.id)

  const next = 'sha256:' + 'c'.repeat(64)
  setSetting('image_digest', next)
  const result = await startInstance(inst.id)
  assert.equal(result.status, 'running')
  assert.equal(result.image_digest, next)
  assert.equal(docker.containers.get('dsh-p-aa-aa').Image, next)
  srv.close()
})

test('stopInstance stops container and marks stopped', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const inst = await makeInstance()
  updateInstance(inst.id, { port: srv.address().port })
  await startInstance(inst.id)
  await stopInstance(inst.id)
  assert.equal(getInstanceById(inst.id).status, 'stopped')
  assert.equal(docker.containers.get('dsh-p-aa-aa').State.Running, false)
  srv.close()
})
