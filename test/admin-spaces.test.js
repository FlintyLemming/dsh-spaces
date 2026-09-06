import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie } from './helpers.js'
import { getDb } from '../src/store/db.js'

let app
beforeEach(async () => {
  app = await makeAdminApp()
  const db = getDb()
  const now = Date.now()
  db.prepare("INSERT INTO spaces (id, slug, name, kind, owner_id, created_at) VALUES (1,'team-x','Team X','team',1,?)").run(now)
  db.prepare("INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (1,1,'owner',?),(1,2,'member',?)").run(now, now)
  db.prepare("INSERT INTO instances (id, space_id, user_id, container_name, status, created_at) VALUES (1,1,2,'dsh-team-x-user','running',?)").run(now)
})

test('GET /api/admin/spaces lists with aggregates', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/spaces', headers: adminCookie })
  const space = res.json().spaces[0]
  assert.equal(space.member_count, 2)
  assert.equal(space.running_count, 1)
})

test('GET /api/admin/spaces/:slug returns detail', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/spaces/team-x', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().members.length, 2)
  assert.equal(res.json().instances[0].container_name, 'dsh-team-x-user')
})

test('GET /api/admin/spaces/:slug 404s for an unknown slug', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/spaces/nope', headers: adminCookie })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'SPACE_NOT_FOUND')
})

test('PUT quota sets overrides and null resets to platform default', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/spaces/team-x/quota', headers: adminCookie,
    payload: { quotaCpu: 8, quotaMemMb: 16384, quotaInstances: 4 },
  })
  assert.equal(res.statusCode, 200)
  let row = getDb().prepare('SELECT * FROM spaces WHERE id=1').get()
  assert.equal(row.quota_cpu, 8)
  const reset = await app.inject({
    method: 'PUT', url: '/api/admin/spaces/team-x/quota', headers: adminCookie,
    payload: { quotaCpu: null, quotaMemMb: null, quotaInstances: null },
  })
  assert.equal(reset.statusCode, 200)
  row = getDb().prepare('SELECT * FROM spaces WHERE id=1').get()
  assert.equal(row.quota_cpu, null)
  const audit = getDb().prepare("SELECT * FROM audit_log WHERE action='admin.space_quota' ORDER BY id DESC").get()
  assert.ok(audit.detail_json.includes('quotaCpu'))
})

test('PUT quota rejects negative values', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/spaces/team-x/quota', headers: adminCookie,
    payload: { quotaCpu: -1 },
  })
  assert.equal(res.statusCode, 400)
})

test('POST instance stop marks the instance stopped', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/admin/spaces/team-x/instances/2/stop', headers: adminCookie,
  })
  assert.equal(res.statusCode, 200)
  assert.equal(getDb().prepare('SELECT status FROM instances WHERE id=1').get().status, 'stopped')
  assert.ok(getDb().prepare("SELECT * FROM audit_log WHERE action='instance.stop'").get())
})

test('DELETE instance removes row and keeps volumes', async () => {
  getDb().prepare("INSERT INTO volumes (space_id, kind, user_id, docker_name) VALUES (1,'private',2,'dshvol-team-x-user')").run()
  const res = await app.inject({
    method: 'DELETE', url: '/api/admin/spaces/team-x/instances/2', headers: adminCookie,
  })
  assert.equal(res.statusCode, 200)
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM instances').get().n, 0)
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM volumes').get().n, 1)
})

test('DELETE instance 404s when the member has no instance', async () => {
  const res = await app.inject({
    method: 'DELETE', url: '/api/admin/spaces/team-x/instances/1', headers: adminCookie,
  })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'INSTANCE_NOT_FOUND')
})

test('DELETE space delegates to cascade', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/spaces/team-x', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM spaces').get().n, 0)
  assert.ok(getDb().prepare("SELECT * FROM audit_log WHERE action='space.delete'").get())
})
