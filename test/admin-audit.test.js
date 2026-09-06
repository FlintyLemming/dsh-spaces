import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie } from './helpers.js'
import { writeAudit } from '../src/store/audit.js'
import { getDb } from '../src/store/db.js'

let app
beforeEach(async () => {
  app = await makeAdminApp()
  writeAudit({ actorId: 1, action: 'admin.settings_update', targetType: 'settings', detail: { changed: ['x'] } })
  writeAudit({ actorId: 2, action: 'user.login', targetType: 'user', targetId: '2', detail: { method: 'oidc' } })
})

test('audit list joins actor email and filters by action', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/audit?action=user.login', headers: adminCookie })
  const entries = res.json().entries
  assert.equal(entries.length, 1)
  assert.equal(entries[0].actor_email, 'user@x.com')
})

test('audit list filters by actorId and caps limit', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/audit?actorId=1&limit=5000', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().entries.length, 1)
  assert.equal(res.json().entries[0].action, 'admin.settings_update')
  const bad = await app.inject({ method: 'GET', url: '/api/admin/audit?since=abc', headers: adminCookie })
  assert.equal(bad.statusCode, 400)
})

test('audit entries for a deleted actor keep a null email', async () => {
  writeAudit({ actorId: 99, action: 'user.logout', targetType: 'user', targetId: '99' })
  const res = await app.inject({ method: 'GET', url: '/api/admin/audit?action=user.logout', headers: adminCookie })
  assert.equal(res.json().entries[0].actor_email, null)
})

test('audit list windows by since/until and pages by offset', async () => {
  const db = getDb()
  db.prepare("UPDATE audit_log SET created_at = 1000 WHERE action = 'admin.settings_update'").run()
  db.prepare("UPDATE audit_log SET created_at = 2000 WHERE action = 'user.login'").run()
  const windowed = await app.inject({ method: 'GET', url: '/api/admin/audit?since=1500&until=2500', headers: adminCookie })
  assert.deepEqual(windowed.json().entries.map((e) => e.action), ['user.login'])
  const paged = await app.inject({ method: 'GET', url: '/api/admin/audit?limit=1&offset=1', headers: adminCookie })
  assert.deepEqual(paged.json().entries.map((e) => e.action), ['admin.settings_update'])
})
