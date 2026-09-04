import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { buildServer, apiError } from '../src/server.js'
import { createUser, updateUser } from '../src/store/users.js'
import { insertSession } from '../src/store/sessions.js'
import { requireUser, requireAdmin, SESSION_COOKIE } from '../src/auth/middleware.js'

const token = 'a'.repeat(64)
let app
let uid

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
  app.get('/api/_protected', { preHandler: requireUser }, async (req) => ({ handle: req.user.handle }))
  app.get('/api/_admin', { preHandler: requireAdmin }, async () => ({ ok: true }))
})

test('me/logout round-trip', async () => {
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(me.statusCode, 200)
  assert.deepEqual(me.json().user, { id: uid, email: 'a@x.com', handle: 'aa', displayName: '', role: 'user' })

  const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(out.statusCode, 200)
  const me2 = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(me2.statusCode, 401)
})

test('requireUser rejects anonymous and disabled users', async () => {
  const anon = await app.inject({ method: 'GET', url: '/api/_protected' })
  assert.equal(anon.statusCode, 401)
  assert.equal(anon.json().error.code, 'UNAUTHENTICATED')

  const ok = await app.inject({ method: 'GET', url: '/api/_protected', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().handle, 'aa')

  updateUser(uid, { status: 'disabled' })
  const disabled = await app.inject({ method: 'GET', url: '/api/_protected', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(disabled.statusCode, 401)
})

test('requireAdmin rejects non-admin with 403', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/_admin', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'FORBIDDEN')
  updateUser(uid, { role: 'admin' })
  const ok = await app.inject({ method: 'GET', url: '/api/_admin', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(ok.statusCode, 200)
})

test('logout clears the cookie', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { [SESSION_COOKIE]: token } })
  const cleared = res.cookies.find((c) => c.name === SESSION_COOKIE)
  assert.ok(cleared)
  assert.equal(cleared.value, '')
})
