import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'

const seq = []
vi.mock('../src/orchestrator/index.js', () => ({
  ensureVolume: vi.fn(async () => {}),
  prepareSharedVolume: vi.fn(async () => {}),
  stopInstance: vi.fn(async (id) => { seq.push(`stop:${id}`) }),
  removeContainerKeepVolumes: vi.fn(async (name) => { seq.push(`rmc:${name}`) }),
  removeVolume: vi.fn(async (name) => { seq.push(`rmv:${name}`) }),
}))

import { initDb } from '../src/store/db.js'
import { createUser } from '../src/store/users.js'
import { insertSession } from '../src/store/sessions.js'
import { getSpaceBySlug, getSpaceMember } from '../src/store/spaces.js'
import { listVolumesForSpace } from '../src/store/volumes.js'
import { upsertInstance, getInstance } from '../src/store/instances.js'
import { buildServer } from '../src/server.js'
import { loadConfig, setActiveConfig } from '../src/config.js'

const OWNER_TOKEN = 'a'.repeat(64)
let app, ownerId, memberId, space

beforeEach(async () => {
  seq.length = 0
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  ownerId = createUser({ email: 'o@x.com', handle: 'oo', displayName: 'O' })
  memberId = createUser({ email: 'm@x.com', handle: 'mm', displayName: 'M' })
  insertSession({ token: OWNER_TOKEN, userId: ownerId })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
  await app.inject({
    method: 'POST', url: '/api/spaces',
    headers: { cookie: `dsh_session=${OWNER_TOKEN}`, 'content-type': 'application/json' },
    payload: { name: 'Team' },
  })
  await app.inject({
    method: 'POST', url: '/api/spaces/team/members',
    headers: { cookie: `dsh_session=${OWNER_TOKEN}`, 'content-type': 'application/json' },
    payload: { email: 'm@x.com' },
  })
  space = getSpaceBySlug('team')
  upsertInstance({ spaceId: space.id, userId: memberId, containerName: 'dsh-team-mm' })
})

test('removing a member cascades in order and deletes rows', async () => {
  const instId = getInstance(space.id, memberId).id
  const res = await app.inject({
    method: 'DELETE', url: `/api/spaces/team/members/${memberId}`,
    headers: { cookie: `dsh_session=${OWNER_TOKEN}` },
  })
  assert.equal(res.statusCode, 204)
  assert.deepEqual(seq, [
    `stop:${instId}`,
    'rmc:dsh-team-mm',
    'rmv:dshvol-team-mm',
  ])
  assert.equal(getSpaceMember(space.id, memberId), null)
  assert.equal(getInstance(space.id, memberId), null)
  assert.ok(!listVolumesForSpace(space.id).some((v) => v.docker_name === 'dshvol-team-mm'))
})

test('cannot remove the owner', async () => {
  const res = await app.inject({
    method: 'DELETE', url: `/api/spaces/team/members/${ownerId}`,
    headers: { cookie: `dsh_session=${OWNER_TOKEN}` },
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, 'CANNOT_REMOVE_OWNER')
})

test('removing a non-member returns 404', async () => {
  const ghost = createUser({ email: 'g@x.com', handle: 'gg', displayName: 'G' })
  const res = await app.inject({
    method: 'DELETE', url: `/api/spaces/team/members/${ghost}`,
    headers: { cookie: `dsh_session=${OWNER_TOKEN}` },
  })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'MEMBER_NOT_FOUND')
})

test('member without instance or volume still gets removed', async () => {
  const bare = createUser({ email: 'b@x.com', handle: 'bb', displayName: 'B' })
  await app.inject({
    method: 'POST', url: '/api/spaces/team/members',
    headers: { cookie: `dsh_session=${OWNER_TOKEN}`, 'content-type': 'application/json' },
    payload: { email: 'b@x.com' },
  })
  const res = await app.inject({
    method: 'DELETE', url: `/api/spaces/team/members/${bare}`,
    headers: { cookie: `dsh_session=${OWNER_TOKEN}` },
  })
  assert.equal(res.statusCode, 204)
  assert.equal(getSpaceMember(space.id, bare), null)
})
