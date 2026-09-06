import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb, getDb } from '../src/store/db.js'
import { listUsersWithStats, listSpacesWithStats, getSpaceAdminDetail, countActiveAdmins }
  from '../src/admin/queries.js'

function seed() {
  const db = getDb()
  const now = Date.now()
  db.prepare("INSERT INTO users (email, handle, display_name, role, created_at) VALUES ('a@x.com','alice','Alice','admin',?)").run(now)
  db.prepare("INSERT INTO users (email, handle, display_name, role, created_at) VALUES ('b@x.com','bob','Bob','user',?)").run(now)
  db.prepare("INSERT INTO spaces (slug, name, kind, owner_id, created_at) VALUES ('p-alice','Alice','personal',1,?)").run(now)
  db.prepare("INSERT INTO spaces (slug, name, kind, owner_id, created_at) VALUES ('team-x','Team X','team',1,?)").run(now)
  db.prepare("INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (2,1,'owner',?),(2,2,'member',?)").run(now, now)
  db.prepare("INSERT INTO instances (space_id, user_id, container_name, status, created_at) VALUES (2,1,'dsh-team-x-alice','running',?)").run(now)
  db.prepare("INSERT INTO instances (space_id, user_id, container_name, status, created_at) VALUES (2,2,'dsh-team-x-bob','stopped',?)").run(now)
  db.prepare("INSERT INTO volumes (space_id, kind, docker_name) VALUES (2,'shared','dshvol-team-x-shared')").run()
  db.prepare("INSERT INTO volumes (space_id, kind, user_id, docker_name) VALUES (2,'private',1,'dshvol-team-x-alice')").run()
}

beforeEach(() => { initDb(':memory:'); seed() })

test('listUsersWithStats aggregates spaces and running instances', () => {
  const users = listUsersWithStats({})
  assert.equal(users.length, 2)
  const alice = users.find((u) => u.handle === 'alice')
  assert.equal(alice.space_count, 1)
  assert.equal(alice.running_instances, 1)
})

test('listUsersWithStats filters by search over email/handle/name', () => {
  assert.equal(listUsersWithStats({ search: 'bob' }).length, 1)
  assert.equal(listUsersWithStats({ search: 'x.com' }).length, 2)
  assert.equal(listUsersWithStats({ search: 'zzz' }).length, 0)
})

test('listSpacesWithStats aggregates members and instances', () => {
  const spaces = listSpacesWithStats()
  const team = spaces.find((s) => s.slug === 'team-x')
  assert.equal(team.member_count, 2)
  assert.equal(team.instance_count, 2)
  assert.equal(team.running_count, 1)
})

test('getSpaceAdminDetail returns members, instances, volumes', () => {
  const detail = getSpaceAdminDetail('team-x')
  assert.equal(detail.members.length, 2)
  assert.equal(detail.members[0].email.includes('@'), true)
  assert.equal(detail.instances.length, 2)
  assert.equal(detail.volumes.length, 2)
  assert.equal(getSpaceAdminDetail('nope'), null)
})

test('countActiveAdmins counts active admins only', () => {
  assert.equal(countActiveAdmins(), 1)
  getDb().prepare("UPDATE users SET status='disabled' WHERE id=1").run()
  assert.equal(countActiveAdmins(), 0)
})
