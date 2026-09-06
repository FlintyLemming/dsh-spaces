import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'

vi.mock('../src/orchestrator/index.js', () => ({
  ensureVolume: vi.fn(async () => {}),
  prepareSharedVolume: vi.fn(async () => {}),
}))

import { initDb } from '../src/store/db.js'
import { createUser } from '../src/store/users.js'
import { insertSession } from '../src/store/sessions.js'
import { getSpaceBySlug, getSpaceMember } from '../src/store/spaces.js'
import { listVolumesForSpace } from '../src/store/volumes.js'
import { buildServer } from '../src/server.js'
import { loadConfig, setActiveConfig } from '../src/config.js'

const OWNER_TOKEN = 'a'.repeat(64)
const OTHER_TOKEN = 'b'.repeat(64)
let app, ownerId, otherId

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  ownerId = createUser({ email: 'o@x.com', handle: 'oo', displayName: 'O' })
  otherId = createUser({ email: 'n@x.com', handle: 'nn', displayName: 'N' })
  insertSession({ token: OWNER_TOKEN, userId: ownerId })
  insertSession({ token: OTHER_TOKEN, userId: otherId })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
  await app.inject({
    method: 'POST', url: '/api/spaces',
    headers: { cookie: `dsh_session=${OWNER_TOKEN}`, 'content-type': 'application/json' },
    payload: { name: 'Team' },
  })
})

function addMember(token, email, slug = 'team') {
  return app.inject({
    method: 'POST', url: `/api/spaces/${slug}/members`,
    headers: { cookie: `dsh_session=${token}`, 'content-type': 'application/json' },
    payload: { email },
  })
}

test('owner adds a registered user by email', async () => {
  const res = await addMember(OWNER_TOKEN, 'n@x.com')
  assert.equal(res.statusCode, 201)
  assert.equal(res.json().member.role, 'member')
  const space = getSpaceBySlug('team')
  assert.ok(getSpaceMember(space.id, otherId))
  assert.ok(listVolumesForSpace(space.id)
    .some((v) => v.docker_name === 'dshvol-team-nn' && v.kind === 'private'))
})

test('inviting an unregistered email returns 404 USER_NOT_REGISTERED', async () => {
  const res = await addMember(OWNER_TOKEN, 'ghost@x.com')
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'USER_NOT_REGISTERED')
})

test('duplicate membership returns 409 ALREADY_MEMBER', async () => {
  await addMember(OWNER_TOKEN, 'n@x.com')
  const res = await addMember(OWNER_TOKEN, 'n@x.com')
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().error.code, 'ALREADY_MEMBER')
})

test('non-owner cannot add members', async () => {
  await addMember(OWNER_TOKEN, 'n@x.com')
  const res = await addMember(OTHER_TOKEN, 'o@x.com')
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'FORBIDDEN')
})

test('unknown space returns 404 SPACE_NOT_FOUND', async () => {
  const res = await addMember(OWNER_TOKEN, 'n@x.com', 'p-oo')
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'SPACE_NOT_FOUND')
})
