import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'

const orchCalls = []
vi.mock('../src/orchestrator/index.js', () => ({
  ensureVolume: vi.fn(async (name) => { orchCalls.push(`ensure:${name}`) }),
  prepareSharedVolume: vi.fn(async (name) => { orchCalls.push(`setgid:${name}`) }),
}))

import { initDb } from '../src/store/db.js'
import { createUser } from '../src/store/users.js'
import { insertSession } from '../src/store/sessions.js'
import { getSpaceBySlug, listSpaceMembers } from '../src/store/spaces.js'
import { listVolumesForSpace } from '../src/store/volumes.js'
import { buildServer } from '../src/server.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { deriveTeamSlug } from '../src/spaces/team.js'

const TOKEN = 'a'.repeat(64)
let app, userId

beforeEach(async () => {
  orchCalls.length = 0
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  userId = createUser({ email: 'u@x.com', handle: 'uu', displayName: 'U' })
  insertSession({ token: TOKEN, userId })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
})

test('deriveTeamSlug normalizes names', () => {
  assert.equal(deriveTeamSlug('My Team!'), 'my-team')
  assert.equal(deriveTeamSlug('  --Odd  Name-- '), 'odd-name')
  assert.equal(deriveTeamSlug('团队空间'), 'team') // 非 ascii 全部剥离后兜底
})

test('POST /api/spaces creates team space with volumes and owner membership', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/spaces',
    headers: { cookie: `dsh_session=${TOKEN}`, 'content-type': 'application/json' },
    payload: { name: 'Alpha Team' },
  })
  assert.equal(res.statusCode, 201)
  const { space } = res.json()
  assert.equal(space.slug, 'alpha-team')
  assert.equal(space.kind, 'team')
  const members = listSpaceMembers(space.id)
  assert.equal(members.length, 1)
  assert.equal(members[0].role, 'owner')
  const vols = listVolumesForSpace(space.id)
  assert.deepEqual(vols.map((v) => v.docker_name).sort(),
    ['dshvol-alpha-team-shared', 'dshvol-alpha-team-uu'])
  assert.deepEqual(orchCalls, ['ensure:dshvol-alpha-team-shared', 'setgid:dshvol-alpha-team-shared', 'ensure:dshvol-alpha-team-uu'])
})

test('slug collision gets numeric suffix', async () => {
  for (const payload of [{ name: 'Dup' }, { name: 'Dup' }]) {
    const res = await app.inject({
      method: 'POST', url: '/api/spaces',
      headers: { cookie: `dsh_session=${TOKEN}`, 'content-type': 'application/json' },
      payload,
    })
    assert.equal(res.statusCode, 201)
  }
  assert.ok(getSpaceBySlug('dup'))
  assert.ok(getSpaceBySlug('dup-2'))
})

test('POST /api/spaces requires auth and validates body', async () => {
  const anon = await app.inject({
    method: 'POST', url: '/api/spaces',
    headers: { 'content-type': 'application/json' }, payload: { name: 'X' },
  })
  assert.equal(anon.statusCode, 401)
  const bad = await app.inject({
    method: 'POST', url: '/api/spaces',
    headers: { cookie: `dsh_session=${TOKEN}`, 'content-type': 'application/json' },
    payload: { name: '' },
  })
  assert.equal(bad.statusCode, 400)
})
