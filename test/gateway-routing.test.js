import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { setActiveConfig, loadConfig } from '../src/config.js'
import { createUser } from '../src/store/users.js'
import { createSpace } from '../src/store/spaces.js'
import { upsertInstance } from '../src/store/instances.js'
import { parseGatewayPath, mayAccessInstance, resolveGatewayTarget } from '../src/gateway/routing.js'

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({}))
})

test('parseGatewayPath parses slug/handle/rest and preserves query', () => {
  assert.deepEqual(parseGatewayPath('/s/team-a/alice'), {
    slug: 'team-a', handle: 'alice', rest: '/', bareRoot: true, query: '',
  })
  assert.deepEqual(parseGatewayPath('/s/team-a/alice/'), {
    slug: 'team-a', handle: 'alice', rest: '/', bareRoot: false, query: '',
  })
  assert.deepEqual(parseGatewayPath('/s/team-a/alice/api/session?x=1&y=2'), {
    slug: 'team-a', handle: 'alice', rest: '/api/session', bareRoot: false, query: '?x=1&y=2',
  })
})

test('parseGatewayPath rejects non-gateway and malformed paths', () => {
  assert.equal(parseGatewayPath('/api/spaces'), null)
  assert.equal(parseGatewayPath('/s/onlyslug'), null)
  assert.equal(parseGatewayPath('/s/'), null)
  assert.equal(parseGatewayPath('/s/Team_A/alice'), null)   // 大写不允许
  assert.equal(parseGatewayPath('/s/a_b/alice'), null)      // 下划线不允许
  assert.equal(parseGatewayPath('/login'), null)
})

test('mayAccessInstance: admin always; member only own instance', () => {
  const admin = { id: 1, role: 'admin', status: 'active' }
  const alice = { id: 2, role: 'user', status: 'active' }
  const bob = { id: 3, role: 'user', status: 'active' }
  const aliceInst = { user_id: 2 }
  assert.equal(mayAccessInstance(admin, aliceInst, null), true)
  assert.equal(mayAccessInstance(alice, aliceInst, { role: 'member' }), true)
  assert.equal(mayAccessInstance(bob, aliceInst, { role: 'member' }), false)   // 同空间也不行
  assert.equal(mayAccessInstance(alice, aliceInst, null), false)               // 非成员
  assert.equal(mayAccessInstance({ ...alice, status: 'disabled' }, aliceInst, { role: 'member' }), false)
  assert.equal(mayAccessInstance(null, aliceInst, { role: 'member' }), false)
})

test('resolveGatewayTarget resolves space × handle → instance', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'alice' })
  const sid = createSpace({ slug: 'team-a', name: 'Team A', kind: 'team', ownerId: uid })
  upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-team-a-alice' })
  const target = resolveGatewayTarget('team-a', 'alice')
  assert.equal(target.instance.container_name, 'dsh-team-a-alice')
  assert.equal(target.space.slug, 'team-a')
  assert.equal(resolveGatewayTarget('team-a', 'nobody'), null)
  assert.equal(resolveGatewayTarget('no-space', 'alice'), null)
  // 空间与用户都在但没有实例 → null
  createUser({ email: 'b@x.com', handle: 'bob' })
  assert.equal(resolveGatewayTarget('team-a', 'bob'), null)
})
