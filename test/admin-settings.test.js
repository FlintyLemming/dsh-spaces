import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie } from './helpers.js'
import { getSetting, setSetting } from '../src/store/settings.js'
import { getDb } from '../src/store/db.js'
import { getConfig, setActiveConfig } from '../src/config.js'

let app
beforeEach(async () => {
  app = await makeAdminApp()
  setSetting('oidc_issuer', 'https://idp.example.com')
  setSetting('oidc_client_secret', 'supersecret')
})

test('GET settings masks the OIDC secret', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: adminCookie })
  const s = res.json().settings
  assert.equal(s.oidc_issuer, 'https://idp.example.com')
  assert.equal(s.oidc_client_secret, undefined)
  assert.equal(s.oidc_client_secret_configured, true)
})

test('PUT settings updates provided keys and audits key names only', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { default_quota_cpu: 8, idle_stop_minutes: 30, oidc_client_secret: '' },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(getSetting('default_quota_cpu'), '8')
  assert.equal(getSetting('idle_stop_minutes'), '30')
  assert.equal(getSetting('oidc_client_secret'), 'supersecret') // 空串 = 保持不变
  const audit = getDb().prepare("SELECT * FROM audit_log WHERE action='admin.settings_update'").get()
  assert.ok(audit.detail_json.includes('default_quota_cpu'))
  assert.ok(!audit.detail_json.includes('supersecret'))
})

test('PUT settings stores a new OIDC secret without leaking it to the audit log', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { oidc_client_secret: 'rotated-secret' },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(getSetting('oidc_client_secret'), 'rotated-secret')
  const audit = getDb().prepare("SELECT * FROM audit_log WHERE action='admin.settings_update'").get()
  assert.ok(audit.detail_json.includes('oidc_client_secret'))
  assert.ok(!audit.detail_json.includes('rotated-secret'))
})

test('PUT settings rejects a non-http(s) issuer and bad enum', async () => {
  const bad1 = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { oidc_issuer: 'ftp://idp.example.com' },
  })
  assert.equal(bad1.statusCode, 400)
  const bad2 = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { password_login_enabled: 'maybe' },
  })
  assert.equal(bad2.statusCode, 400)
  const bad3 = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { unknown_key: 'x' },
  })
  assert.equal(bad3.statusCode, 400)
})

test('PUT settings reports only actually changed keys', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { oidc_issuer: 'https://idp.example.com' },
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json().changed, [])
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM audit_log WHERE action='admin.settings_update'").get().n, 0)
})

// 生产必须 https；开发/E2E 放开 http，否则无 TLS 的 mock IdP 配不进来。
test('PUT settings allows an http issuer outside production', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { oidc_issuer: 'http://localhost:19999' },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(getSetting('oidc_issuer'), 'http://localhost:19999')
})

test('PUT settings rejects an http issuer in production', async () => {
  const previous = getConfig()
  setActiveConfig({ ...previous, environment: 'production' })
  try {
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
      payload: { oidc_issuer: 'http://idp.example.com' },
    })
    assert.equal(res.statusCode, 400)
  } finally {
    setActiveConfig(previous)
  }
})
