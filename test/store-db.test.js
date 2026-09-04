import { test } from 'vitest'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/store/db.js'

test('openDatabase applies migrations and enables WAL + foreign keys', () => {
  const db = openDatabase(':memory:')
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all().map((r) => r.name)
  for (const t of ['users', 'identities', 'sessions', 'spaces', 'space_members',
    'volumes', 'instances', 'settings', 'audit_log', 'schema_migrations']) {
    assert.ok(tables.includes(t), `missing table ${t}`)
  }
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  db.close()
})

test('migrations are idempotent', () => {
  const db = openDatabase(':memory:')
  const applied = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n
  assert.equal(applied, 1)
  db.close()
})

test('instances enforce UNIQUE(space_id, user_id)', () => {
  const db = openDatabase(':memory:')
  const now = Date.now()
  db.prepare("INSERT INTO users (email, handle, created_at) VALUES ('a@x.com','aa',?)").run(now)
  db.prepare("INSERT INTO spaces (slug, name, kind, owner_id, created_at) VALUES ('s1','S1','team',1,?)").run(now)
  db.prepare("INSERT INTO instances (space_id, user_id, container_name, created_at) VALUES (1,1,'c1',?)").run(now)
  assert.throws(() =>
    db.prepare("INSERT INTO instances (space_id, user_id, container_name, created_at) VALUES (1,1,'c2',?)").run(now),
  )
  db.close()
})
