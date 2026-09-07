import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { setActiveConfig, loadConfig } from '../src/config.js'
import { createUser } from '../src/store/users.js'
import { createSpace, addSpaceMember } from '../src/store/spaces.js'
import { upsertInstance, updateInstance } from '../src/store/instances.js'
import { insertSession, deleteAllSessionsForUser } from '../src/store/sessions.js'
import { initDocker } from '../src/orchestrator/docker.js'
import {
  handleUpgrade, closeUserSockets, sweepSocketsOnce, __socketsForTests,
} from '../src/gateway/ws.js'

function fakeSocket() {
  return {
    destroyed: false,
    destroy() { this.destroyed = true },
    on() {}, once() {}, off() {},
  }
}

function seedWs({ status = 'running' } = {}) {
  const uid = createUser({ email: 'a@x.com', handle: 'alice' })
  const sid = createSpace({ slug: 'team-a', name: 'Team A', kind: 'team', ownerId: uid })
  addSpaceMember({ spaceId: sid, userId: uid, role: 'owner' })
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-team-a-alice' })
  updateInstance(inst.id, { status, port: 18901 })
  insertSession({ token: 'a'.repeat(64), userId: uid })
  return { uid, inst }
}

function upgradeReq(path, token = 'a'.repeat(64)) {
  return {
    url: path,
    headers: { host: 'localhost:8080', cookie: `dsh_session=${token}` },
  }
}

function deps() {
  return {
    config: loadConfig({}),
    proxy: { ws: vi.fn(), on: vi.fn() },
    log: { warn: vi.fn(), error: vi.fn() },
  }
}

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({}))
  for (const tracked of [...__socketsForTests()]) __socketsForTests().delete(tracked)
  initDocker({
    getContainer: () => ({ inspect: async () => ({ State: { Running: true } }) }),
    listContainers: async () => [],
  })
})

test('non-/s/ upgrades are left alone; bad targets destroyed', async () => {
  const other = fakeSocket()
  await handleUpgrade(upgradeReq('/api/live'), other, Buffer.alloc(0), deps())
  assert.equal(other.destroyed, false) // 非网关路径不处理
  const bad = fakeSocket()
  await handleUpgrade(upgradeReq('/s/nope/nope/x'), bad, Buffer.alloc(0), deps())
  assert.equal(bad.destroyed, true)
})

test('unauthenticated and non-member upgrades are destroyed', async () => {
  seedWs()
  const anon = fakeSocket()
  await handleUpgrade({ url: '/s/team-a/alice/ws', headers: {} }, anon, Buffer.alloc(0), deps())
  assert.equal(anon.destroyed, true)

  const uid2 = createUser({ email: 'b@x.com', handle: 'bob' })
  insertSession({ token: 'b'.repeat(64), userId: uid2 })
  const nonMember = fakeSocket()
  await handleUpgrade(upgradeReq('/s/team-a/alice/ws', 'b'.repeat(64)), nonMember, Buffer.alloc(0), deps())
  assert.equal(nonMember.destroyed, true)
})

test('authorized upgrade proxies the full prefixed path and tracks the socket', async () => {
  seedWs()
  const d = deps()
  const sock = fakeSocket()
  const req = upgradeReq('/s/team-a/alice/terminal')
  await handleUpgrade(req, sock, Buffer.alloc(0), d)
  assert.equal(sock.destroyed, false)
  assert.equal(d.proxy.ws.mock.calls.length, 1)
  assert.equal(req.url, '/s/team-a/alice/terminal')
  assert.equal(d.proxy.ws.mock.calls[0][3].target, 'ws://127.0.0.1:18901')
  assert.equal(__socketsForTests().size, 1)
})

test('closeUserSockets destroys only that user', async () => {
  const { uid } = seedWs()
  const sock = fakeSocket()
  await handleUpgrade(upgradeReq('/s/team-a/alice/ws'), sock, Buffer.alloc(0), deps())
  closeUserSockets(999) // 别人
  assert.equal(sock.destroyed, false)
  closeUserSockets(uid)
  assert.equal(sock.destroyed, true)
  assert.equal(__socketsForTests().size, 0)
})

test('session sweep destroys sockets whose session expired', async () => {
  const { uid } = seedWs()
  const sock = fakeSocket()
  await handleUpgrade(upgradeReq('/s/team-a/alice/ws'), sock, Buffer.alloc(0), deps())
  deleteAllSessionsForUser(uid)
  sweepSocketsOnce()
  assert.equal(sock.destroyed, true)
  assert.equal(__socketsForTests().size, 0)
})
