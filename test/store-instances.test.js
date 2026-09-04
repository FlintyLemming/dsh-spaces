import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { createUser } from '../src/store/users.js'
import { createSpace } from '../src/store/spaces.js'
import {
  createVolume, listVolumesForSpace, getVolumeByDockerName, deleteVolume,
} from '../src/store/volumes.js'
import {
  upsertInstance, getInstance, getInstanceById, getInstanceByContainerName,
  listInstancesForSpace, listAllInstances, listRunningInstances,
  updateInstance, touchInstanceActivity, deleteInstance,
  countInstancesInSpace, countRunningInstancesInSpace,
} from '../src/store/instances.js'

let uid, sid
beforeEach(() => {
  initDb(':memory:')
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  sid = createSpace({ slug: 'p-aa', name: 'P', kind: 'personal', ownerId: uid })
})

test('volumes: create/list/get/delete; docker_name unique', () => {
  createVolume({ spaceId: sid, kind: 'shared', dockerName: 'dshvol-p-aa-shared' })
  createVolume({ spaceId: sid, kind: 'private', userId: uid, dockerName: 'dshvol-p-aa-aa' })
  assert.equal(listVolumesForSpace(sid).length, 2)
  assert.equal(getVolumeByDockerName('dshvol-p-aa-aa').kind, 'private')
  assert.throws(() =>
    createVolume({ spaceId: sid, kind: 'private', userId: uid, dockerName: 'dshvol-p-aa-aa' }))
  deleteVolume(listVolumesForSpace(sid)[0].id)
  assert.equal(listVolumesForSpace(sid).length, 1)
})

test('upsertInstance converges duplicate (space,user) to one row', () => {
  const a = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  const b = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  assert.equal(a.id, b.id)
  assert.equal(countInstancesInSpace(sid), 1)
  assert.equal(a.status, 'stopped')
  assert.equal(getInstance(sid, uid).id, a.id)
  assert.equal(getInstanceByContainerName('dsh-p-aa-aa').id, a.id)
})

test('updateInstance whitelist + counters + running list', () => {
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  updateInstance(inst.id, { status: 'running', port: 18000, image_digest: 'sha256:' + 'a'.repeat(64) })
  assert.equal(getInstanceById(inst.id).status, 'running')
  assert.throws(() => updateInstance(inst.id, { container_name: 'evil' }), /not updatable/)
  assert.equal(countRunningInstancesInSpace(sid), 1)
  assert.equal(listRunningInstances().length, 1)
  assert.equal(listAllInstances().length, 1)
  assert.equal(listInstancesForSpace(sid).length, 1)
  touchInstanceActivity(inst.id, 1234567890)
  assert.equal(getInstanceById(inst.id).last_active_at, 1234567890)
  deleteInstance(inst.id)
  assert.equal(getInstanceById(inst.id), null)
})
