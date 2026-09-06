import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'

const seq = []
let failVolumes = 0
vi.mock('../src/orchestrator/index.js', () => ({
  ensureVolume: vi.fn(async () => {}),
  prepareSharedVolume: vi.fn(async () => {}),
  stopInstance: vi.fn(async (id) => { seq.push(`stop:${id}`) }),
  removeContainer: vi.fn(async (name) => { seq.push(`rmc:${name}`) }),
  removeContainerKeepVolumes: vi.fn(async (name) => { seq.push(`rmck:${name}`) }),
  removeVolume: vi.fn(async (name) => {
    seq.push(`rmv:${name}`)
    if (failVolumes > 0) { failVolumes--; throw new Error('volume busy') }
  }),
}))

import { initDb, getDb } from '../src/store/db.js'
import { createUser } from '../src/store/users.js'
import { insertSession } from '../src/store/sessions.js'
import { getSpaceBySlug } from '../src/store/spaces.js'
import { upsertInstance, listInstancesForSpace } from '../src/store/instances.js'
import { listAudit } from '../src/store/audit.js'
import { buildServer } from '../src/server.js'
import { loadConfig, setActiveConfig } from '../src/config.js'

const OWNER_TOKEN = 'a'.repeat(64)
const ADMIN_TOKEN = 'c'.repeat(64)
let app, ownerId, space

beforeEach(async () => {
  seq.length = 0
  failVolumes = 0
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  ownerId = createUser({ email: 'o@x.com', handle: 'oo', displayName: 'O' })
  const adminId = createUser({ email: 'a@x.com', handle: 'aa', displayName: 'A', role: 'admin' })
  insertSession({ token: OWNER_TOKEN, userId: ownerId })
  insertSession({ token: ADMIN_TOKEN, userId: adminId })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
  await app.inject({
    method: 'POST', url: '/api/spaces',
    headers: { cookie: `dsh_session=${OWNER_TOKEN}`, 'content-type': 'application/json' },
    payload: { name: 'Team' },
  })
  space = getSpaceBySlug('team')
  upsertInstance({ spaceId: space.id, userId: ownerId, containerName: 'dsh-team-oo' })
})

function del(token, slug = 'team') {
  return app.inject({ method: 'DELETE', url: `/api/spaces/${slug}`, headers: { cookie: `dsh_session=${token}` } })
}

test('owner deletes space: containers, then volumes, then rows', async () => {
  const instId = listInstancesForSpace(space.id)[0].id
  const res = await del(OWNER_TOKEN)
  assert.equal(res.statusCode, 204)
  assert.deepEqual(seq, [
    `stop:${instId}`,
    'rmc:dsh-team-oo',
    'rmv:dshvol-team-oo',
    'rmv:dshvol-team-shared',
  ])
  assert.equal(getSpaceBySlug('team'), null)
})

test('platform admin may delete any team space', async () => {
  const res = await del(ADMIN_TOKEN)
  assert.equal(res.statusCode, 204)
})

test('non-owner non-admin cannot delete the space', async () => {
  const strangerToken = 'd'.repeat(64)
  const strangerId = createUser({ email: 's@x.com', handle: 'ss', displayName: 'S' })
  insertSession({ token: strangerToken, userId: strangerId })
  const res = await del(strangerToken)
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'FORBIDDEN')
  assert.ok(getSpaceBySlug('team'))
})

test('volume failure marks instance error, audits, returns 502', async () => {
  failVolumes = 99 // 所有卷删除都失败（含重试）
  const res = await del(OWNER_TOKEN)
  assert.equal(res.statusCode, 502)
  assert.equal(res.json().error.code, 'SPACE_DELETE_FAILED')
  const inst = listInstancesForSpace(space.id)[0]
  assert.equal(inst.status, 'error')
  assert.ok(inst.error.includes('volume busy'))
  assert.equal(listAudit({ action: 'space.delete_failed' }).length, 1)
  assert.ok(getSpaceBySlug('team')) // 行保留，供排查与重试
})

test('personal space cannot be deleted', async () => {
  getDb().prepare(
    "INSERT INTO spaces (slug, name, kind, owner_id, created_at) VALUES ('p-oo','个人','personal',?,?)",
  ).run(ownerId, Date.now())
  const res = await del(OWNER_TOKEN, 'p-oo')
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, 'PERSONAL_SPACE')
})
