import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { getSetting, setSetting } from '../src/store/settings.js'
import { writeAudit, listAudit } from '../src/store/audit.js'

beforeEach(() => { initDb(':memory:') })

test('settings round-trip with fallback', () => {
  assert.equal(getSetting('missing', 'fb'), 'fb')
  setSetting('default_quota_cpu', 4)
  assert.equal(getSetting('default_quota_cpu'), '4')
  setSetting('default_quota_cpu', 8)
  assert.equal(getSetting('default_quota_cpu'), '8')
})

test('audit write and filtered list', () => {
  writeAudit({ actorId: 1, action: 'user.login', targetType: 'user', targetId: '1', detail: { method: 'oidc' } })
  writeAudit({ actorId: 2, action: 'space.create', targetType: 'space', targetId: '9', detail: null })
  assert.equal(listAudit().length, 2)
  const onlyLogin = listAudit({ action: 'user.login' })
  assert.equal(onlyLogin.length, 1)
  assert.equal(JSON.parse(onlyLogin[0].detail_json).method, 'oidc')
  const byActor = listAudit({ actorId: 2 })
  assert.equal(byActor[0].action, 'space.create')
})
