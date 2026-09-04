import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { createUser, getUserById } from '../src/store/users.js'
import { getIdentityByIssuerSubject, userHasIdentity } from '../src/store/identities.js'
import { listAudit } from '../src/store/audit.js'
import { resolveOidcIdentity } from '../src/auth/identity.js'

const ISSUER = 'https://idp.example.com'

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({}))
})

test('known identity logs in the bound user', () => {
  const uid = createUser({ email: 'other@x.com', handle: 'aa' })
  const first = resolveOidcIdentity({
    issuer: ISSUER,
    claims: { sub: 'sub-1', email: 'a@x.com', email_verified: true },
  })
  assert.equal(first.created, true)
  const again = resolveOidcIdentity({ issuer: ISSUER, claims: { sub: 'sub-1' } })
  assert.deepEqual(again, { userId: first.userId, created: false })
  assert.equal(uid === first.userId, false) // 创建了全新用户
})

test('verified email binds to the existing user', () => {
  const uid = createUser({ email: 'admin@x.com', handle: 'admin' })
  const res = resolveOidcIdentity({
    issuer: ISSUER,
    claims: { sub: 'sub-9', email: 'admin@x.com', email_verified: true, name: 'Admin' },
  })
  assert.deepEqual(res, { userId: uid, created: false })
  assert.equal(getIdentityByIssuerSubject(ISSUER, 'sub-9').user_id, uid)
  assert.ok(listAudit({ action: 'identity.bind' }).length === 1)
})

test('unverified email never binds; a new user is created instead', () => {
  const uid = createUser({ email: 'victim@x.com', handle: 'victim' })
  const res = resolveOidcIdentity({
    issuer: ISSUER,
    claims: { sub: 'attacker', email: 'victim@x.com', email_verified: false },
  })
  assert.equal(res.created, true)
  assert.notEqual(res.userId, uid)
  // attacker 的 synthetic 邮箱不是 victim 的
  assert.notEqual(getUserById(res.userId).email, 'victim@x.com')
  assert.equal(userHasIdentity(uid), false)
})

test('missing email falls back to a synthetic mailbox', () => {
  const res = resolveOidcIdentity({ issuer: ISSUER, claims: { sub: 'sub-42', name: 'No Mail' } })
  const user = getUserById(res.userId)
  assert.match(user.email, /@oidc\.local$/)
  assert.equal(user.display_name, 'No Mail')
})

test('handle collisions get suffixed', () => {
  createUser({ email: 'sam@a.com', handle: 'sam' })
  const res = resolveOidcIdentity({
    issuer: ISSUER,
    claims: { sub: 'sub-7', email: 'sam@b.com', email_verified: true },
  })
  assert.equal(getUserById(res.userId).handle, 'sam-2')
})
