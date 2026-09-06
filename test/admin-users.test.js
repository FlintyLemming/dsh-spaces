import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie, userCookie } from './helpers.js'
import { getDb } from '../src/store/db.js'

let app
beforeEach(async () => { app = await makeAdminApp() })

test('non-admin is rejected from /api/admin', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: userCookie })
  assert.equal(res.statusCode, 403)
})

test('GET /api/admin/users lists with stats', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().users.length, 2)
})

test('disable user kills sessions and writes audit', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/users/2/disable', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(getDb().prepare('SELECT status FROM users WHERE id=2').get().status, 'disabled')
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=2').get().n, 0)
  const audit = getDb().prepare("SELECT * FROM audit_log WHERE action='admin.user_disable'").get()
  assert.equal(audit.actor_id, 1)
  assert.equal(audit.target_id, '2')
})

test('disabled user session is immediately invalid', async () => {
  await app.inject({ method: 'POST', url: '/api/admin/users/2/disable', headers: adminCookie })
  const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: userCookie })
  assert.equal(res.statusCode, 401)
})

test('unknown user id is a 404', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/users/999/disable', headers: adminCookie })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'USER_NOT_FOUND')
})

test('cannot disable or demote yourself', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/users/1/disable', headers: adminCookie })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, 'CANNOT_MODIFY_SELF')
  const role = await app.inject({
    method: 'POST', url: '/api/admin/users/1/role', headers: adminCookie,
    payload: { role: 'user' },
  })
  assert.equal(role.json().error.code, 'CANNOT_MODIFY_SELF')
})

test('promoting then demoting another admin is allowed while admins remain', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/admin/users/2/role', headers: adminCookie,
    payload: { role: 'admin' },
  })
  assert.equal(res.statusCode, 200)
  const back = await app.inject({
    method: 'POST', url: '/api/admin/users/2/role', headers: adminCookie,
    payload: { role: 'user' },
  })
  assert.equal(back.statusCode, 200)
})

test('the last active admin cannot be demoted', async () => {
  await app.inject({ method: 'POST', url: '/api/admin/users/2/role', headers: adminCookie, payload: { role: 'admin' } })
  await app.inject({ method: 'POST', url: '/api/admin/users/2/disable', headers: adminCookie })
  // 现在只剩管理员 1 处于 active：降级任何管理员都必须被拒绝。
  const res = await app.inject({
    method: 'POST', url: '/api/admin/users/2/role', headers: adminCookie,
    payload: { role: 'user' },
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, 'LAST_ADMIN')
})
