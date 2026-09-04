import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { initDb, getDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { getUserByEmail } from '../src/store/users.js'
import { listAudit } from '../src/store/audit.js'
import { ensureAdmin } from '../src/auth/bootstrap.js'

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({}))
})

test('seeds admin from env and is idempotent', () => {
  const config = loadConfig({ ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'a'.repeat(16) })
  assert.equal(ensureAdmin(config), true)
  const admin = getUserByEmail('root@x.com')
  assert.equal(admin.role, 'admin')
  assert.equal(admin.status, 'active')
  assert.ok(bcrypt.compareSync('a'.repeat(16), admin.password_hash))
  assert.equal(ensureAdmin(config), false) // 第二次不再播种
  assert.ok(listAudit({ action: 'user.create' }).length === 1)
})

test('throws when no admin exists and env is missing', () => {
  assert.throws(() => ensureAdmin(loadConfig({})), /ADMIN_EMAIL/)
})

test('throws for short password', () => {
  assert.throws(
    () => ensureAdmin(loadConfig({ ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'short' })),
    /16/,
  )
})
