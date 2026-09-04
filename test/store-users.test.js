import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import {
  createUser, getUserById, getUserByEmail, getUserByHandle,
  listUsers, updateUser, deriveUniqueHandle,
} from '../src/store/users.js'
import {
  createIdentity, getIdentityByIssuerSubject, userHasIdentity,
} from '../src/store/identities.js'

beforeEach(() => { initDb(':memory:') })

test('createUser + getters round-trip', () => {
  const id = createUser({ email: 'a@x.com', handle: 'aa', displayName: 'A' })
  assert.equal(getUserById(id).email, 'a@x.com')
  assert.equal(getUserByEmail('a@x.com').handle, 'aa')
  assert.equal(getUserByHandle('aa').id, id)
  assert.equal(getUserByEmail('b@x.com'), null)
})

test('email and handle are unique', () => {
  createUser({ email: 'a@x.com', handle: 'aa' })
  assert.throws(() => createUser({ email: 'a@x.com', handle: 'ab' }))
  assert.throws(() => createUser({ email: 'b@x.com', handle: 'aa' }))
})

test('deriveUniqueHandle sanitizes and suffixes on conflict', () => {
  assert.equal(deriveUniqueHandle('Flinty.Lemming@x.com'), 'flinty-lemming')
  createUser({ email: 'a@x.com', handle: 'flinty-lemming' })
  assert.equal(deriveUniqueHandle('flinty-lemming@y.com'), 'flinty-lemming-2')
  assert.equal(deriveUniqueHandle('@@@'), 'user')
})

test('listUsers omits password_hash and supports search', () => {
  createUser({ email: 'a@x.com', handle: 'aa', passwordHash: 'secret-hash' })
  createUser({ email: 'bob@x.com', handle: 'bob' })
  const all = listUsers()
  assert.equal(all.length, 2)
  assert.ok(!('password_hash' in all[0]))
  assert.deepEqual(listUsers({ search: 'bob' }).map((u) => u.handle), ['bob'])
})

test('updateUser only accepts whitelisted fields', () => {
  const id = createUser({ email: 'a@x.com', handle: 'aa' })
  updateUser(id, { status: 'disabled', role: 'admin' })
  assert.equal(getUserById(id).status, 'disabled')
  assert.equal(getUserById(id).role, 'admin')
  assert.throws(() => updateUser(id, { email: 'evil@x.com' }), /not updatable/)
})

test('identities: create, lookup, userHasIdentity, UNIQUE(issuer,subject)', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  assert.equal(userHasIdentity(uid), false)
  createIdentity({ userId: uid, issuer: 'https://idp.example.com', subject: 'sub-1' })
  assert.equal(userHasIdentity(uid), true)
  assert.equal(getIdentityByIssuerSubject('https://idp.example.com', 'sub-1').user_id, uid)
  assert.equal(getIdentityByIssuerSubject('https://idp.example.com', 'other'), null)
  assert.throws(() =>
    createIdentity({ userId: uid, issuer: 'https://idp.example.com', subject: 'sub-1' }))
})
