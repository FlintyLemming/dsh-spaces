import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { createUser } from '../src/store/users.js'
import {
  createSpace, getSpaceById, getSpaceBySlug, listSpacesForUser, listAllSpaces,
  updateSpaceQuotas, deleteSpace,
  addSpaceMember, getSpaceMember, listSpaceMembers, removeSpaceMember, countSpaceMembers,
} from '../src/store/spaces.js'

let owner, member
beforeEach(() => {
  initDb(':memory:')
  owner = createUser({ email: 'o@x.com', handle: 'owner' })
  member = createUser({ email: 'm@x.com', handle: 'member' })
})

test('createSpace + getters; slug unique', () => {
  const id = createSpace({ slug: 'p-owner', name: 'Owner 的空间', kind: 'personal', ownerId: owner })
  assert.equal(getSpaceById(id).kind, 'personal')
  assert.equal(getSpaceBySlug('p-owner').owner_id, owner)
  assert.equal(getSpaceBySlug('nope'), null)
  assert.throws(() => createSpace({ slug: 'p-owner', name: 'x', kind: 'team', ownerId: owner }))
})

test('members: add/get/list/remove/count; PK(space_id,user_id)', () => {
  const sid = createSpace({ slug: 'team-a', name: 'Team A', kind: 'team', ownerId: owner })
  addSpaceMember({ spaceId: sid, userId: owner, role: 'owner' })
  addSpaceMember({ spaceId: sid, userId: member })
  assert.throws(() => addSpaceMember({ spaceId: sid, userId: member }))
  assert.equal(getSpaceMember(sid, owner).role, 'owner')
  assert.equal(countSpaceMembers(sid), 2)
  const rows = listSpaceMembers(sid)
  assert.deepEqual(rows.map((r) => r.handle).sort(), ['member', 'owner'])
  assert.equal(rows.find((r) => r.handle === 'member').email, 'm@x.com')
  removeSpaceMember(sid, member)
  assert.equal(getSpaceMember(sid, member), null)
  assert.equal(countSpaceMembers(sid), 1)
})

test('listSpacesForUser returns only my spaces with member_role', () => {
  const s1 = createSpace({ slug: 'p-owner', name: 'P', kind: 'personal', ownerId: owner })
  const s2 = createSpace({ slug: 'team-a', name: 'T', kind: 'team', ownerId: owner })
  addSpaceMember({ spaceId: s1, userId: owner, role: 'owner' })
  addSpaceMember({ spaceId: s2, userId: owner, role: 'owner' })
  addSpaceMember({ spaceId: s2, userId: member })
  assert.equal(listSpacesForUser(member).length, 1)
  assert.equal(listSpacesForUser(member)[0].member_role, 'member')
  assert.equal(listSpacesForUser(owner).length, 2)
  assert.equal(listAllSpaces().length, 2)
})

test('updateSpaceQuotas sets and clears overrides; deleteSpace removes row', () => {
  const sid = createSpace({ slug: 't', name: 'T', kind: 'team', ownerId: owner })
  updateSpaceQuotas(sid, { quotaCpu: 8, quotaMemMb: 16384, quotaInstances: 4 })
  assert.equal(getSpaceById(sid).quota_cpu, 8)
  updateSpaceQuotas(sid, { quotaCpu: null, quotaMemMb: null, quotaInstances: null })
  assert.equal(getSpaceById(sid).quota_cpu, null)
  deleteSpace(sid)
  assert.equal(getSpaceById(sid), null)
})
