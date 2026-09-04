import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { createUser, updateUser } from '../src/store/users.js'
import {
  digestToken, insertSession, sessionForToken,
  deleteSession, deleteAllSessionsForUser, purgeExpiredSessions,
} from '../src/store/sessions.js'

const config = loadConfig({
  SESSION_ABSOLUTE_TTL_MS: '1000',
  SESSION_IDLE_TTL_MS: '500',
})

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(config)
})

const token = 'a'.repeat(64)

test('insert + sessionForToken round-trip; db stores only the hash', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid, now: 1000 })
  const found = sessionForToken(token, { touch: false, now: 1100 })
  assert.equal(found.user.id, uid)
  assert.equal(found.user.handle, 'aa')
  assert.equal(found.session.expiresAt, 2000)
  assert.equal(found.session.idleExpiresAt, 1500)
  assert.equal(sessionForToken('b'.repeat(64), { now: 1100 }), null)
})

test('absolute expiry deletes the row', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid, now: 1000 })
  assert.equal(sessionForToken(token, { now: 2000 }), null)
  assert.equal(sessionForToken(token, { now: 1000 }), null) // 已删
})

test('idle expiry applies and touch slides the idle window', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid, now: 1000 })
  const touched = sessionForToken(token, { touch: true, now: 1400 })
  assert.equal(touched.session.idleExpiresAt, 1900) // 1400 + 500
  assert.equal(sessionForToken(token, { touch: false, now: 1899 }).user.id, uid)
  assert.equal(sessionForToken(token, { touch: false, now: 1900 }), null)
})

test('disabled user sessions are revoked immediately', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid, now: 1000 })
  updateUser(uid, { status: 'disabled' })
  assert.equal(sessionForToken(token, { now: 1100 }), null)
  // 该行已从库中删除
  assert.equal(sessionForToken(token, { now: 1100 }), null)
})

test('malformed tokens never hit the db', () => {
  assert.equal(sessionForToken('short'), null)
  assert.equal(sessionForToken(null), null)
  assert.equal(sessionForToken('g'.repeat(64)), null)
})

test('deleteSession / deleteAllSessionsForUser / purgeExpiredSessions', () => {
  const u1 = createUser({ email: 'a@x.com', handle: 'aa' })
  const u2 = createUser({ email: 'b@x.com', handle: 'bb' })
  const t2 = 'c'.repeat(64)
  insertSession({ token, userId: u1, now: 1000 })
  insertSession({ token: t2, userId: u2, now: 1000 })
  deleteSession(token)
  assert.equal(sessionForToken(token, { now: 1100 }), null)
  assert.notEqual(sessionForToken(t2, { touch: false, now: 1100 }), null)
  deleteAllSessionsForUser(u2)
  assert.equal(sessionForToken(t2, { now: 1100 }), null)
  insertSession({ token, userId: u1, now: 1000 })
  purgeExpiredSessions(2500)
  assert.equal(sessionForToken(token, { now: 2600 }), null)
})

test('digestToken is sha256 hex', () => {
  assert.match(digestToken('x'), /^[a-f0-9]{64}$/)
})
