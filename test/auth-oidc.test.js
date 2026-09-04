import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'

// openid-client 全部 mock：不触网。
vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({
    serverMetadata: () => ({ issuer: 'https://idp.example.com' }),
  })),
  randomState: () => 'state-123',
  randomNonce: () => 'nonce-123',
  randomPKCECodeVerifier: () => 'verifier-123',
  calculatePKCECodeChallenge: async () => 'challenge-123',
  buildAuthorizationUrl: (_config, params) =>
    new URL(`https://idp.example.com/authorize?state=${params.state}&nonce=${params.nonce}`
      + `&redirect_uri=${encodeURIComponent(params.redirect_uri)}`
      + `&code_challenge=${params.code_challenge}`),
  authorizationCodeGrant: vi.fn(async () => ({
    claims: () => ({ sub: 'sub-1', email: 'new@x.com', email_verified: true, name: 'New User' }),
  })),
}))

import { initDb, getDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'
import { setSetting } from '../src/store/settings.js'
import { getUserByEmail } from '../src/store/users.js'
import { listAudit } from '../src/store/audit.js'
import { SESSION_COOKIE } from '../src/auth/middleware.js'
import * as oidc from 'openid-client'

let app

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development', PLATFORM_ORIGIN: 'http://localhost:8080' }))
  setSetting('oidc_issuer', 'https://idp.example.com')
  setSetting('oidc_client_id', 'dsh-spaces')
  setSetting('oidc_client_secret', 'secret')
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development', PLATFORM_ORIGIN: 'http://localhost:8080' }) })
})

test('login redirects to the IdP with PKCE params and sets txn cookie', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/login?return_to=/spaces' })
  assert.equal(res.statusCode, 302)
  const location = new URL(res.headers.location)
  assert.equal(location.origin, 'https://idp.example.com')
  assert.equal(location.searchParams.get('state'), 'state-123')
  assert.equal(location.searchParams.get('code_challenge'), 'challenge-123')
  assert.equal(location.searchParams.get('redirect_uri'), 'http://localhost:8080/api/auth/callback')
  const txn = res.cookies.find((c) => c.name === 'dsh_oidc_txn')
  assert.ok(txn)
  assert.equal(txn.httpOnly, true)
  const payload = JSON.parse(txn.value)
  assert.equal(payload.returnTo, '/spaces')
  assert.equal(payload.codeVerifier, 'verifier-123')
})

test('login rejects open redirects via return_to', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/login?return_to=//evil.com' })
  const txn = res.cookies.find((c) => c.name === 'dsh_oidc_txn')
  assert.equal(JSON.parse(txn.value).returnTo, '/')
})

test('OIDC not configured returns 503', async () => {
  initDb(':memory:') // 清掉 oidc 设置
  const res = await app.inject({ method: 'GET', url: '/api/auth/login' })
  assert.equal(res.statusCode, 503)
  assert.equal(res.json().error.code, 'OIDC_NOT_CONFIGURED')
})

test('IdP unreachable returns 502', async () => {
  // 换一个 issuer 避开模块级 discovery 缓存
  setSetting('oidc_issuer', 'https://down.example.com')
  vi.mocked(oidc.discovery).mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
  const res = await app.inject({ method: 'GET', url: '/api/auth/login' })
  assert.equal(res.statusCode, 502)
  assert.equal(res.json().error.code, 'OIDC_UNAVAILABLE')
})

test('callback creates user, session, and redirects to return_to', async () => {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login?return_to=/spaces' })
  const txn = login.cookies.find((c) => c.name === 'dsh_oidc_txn')
  const cb = await app.inject({
    method: 'GET',
    url: '/api/auth/callback?code=code-1&state=state-123',
    cookies: { dsh_oidc_txn: txn.value },
  })
  assert.equal(cb.statusCode, 302)
  assert.equal(cb.headers.location, '/spaces')
  const session = cb.cookies.find((c) => c.name === SESSION_COOKIE)
  assert.ok(session && /^[a-f0-9]{64}$/.test(session.value))
  const user = getUserByEmail('new@x.com')
  assert.ok(user)
  assert.equal(user.display_name, 'New User')
  assert.ok(listAudit({ action: 'user.create' }).length === 1)
  assert.ok(listAudit({ action: 'user.login' }).length === 1)
})

test('callback without txn cookie returns 400', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/callback?code=x&state=y' })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, 'OIDC_CALLBACK_INVALID')
})
