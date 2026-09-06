import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { createUser } from '../src/store/users.js'
import {
  createSpace, addSpaceMember, getSpaceMember, listSpaceMembers,
  removeSpaceMember, deleteSpace, getSpaceBySlug,
} from '../src/store/spaces.js'
import { createVolume, listVolumesForSpace, deleteVolume } from '../src/store/volumes.js'
import { upsertInstance, listInstancesForSpace, deleteInstance } from '../src/store/instances.js'

let ownerId, memberId
beforeEach(() => {
  initDb(':memory:')
  ownerId = createUser({ email: 'o@x.com', handle: 'owner', displayName: 'O' })
  memberId = createUser({ email: 'm@x.com', handle: 'member', displayName: 'M' })
})

function seedTeamSpace() {
  const spaceId = createSpace({ slug: 'team-a', name: 'Team A', kind: 'team', ownerId })
  addSpaceMember({ spaceId, userId: ownerId, role: 'owner' })
  addSpaceMember({ spaceId, userId: memberId, role: 'member' })
  createVolume({ spaceId, kind: 'shared', userId: null, dockerName: 'dshvol-team-a-shared' })
  createVolume({ spaceId, kind: 'private', userId: memberId, dockerName: 'dshvol-team-a-member' })
  upsertInstance({ spaceId, userId: memberId, containerName: 'dsh-team-a-member' })
  return spaceId
}

test('removeSpaceMember removes only that membership', () => {
  const spaceId = seedTeamSpace()
  removeSpaceMember(spaceId, memberId)
  assert.equal(getSpaceMember(spaceId, memberId), null)
  assert.equal(listSpaceMembers(spaceId).length, 1)
})

test('deleteVolume removes the row', () => {
  const spaceId = seedTeamSpace()
  const vol = listVolumesForSpace(spaceId).find((v) => v.kind === 'private')
  deleteVolume(vol.id)
  assert.equal(listVolumesForSpace(spaceId).length, 1)
})

test('deleteInstance removes the row', () => {
  const spaceId = seedTeamSpace()
  const inst = listInstancesForSpace(spaceId)[0]
  deleteInstance(inst.id)
  assert.equal(listInstancesForSpace(spaceId).length, 0)
})

test('deleteSpace cascades all rows in one transaction', () => {
  const spaceId = seedTeamSpace()
  deleteSpace(spaceId)
  assert.equal(getSpaceBySlug('team-a'), null)
  assert.equal(listSpaceMembers(spaceId).length, 0)
  assert.equal(listVolumesForSpace(spaceId).length, 0)
  assert.equal(listInstancesForSpace(spaceId).length, 0)
})
