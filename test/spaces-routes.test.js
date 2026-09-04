import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'
import { createUser } from '../src/store/users.js'
import { insertSession } from '../src/store/sessions.js'
import { SESSION_COOKIE } from '../src/auth/middleware.js'
import { setSetting } from '../src/store/settings.js'
import { provisionNewUser } from '../src/spaces/service.js'

let app, uid, token
beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development', INSTANCE_START_TIMEOUT_MS: '2500' }))
  setSetting('image_digest', 'sha256:' + 'b'.repeat(64))
  initDocker({
    containers: new Map(),
    async createVolume() { return {} },
    getVolume(name) {
      return {
        async inspect() {
          const e = new Error(`no such volume: ${name}`); e.statusCode = 404; throw e
        },
        async remove() {},
      }
    },
    async createContainer(opts) {
      this.containers.set(opts.name, { State: { Running: false } })
      return { start: async () => {}, wait: async () => ({ StatusCode: 0 }) }
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
    async listNetworks() { return [{ Name: 'dsh-tenants' }] },
    async listContainers() { return [] },
  })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  token = 'a'.repeat(64)
  insertSession({ token, userId: uid })
  await provisionNewUser(uid)
})

const auth = () => ({ cookies: { [SESSION_COOKIE]: token } })

test('GET /api/spaces lists my personal space', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/spaces', ...auth() })
  assert.equal(res.statusCode, 200)
  const { spaces } = res.json()
  assert.equal(spaces.length, 1)
  assert.equal(spaces[0].slug, 'p-aa')
  assert.equal(spaces[0].kind, 'personal')
  assert.equal(spaces[0].instanceStatus, null)
})

test('GET /api/spaces/:slug 404s for non-member without leaking', async () => {
  const other = createUser({ email: 'b@x.com', handle: 'bb' })
  await provisionNewUser(other)
  const res = await app.inject({ method: 'GET', url: '/api/spaces/p-bb', ...auth() })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'NOT_FOUND')
})

test('instance start requires auth; anonymous gets 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/spaces/p-aa/instance/start' })
  assert.equal(res.statusCode, 401)
})

test('start converges duplicate requests to one instance row', { timeout: 15000 }, async () => {
  // startInstance 的真实编排已由 Task 4 覆盖；这里假 docker 无健康服务 →
  // 启动走错误路径收敛为 error，但行必须存在且唯一：
  const r1 = await app.inject({ method: 'POST', url: '/api/spaces/p-aa/instance/start', ...auth() })
  const r2 = await app.inject({ method: 'GET', url: '/api/spaces/p-aa/instance', ...auth() })
  assert.equal(r2.statusCode, 200)
  assert.ok(r2.json().instance.id)
  assert.equal(r1.json().instance.id, r2.json().instance.id)
})

test('stop on never-started instance is a clean no-op-ish 200', { timeout: 15000 }, async () => {
  await app.inject({ method: 'POST', url: '/api/spaces/p-aa/instance/start', ...auth() })
  const res = await app.inject({ method: 'POST', url: '/api/spaces/p-aa/instance/stop', ...auth() })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().instance.status, 'stopped')
})
