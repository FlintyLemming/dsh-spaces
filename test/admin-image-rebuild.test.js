import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'

// rebuild-all 串行调用真实编排会走健康轮询（分钟级），这里只验证聚合与审计。
vi.mock('../src/orchestrator/index.js', () => ({
  containerNameFor: (slug, handle) => `dsh-${slug}-${handle}`,
  ensureVolume: vi.fn(async () => {}),
  prepareSharedVolume: vi.fn(async () => {}),
  removeVolume: vi.fn(async () => {}),
  stopInstance: vi.fn(async () => {}),
  startInstance: vi.fn(async () => {}),
  removeContainer: vi.fn(async () => {}),
  removeContainerKeepVolumes: vi.fn(async () => {}),
  containerRunning: vi.fn(async () => false),
  rebuildInstance: vi.fn(async (id) => {
    if (id === 2) throw new Error('image pull failed')
  }),
}))

import { makeAdminApp, adminCookie } from './helpers.js'
import { getDb } from '../src/store/db.js'
import { setSetting } from '../src/store/settings.js'

const DIGEST = 'sha256:' + 'c'.repeat(64)

let app
beforeEach(async () => {
  app = await makeAdminApp()
  setSetting('image_digest', DIGEST)
  const db = getDb()
  const now = Date.now()
  db.prepare("INSERT INTO spaces (id, slug, name, kind, owner_id, created_at) VALUES (1,'team-x','Team X','team',1,?)").run(now)
  db.prepare("INSERT INTO instances (id, space_id, user_id, container_name, status, created_at) VALUES (1,1,1,'dsh-team-x-admin','running',?)").run(now)
  db.prepare("INSERT INTO instances (id, space_id, user_id, container_name, status, created_at) VALUES (2,1,2,'dsh-team-x-user','running',?)").run(now)
})

test('rebuild-all reports per-instance results and keeps going after a failure', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/image/rebuild-all', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.total, 2)
  assert.equal(body.ok, 1)
  assert.deepEqual(body.results.map((r) => r.ok), [true, false])
  assert.equal(body.results[0].container, 'dsh-team-x-admin')
  assert.ok(body.results[1].error.includes('image pull failed'))
  const audit = getDb().prepare("SELECT * FROM audit_log WHERE action='admin.image_rebuild_all'").get()
  assert.equal(audit.target_id, DIGEST)
  assert.deepEqual(JSON.parse(audit.detail_json), { total: 2, ok: 1 })
})
