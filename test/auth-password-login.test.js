import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { initDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'
import { createUser } from '../src/store/users.js'
import { createIdentity } from '../src/store/identities.js'
import { setSetting } from '../src/store/settings.js'
import { listAudit } from '../src/store/audit.js'
import { SESSION_COOKIE } from '../src/auth/middleware.js'
import { resetPasswordRateLimits as resetLimits } from '../src/auth/password-login.js'

const PASSWORD = 'correct-horse-battery'
let app
let uid

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  resetLimits()
  uid = createUser({
    email: 'root@x.com', handle: 'root',
    passwordHash: bcrypt.hashSync(PASSWORD, 10), role: 'admin',
  })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
})

function login(email, password) {
  return app.inject({
    method: 'POST', url: '/api/auth/password-login',
    payload: { email, password },
    headers: { 'content-type': 'application/json' },
  })
}

test('successful login sets session cookie and writes audit', async () => {
  const res = await login('root@x.com', PASSWORD)
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().user.handle, 'root')
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)
  assert.ok(cookie && /^[a-f0-9]{64}$/.test(cookie.value))
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.sameSite, 'Lax')
  assert.equal(listAudit({ action: 'user.login' })[0].actor_id, uid)
})

test('wrong password / unknown user share the same 401', async () => {
  const wrong = await login('root@x.com', 'nope')
  const unknown = await login('ghost@x.com', 'nope')
  for (const res of [wrong, unknown]) {
    assert.equal(res.statusCode, 401)
    assert.equal(res.json().error.code, 'INVALID_CREDENTIALS')
  }
})

test('user with OIDC identity cannot use password login', async () => {
  createIdentity({ userId: uid, issuer: 'https://idp.example.com', subject: 'sub-1' })
  const res = await login('root@x.com', PASSWORD)
  assert.equal(res.statusCode, 401)
})

test('disabled password_login setting returns 403', async () => {
  setSetting('password_login_enabled', 'false')
  const res = await login('root@x.com', PASSWORD)
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'PASSWORD_LOGIN_UNAVAILABLE')
})

test('five failures in the window trigger 429', async () => {
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await login('root@x.com', 'bad')).statusCode, 401)
  }
  const res = await login('root@x.com', PASSWORD) // 正确密码也被限流
  assert.equal(res.statusCode, 429)
  assert.equal(res.json().error.code, 'RATE_LIMITED')
})
