# dsh-spaces 空间与编排实施计划（计划 03 / 共 07）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现个人空间惰性创建、（空间 × 成员）实例的完整生命周期编排（dockerode）、启动配额校验、实例 REST API、dsh 镜像安全构建管线移植（含新增 `--base-path` patch），以及前端空间列表/详情页。

**Architecture:** `src/spaces/` 承载空间/实例 REST 与业务规则，`src/orchestrator/index.js` 以 dockerode 移植 portal `orchestrator.js` 的编排语义（按容器名的生命周期锁、运行状态缓存、端口分配、健康轮询、删除墓碑复查）。实例键为 `(space_id, user_id)`（schema `UNIQUE` 约束保证幂等收敛）。计划 02 在 OIDC 回调中调用的 `provisionNewUser(userId)` no-op stub 由本计划替换为真实实现（个人空间 + 卷 + owner 成员，DB 写在一个事务里）。配额现算：`spaces` 覆盖字段 ?? `settings` 平台默认，启动时校验，不落统计表。

**Tech Stack:** dockerode, better-sqlite3, Fastify 5（zod 校验）, Vitest（fake docker client 注入）; 前端 React 18 + TypeScript。

**Spec:** `docs/superpowers/specs/2026-09-04-dsh-spaces-design.md`（§3 规则、§5 空间与实例编排、§7 镜像供应链、§9 错误处理、§11 移植清单）

**前置计划：** 计划 01（schema、config、`buildServer`/`apiError`、`getDocker`/`initDocker`、`getSetting`/`setSetting`/`writeAudit`）、计划 02（`requireUser`、`deriveUniqueHandle`、`getConfig()`/`setActiveConfig()`、`provisionNewUser` stub、前端 `apiFetch`/`useMe`/`RequireAuth`）。

## Global Constraints

- 沿用计划 01 全部 Global Constraints（ESM JS、错误信封、提交风格、schema 列名、命名规则）。
- 命名：容器 `dsh-<spaceSlug>-<handle>`；共享卷 `dshvol-<spaceSlug>-shared`；私有卷 `dshvol-<spaceSlug>-<handle>`；租户网络名 = `config.instanceNetwork`（默认 `dsh-tenants`）。
- 实例状态机只允许 `stopped | starting | running | error`（schema CHECK 强制）；所有状态迁移经 `updateInstance`。
- 非成员访问空间 API 一律 404 `NOT_FOUND`（不泄露空间存在性）。
- 审计动作名（本计划写入）：`space.create`（detail `{kind}`）、`instance.start`、`instance.stop`、`instance.rebuild`（targetType 分别为 `space`/`instance`）。
- 镜像只按 `sha256:` digest 启动（`settings.image_digest`），禁止 tag；digest 为空时启动实例返回 503 `IMAGE_NOT_CONFIGURED`。
- 所有 docker 调用经 `getDocker()`；测试用 `initDocker(fake)` 注入假客户端，禁止在单测中触碰真 docker。
- UI 遵循 spec §8 设计语言。

---

### Task 1: spaces 与 space_members 数据访问

**Files:**
- Create: `src/store/spaces.js`
- Test: `test/store-spaces.test.js`

**Interfaces:**
- Consumes: `getDb()`（计划 01）。
- Produces（精确签名，计划 04/05/06 直接消费）：
  - `createSpace({ slug, name, kind, ownerId })` → id
  - `getSpaceById(id)` / `getSpaceBySlug(slug)` → row 或 null
  - `listSpacesForUser(userId)` → rows（JOIN space_members，含 `member_role`）
  - `listAllSpaces()` → rows
  - `updateSpaceQuotas(id, { quotaCpu, quotaMemMb, quotaInstances })`（null = 回落平台默认；计划 06 用）
  - `deleteSpace(id)`（仅删 spaces 行；级联清理由计划 05 编排）
  - `addSpaceMember({ spaceId, userId, role = 'member' })`
  - `getSpaceMember(spaceId, userId)` → row 或 null
  - `listSpaceMembers(spaceId)` → rows（JOIN users，含 `email`, `handle`, `display_name`）
  - `removeSpaceMember(spaceId, userId)`
  - `countSpaceMembers(spaceId)` → number

- [ ] **Step 1: 写失败的测试**

```javascript
// test/store-spaces.test.js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/store-spaces.test.js`
Expected: FAIL — `Cannot find module '../src/store/spaces.js'`

- [ ] **Step 3: 实现 spaces.js**

```javascript
// src/store/spaces.js
import { getDb } from './db.js'

export function createSpace({ slug, name, kind, ownerId }) {
  return getDb().prepare(
    `INSERT INTO spaces (slug, name, kind, owner_id, created_at) VALUES (?,?,?,?,?)`,
  ).run(slug, name, kind, ownerId, Date.now()).lastInsertRowid
}

export function getSpaceById(id) {
  return getDb().prepare('SELECT * FROM spaces WHERE id = ?').get(id) ?? null
}

export function getSpaceBySlug(slug) {
  return getDb().prepare('SELECT * FROM spaces WHERE slug = ?').get(slug) ?? null
}

export function listSpacesForUser(userId) {
  return getDb().prepare(
    `SELECT s.*, m.role AS member_role FROM spaces s
     JOIN space_members m ON m.space_id = s.id
     WHERE m.user_id = ? ORDER BY s.id`,
  ).all(userId)
}

export function listAllSpaces() {
  return getDb().prepare('SELECT * FROM spaces ORDER BY id').all()
}

export function updateSpaceQuotas(id, { quotaCpu, quotaMemMb, quotaInstances }) {
  getDb().prepare(
    `UPDATE spaces SET quota_cpu = ?, quota_mem_mb = ?, quota_instances = ? WHERE id = ?`,
  ).run(quotaCpu, quotaMemMb, quotaInstances, id)
}

export function deleteSpace(id) {
  getDb().prepare('DELETE FROM spaces WHERE id = ?').run(id)
}

export function addSpaceMember({ spaceId, userId, role = 'member' }) {
  getDb().prepare(
    `INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?,?,?,?)`,
  ).run(spaceId, userId, role, Date.now())
}

export function getSpaceMember(spaceId, userId) {
  return getDb().prepare(
    'SELECT * FROM space_members WHERE space_id = ? AND user_id = ?',
  ).get(spaceId, userId) ?? null
}

export function listSpaceMembers(spaceId) {
  return getDb().prepare(
    `SELECT m.*, u.email, u.handle, u.display_name FROM space_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.space_id = ? ORDER BY m.created_at, m.user_id`,
  ).all(spaceId)
}

export function removeSpaceMember(spaceId, userId) {
  getDb().prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?')
    .run(spaceId, userId)
}

export function countSpaceMembers(spaceId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM space_members WHERE space_id = ?')
    .get(spaceId).n
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/store-spaces.test.js`
Expected: 4 PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/spaces.js test/store-spaces.test.js
git commit -m "feat: spaces and members data access"
```

---

### Task 2: volumes 与 instances 数据访问

**Files:**
- Create: `src/store/volumes.js`
- Create: `src/store/instances.js`
- Test: `test/store-instances.test.js`

**Interfaces:**
- Consumes: `getDb()`、`createSpace`/`addSpaceMember`（Task 1）、`createUser`（计划 02）。
- Produces（精确签名）：
  - `createVolume({ spaceId, kind, userId = null, dockerName })` → id
  - `listVolumesForSpace(spaceId)` → rows
  - `getVolumeByDockerName(dockerName)` → row 或 null
  - `deleteVolume(id)`
  - `upsertInstance({ spaceId, userId, containerName })` → row（`INSERT ... ON CONFLICT(space_id,user_id) DO NOTHING` 后 SELECT，spec §9 幂等收敛）
  - `getInstance(spaceId, userId)` / `getInstanceById(id)` / `getInstanceByContainerName(name)` → row 或 null
  - `listInstancesForSpace(spaceId)` / `listAllInstances()` / `listRunningInstances()` → rows
  - `updateInstance(id, fields)` — 白名单键：`port`, `status`, `error`, `image_digest`, `last_active_at`
  - `touchInstanceActivity(id, now = Date.now())`
  - `deleteInstance(id)`
  - `countInstancesInSpace(spaceId)` / `countRunningInstancesInSpace(spaceId)` → number

- [ ] **Step 1: 写失败的测试**

```javascript
// test/store-instances.test.js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/store-instances.test.js`
Expected: FAIL — `Cannot find module '../src/store/volumes.js'`

- [ ] **Step 3: 实现 volumes.js 与 instances.js**

```javascript
// src/store/volumes.js
import { getDb } from './db.js'

export function createVolume({ spaceId, kind, userId = null, dockerName }) {
  return getDb().prepare(
    `INSERT INTO volumes (space_id, kind, user_id, docker_name) VALUES (?,?,?,?)`,
  ).run(spaceId, kind, userId, dockerName).lastInsertRowid
}

export function listVolumesForSpace(spaceId) {
  return getDb().prepare('SELECT * FROM volumes WHERE space_id = ? ORDER BY id').all(spaceId)
}

export function getVolumeByDockerName(dockerName) {
  return getDb().prepare('SELECT * FROM volumes WHERE docker_name = ?').get(dockerName) ?? null
}

export function deleteVolume(id) {
  getDb().prepare('DELETE FROM volumes WHERE id = ?').run(id)
}
```

```javascript
// src/store/instances.js
import { getDb } from './db.js'

export function upsertInstance({ spaceId, userId, containerName }) {
  getDb().prepare(
    `INSERT INTO instances (space_id, user_id, container_name, created_at)
     VALUES (?,?,?,?)
     ON CONFLICT(space_id, user_id) DO NOTHING`,
  ).run(spaceId, userId, containerName, Date.now())
  return getInstance(spaceId, userId)
}

export function getInstance(spaceId, userId) {
  return getDb().prepare('SELECT * FROM instances WHERE space_id = ? AND user_id = ?')
    .get(spaceId, userId) ?? null
}

export function getInstanceById(id) {
  return getDb().prepare('SELECT * FROM instances WHERE id = ?').get(id) ?? null
}

export function getInstanceByContainerName(name) {
  return getDb().prepare('SELECT * FROM instances WHERE container_name = ?').get(name) ?? null
}

export function listInstancesForSpace(spaceId) {
  return getDb().prepare('SELECT * FROM instances WHERE space_id = ? ORDER BY id').all(spaceId)
}

export function listAllInstances() {
  return getDb().prepare('SELECT * FROM instances ORDER BY id').all()
}

export function listRunningInstances() {
  return getDb().prepare("SELECT * FROM instances WHERE status = 'running' ORDER BY id").all()
}

const UPDATABLE = new Set(['port', 'status', 'error', 'image_digest', 'last_active_at'])
export function updateInstance(id, fields) {
  const keys = Object.keys(fields)
  for (const k of keys) {
    if (!UPDATABLE.has(k)) throw new Error(`instance field ${k} is not updatable`)
  }
  if (keys.length === 0) return
  const sets = keys.map((k) => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE instances SET ${sets} WHERE id = @id`).run({ id, ...fields })
}

export function touchInstanceActivity(id, now = Date.now()) {
  getDb().prepare('UPDATE instances SET last_active_at = ? WHERE id = ?').run(now, id)
}

export function deleteInstance(id) {
  getDb().prepare('DELETE FROM instances WHERE id = ?').run(id)
}

export function countInstancesInSpace(spaceId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM instances WHERE space_id = ?')
    .get(spaceId).n
}

export function countRunningInstancesInSpace(spaceId) {
  return getDb().prepare(
    "SELECT COUNT(*) AS n FROM instances WHERE space_id = ? AND status = 'running'",
  ).get(spaceId).n
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/store-instances.test.js`
Expected: 3 PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/volumes.js src/store/instances.js test/store-instances.test.js
git commit -m "feat: volumes and instances data access"
```

---

### Task 3: 编排原语（锁、卷、网络、端口、容器参数）

**Files:**
- Create: `src/orchestrator/index.js`
- Test: `test/orchestrator-core.test.js`

**Interfaces:**
- Consumes: `getDocker()`/`isMissingContainerError`（计划 01）、`getConfig()`（计划 02 加入 `src/config.js`）、store（Task 1/2）、`apiError`（计划 01）。
- Produces（精确签名，后续任务与计划 04/05/06 消费）：
  - `containerNameFor(spaceSlug, handle)` → `dsh-<slug>-<handle>`
  - `sharedVolumeName(spaceSlug)` / `privateVolumeName(spaceSlug, handle)`
  - `withLifecycleLock(name, op)` — 按容器名串行化（portal `withLifecycleLock` 移植）
  - `ensureVolume(name)` / `removeVolume(name)`（幂等，忽略已存在/不存在）
  - `prepareSharedVolume(name)` — 一次性 helper 容器置 GID + setgid（spec §5）
  - `ensureTenantNetwork()` — 确保 `config.instanceNetwork` 桥接网络存在
  - `allocatePort()` → number（DB 占用 + 127.0.0.1 bind 探测；耗尽抛 `apiError(503,'PORT_POOL_EXHAUSTED',...)`）
  - `containerRunning(name, {fresh})` → boolean（2 秒缓存 + 失效，portal 模式）
  - `waitHealthy(port, timeoutMs)` → boolean（轮询 `http://127.0.0.1:<port>/` 至 200）
  - `createInstanceContainer({ spaceSlug, handle, port, imageDigest })`
  - `startContainer(name)` / `stopContainer(name)`（t=15s）/ `removeContainer(name)`（force）/ `removeContainerKeepVolumes(name)`

- [ ] **Step 1: 写失败的测试（fake docker client）**

```javascript
// test/orchestrator-core.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import {
  containerNameFor, sharedVolumeName, privateVolumeName,
  ensureVolume, removeVolume, ensureTenantNetwork, allocatePort,
  createInstanceContainer, containerRunning,
} from '../src/orchestrator/index.js'
import { upsertInstance } from '../src/store/instances.js'
import { createUser } from '../src/store/users.js'
import { createSpace } from '../src/store/spaces.js'

function fakeDocker() {
  const calls = []
  return {
    calls,
    volumes: new Set(),
    networks: [],
    containers: new Map(),
    async createVolume(opts) { calls.push(['createVolume', opts]); this.volumes.add(opts.Name); return {} },
    getVolume(name) {
      return { remove: async () => { calls.push(['removeVolume', name]); this.volumes.delete(name) } }
    },
    async listNetworks({ filters }) {
      return this.networks.filter((n) => filters.name.includes(n.Name))
    },
    async createNetwork(opts) { calls.push(['createNetwork', opts]); this.networks.push(opts); return {} },
    async createContainer(opts) {
      calls.push(['createContainer', opts])
      this.containers.set(opts.name, { State: { Running: false } })
      return { id: opts.name }
    },
    getContainer(name) {
      const self = this
      return {
        async inspect() {
          const c = self.containers.get(name)
          if (!c) { const e = new Error(`no such container: ${name}`); e.statusCode = 404; throw e }
          return c
        },
      }
    },
  }
}

let docker
beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  docker = fakeDocker()
  initDocker(docker)
})

test('naming rules', () => {
  assert.equal(containerNameFor('team-a', 'bob'), 'dsh-team-a-bob')
  assert.equal(sharedVolumeName('team-a'), 'dshvol-team-a-shared')
  assert.equal(privateVolumeName('team-a', 'bob'), 'dshvol-team-a-bob')
})

test('ensureVolume idempotent; removeVolume removes', async () => {
  await ensureVolume('v1')
  await ensureVolume('v1')
  assert.equal(docker.calls.filter((c) => c[0] === 'createVolume').length, 1)
  await removeVolume('v1')
  assert.equal(docker.calls.filter((c) => c[0] === 'removeVolume').length, 1)
  await removeVolume('v1') // 不存在也幂等
})

test('ensureTenantNetwork creates only when absent', async () => {
  await ensureTenantNetwork()
  await ensureTenantNetwork()
  assert.equal(docker.calls.filter((c) => c[0] === 'createNetwork').length, 1)
  assert.equal(docker.networks[0].Name, 'dsh-tenants')
  assert.equal(docker.networks[0].Driver, 'bridge')
})

test('allocatePort skips DB-claimed ports and throws when exhausted', async () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  const sid = createSpace({ slug: 's', name: 'S', kind: 'team', ownerId: uid })
  // 占满整个范围（测试用小范围）
  setActiveConfig(loadConfig({ PORT_RANGE_START: '19000', PORT_RANGE_END: '19001' }))
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'c1' })
  const { updateInstance } = await import('../src/store/instances.js')
  updateInstance(inst.id, { port: 19000 })
  const p = await allocatePort()
  assert.equal(p, 19001)
  updateInstance(inst.id, { port: 19001 })
  // 19000 现在空闲但 DB 里 19001 已占；19000 的 bind 探测应成功
  // 再占 19000：直接监听占位由下一个测试覆盖，这里耗尽判定：
  const uid2 = createUser({ email: 'b@x.com', handle: 'bb' })
  const inst2 = upsertInstance({ spaceId: sid, userId: uid2, containerName: 'c2' })
  updateInstance(inst2.id, { port: 19000 })
  await assert.rejects(() => allocatePort(), /PORT_POOL_EXHAUSTED/)
})

test('createInstanceContainer passes full isolation/host config', async () => {
  await createInstanceContainer({
    spaceSlug: 'team-a', handle: 'bob', port: 18000, imageDigest: 'sha256:' + 'a'.repeat(64),
  })
  const [_, opts] = docker.calls.find((c) => c[0] === 'createContainer')
  assert.equal(opts.name, 'dsh-team-a-bob')
  assert.equal(opts.User, '1000:1000')
  assert.ok(opts.Env.includes('DSH_HOME=/home/dsh/.dsh'))
  assert.ok(opts.Env.includes('BASE_PATH=/s/team-a/bob'))
  const hc = opts.HostConfig
  assert.deepEqual(hc.PortBindings, { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '18000' }] })
  assert.equal(hc.ReadonlyRootfs, true)
  assert.equal(hc.NanoCpus, 2e9)
  assert.equal(hc.Memory, 2048 * 1024 * 1024)
  assert.equal(hc.MemorySwap, 2048 * 1024 * 1024)
  assert.equal(hc.PidsLimit, 512)
  assert.deepEqual(hc.CapDrop, ['ALL'])
  assert.deepEqual(hc.SecurityOpt, ['no-new-privileges'])
  assert.equal(hc.NetworkMode, 'dsh-tenants')
  assert.deepEqual(hc.RestartPolicy, { Name: 'unless-stopped' })
  const mounts = Object.fromEntries(hc.Mounts.map((m) => [m.Target, m.Source]))
  assert.equal(mounts['/workspace/shared'], 'dshvol-team-a-shared')
  assert.equal(mounts['/home/dsh'], 'dshvol-team-a-bob')
})

test('containerRunning caches and treats missing container as false', async () => {
  docker.containers.set('c-run', { State: { Running: true } })
  assert.equal(await containerRunning('c-run'), true)
  assert.equal(await containerRunning('c-gone'), false)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/orchestrator-core.test.js`
Expected: FAIL — `Cannot find module '../src/orchestrator/index.js'`

- [ ] **Step 3: 实现 orchestrator/index.js 原语部分**

```javascript
// src/orchestrator/index.js
import net from 'node:net'
import http from 'node:http'
import { getConfig } from '../config.js'
import { getDb } from '../store/db.js'
import { getDocker, isMissingContainerError } from './docker.js'
import { apiError } from '../server.js'

// ---- 命名 ----
export function containerNameFor(spaceSlug, handle) {
  return `dsh-${spaceSlug}-${handle}`
}
export function sharedVolumeName(spaceSlug) {
  return `dshvol-${spaceSlug}-shared`
}
export function privateVolumeName(spaceSlug, handle) {
  return `dshvol-${spaceSlug}-${handle}`
}

// ---- 生命周期锁（portal withLifecycleLock 移植）----
const lifecycleLocks = new Map()
export function withLifecycleLock(name, operation) {
  const previous = lifecycleLocks.get(name) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  lifecycleLocks.set(name, current)
  return current.finally(() => {
    if (lifecycleLocks.get(name) === current) lifecycleLocks.delete(name)
  })
}

// ---- 卷 ----
export async function ensureVolume(name) {
  try {
    await getDocker().createVolume({ Name: name })
  } catch (err) {
    const text = String(err?.message ?? '')
    if (err?.statusCode !== 409 && !text.includes('already exists')) throw err
  }
}

export async function removeVolume(name) {
  try {
    await getDocker().getVolume(name).remove()
  } catch (err) {
    if (!isMissingContainerError(err) && err?.statusCode !== 404) throw err
  }
}

/** spec §5：共享卷归属统一 GID 并置 setgid，A 写的文件 B 可改。 */
export async function prepareSharedVolume(name) {
  const config = getConfig()
  const docker = getDocker()
  const container = await docker.createContainer({
    name: `dsh-volprep-${name}`,
    Image: 'alpine:3',
    User: '0:0',
    Cmd: ['sh', '-c', `chown :${config.instanceGid} /shared && chmod g+s /shared`],
    HostConfig: {
      Mounts: [{ Type: 'volume', Source: name, Target: '/shared' }],
      AutoRemove: true,
    },
  })
  await container.start()
  const { StatusCode } = await container.wait()
  if (StatusCode !== 0) throw new Error(`prepareSharedVolume(${name}) exited ${StatusCode}`)
}

// ---- 租户网络 ----
export async function ensureTenantNetwork() {
  const config = getConfig()
  const docker = getDocker()
  const found = await docker.listNetworks({ filters: { name: [config.instanceNetwork] } })
  if (found.length === 0) {
    await docker.createNetwork({ Name: config.instanceNetwork, Driver: 'bridge' })
  }
}

// ---- 端口分配（portal allocatePort 移植）----
export async function allocatePort() {
  const config = getConfig()
  const used = new Set(
    getDb().prepare('SELECT port FROM instances WHERE port IS NOT NULL').all()
      .map((r) => r.port),
  )
  for (let p = config.portRangeStart; p <= config.portRangeEnd; p++) {
    if (used.has(p)) continue
    if (await isPortFree(p)) return p
  }
  throw apiError(503, 'PORT_POOL_EXHAUSTED', '实例端口池已耗尽，请联系管理员')
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

// ---- 运行状态缓存（portal 模式：2s TTL + 生命周期操作失效）----
const runningCache = new Map()
const RUNNING_CACHE_TTL_MS = 2000

export function invalidateRunning(name) {
  runningCache.delete(name)
}

export async function containerRunning(name, { fresh = false } = {}) {
  const now = Date.now()
  const cached = runningCache.get(name)
  if (cached?.pending) return cached.pending
  if (!fresh && cached && cached.expiresAt > now) return cached.value
  const pending = getDocker().getContainer(name).inspect()
    .then((info) => info.State?.Running === true)
    .catch((err) => {
      if (isMissingContainerError(err)) return false
      throw err
    })
  const entry = { pending }
  runningCache.set(name, entry)
  try {
    const value = await pending
    if (runningCache.get(name) === entry) {
      runningCache.set(name, { value, expiresAt: Date.now() + RUNNING_CACHE_TTL_MS })
    }
    return value
  } catch (err) {
    if (runningCache.get(name) === entry) runningCache.delete(name)
    throw err
  }
}

// ---- 健康轮询（portal waitHealthy 移植）----
export function waitHealthy(port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/', timeout: 5000 },
        (res) => {
          res.resume()
          if (res.statusCode === 200) return resolve(true)
          schedule()
        },
      )
      req.on('error', schedule)
      req.on('timeout', () => { req.destroy(); schedule() })
      function schedule() {
        if (Date.now() >= deadline) return resolve(false)
        setTimeout(check, 2000)
      }
    }
    check()
  })
}

// ---- 容器创建（spec §7 容器隔离基线）----
export async function createInstanceContainer({ spaceSlug, handle, port, imageDigest }) {
  const config = getConfig()
  const name = containerNameFor(spaceSlug, handle)
  invalidateRunning(name)
  await getDocker().createContainer({
    name,
    Image: imageDigest,
    User: `${config.instanceUid}:${config.instanceGid}`,
    Env: [
      'DSH_HOME=/home/dsh/.dsh',
      `BASE_PATH=/s/${spaceSlug}/${handle}`,
    ],
    ExposedPorts: { '3000/tcp': {} },
    HostConfig: {
      PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
      Mounts: [
        { Type: 'volume', Source: sharedVolumeName(spaceSlug), Target: '/workspace/shared' },
        { Type: 'volume', Source: privateVolumeName(spaceSlug, handle), Target: '/home/dsh' },
      ],
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=64m' },
      Memory: config.instanceMemoryMb * 1024 * 1024,
      MemorySwap: config.instanceMemoryMb * 1024 * 1024, // 等值 = 禁 swap
      NanoCpus: Math.round(config.instanceCpus * 1e9),
      PidsLimit: config.instancePidsLimit,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: config.instanceNetwork,
      RestartPolicy: { Name: 'unless-stopped' },
    },
  })
  invalidateRunning(name)
}

export async function containerExists(name) {
  try {
    await getDocker().getContainer(name).inspect()
    return true
  } catch (err) {
    if (isMissingContainerError(err)) return false
    throw err
  }
}

export function startContainer(name) {
  return withLifecycleLock(name, async () => {
    invalidateRunning(name)
    await getDocker().getContainer(name).start()
    invalidateRunning(name)
  })
}

export function stopContainer(name) {
  return withLifecycleLock(name, async () => {
    invalidateRunning(name)
    try {
      await getDocker().getContainer(name).stop({ t: 15 })
    } catch (err) {
      // 已停止视为成功（304 not modified）
      if (err?.statusCode !== 304 && !isMissingContainerError(err)) throw err
    }
    invalidateRunning(name)
  })
}

export function removeContainer(name) {
  return withLifecycleLock(name, async () => {
    try {
      await getDocker().getContainer(name).remove({ force: true })
    } catch (err) {
      if (!isMissingContainerError(err)) throw err
    }
    invalidateRunning(name)
  })
}

/** 只删容器保留卷（重建/幂等再供给用）。 */
export const removeContainerKeepVolumes = removeContainer
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/orchestrator-core.test.js`
Expected: 6 PASS

- [ ] **Step 5: 提交**

```bash
git add src/orchestrator/index.js test/orchestrator-core.test.js
git commit -m "feat: orchestrator primitives (locks, volumes, network, ports, container config)"
```

---

### Task 4: 实例生命周期与配额校验

**Files:**
- Modify: `src/orchestrator/index.js`（追加生命周期与配额函数）
- Test: `test/orchestrator-lifecycle.test.js`

**Interfaces:**
- Consumes: Task 3 全部原语；`getSetting`（计划 01）；store instances/spaces。
- Produces：
  - `effectiveQuota(space)` → `{ cpu, memMb, instances }`（空间覆盖 ?? settings 默认；spec §3 现算）
  - `checkStartQuota(space)` / `checkInstanceCountQuota(space)` — 超限抛 `apiError(409, 'QUOTA_EXCEEDED', ...)`
  - `startInstance(instanceId)` → 最终 instance row（完整流程：quota → 端口 → 建/起容器 → 健康 → running/error）
  - `stopInstance(instanceId)`
  - `rebuildInstance(instanceId)`（删容器留卷 + 重启，spec §5 重建）

- [ ] **Step 1: 写失败的测试**

```javascript
// test/orchestrator-lifecycle.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { setSetting } from '../src/store/settings.js'
import { createUser } from '../src/store/users.js'
import { createSpace, addSpaceMember } from '../src/store/spaces.js'
import { upsertInstance, getInstanceById, updateInstance } from '../src/store/instances.js'
import {
  effectiveQuota, checkStartQuota, checkInstanceCountQuota, startInstance, stopInstance,
} from '../src/orchestrator/index.js'

// fake docker：容器 start 后 waitHealthy 需要一个真 HTTP 200；
// 用 ephemeral HTTP server 顶替（allocatePort 会避开被占用端口——测试先起 server 再 allocate）。
import http from 'node:http'

let docker
let uid, sid
async function makeInstance() {
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  return inst
}

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development', INSTANCE_START_TIMEOUT_MS: '15000' }))
  setSetting('image_digest', 'sha256:' + 'b'.repeat(64))
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  sid = createSpace({ slug: 'p-aa', name: 'P', kind: 'personal', ownerId: uid })
  addSpaceMember({ spaceId: sid, userId: uid, role: 'owner' })
  docker = {
    containers: new Map(),
    async createContainer(opts) {
      this.containers.set(opts.name, { State: { Running: false } })
      return { id: opts.name }
    },
    getContainer(name) {
      const self = this
      return {
        async inspect() {
          const c = self.containers.get(name)
          if (!c) { const e = new Error(`no such container: ${name}`); e.statusCode = 404; throw e }
          return c
        },
        async start() { self.containers.get(name).State.Running = true },
        async stop() { self.containers.get(name).State.Running = false },
        async remove() { self.containers.delete(name) },
      }
    },
    async createVolume() { return {} },
    async listNetworks() { return [{ Name: 'dsh-tenants' }] },
  }
  initDocker(docker)
})

test('effectiveQuota falls back to settings defaults; space override wins', () => {
  const space = { quota_cpu: null, quota_mem_mb: null, quota_instances: null }
  assert.deepEqual(effectiveQuota(space), { cpu: 4, memMb: 8192, instances: 8 })
  assert.equal(effectiveQuota({ ...space, quota_cpu: 16 }).cpu, 16)
})

test('checkStartQuota blocks when running sum would exceed', () => {
  // 默认 4 核 / 每实例 2 核 → 第二个并行启动被拒绝
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'c-x' })
  updateInstance(inst.id, { status: 'running' })
  const uid2 = createUser({ email: 'b@x.com', handle: 'bb' })
  addSpaceMember({ spaceId: sid, userId: uid2 })
  const inst2 = upsertInstance({ spaceId: sid, userId: uid2, containerName: 'c-y' })
  updateInstance(inst2.id, { status: 'running' })
  assert.throws(() => checkStartQuota({ id: sid, quota_cpu: null, quota_mem_mb: null }),
    /QUOTA_EXCEEDED|配额/)
})

test('checkInstanceCountQuota blocks beyond limit', () => {
  setSetting('default_quota_instances', '1')
  assert.equal(countRunningSafe(), 0)
  const space = { id: sid, quota_instances: null }
  checkInstanceCountQuota(space) // 0 个实例，通过
  upsertInstance({ spaceId: sid, userId: uid, containerName: 'c-1' })
  assert.throws(() => checkInstanceCountQuota(space), /QUOTA_EXCEEDED/)
})
function countRunningSafe() { return 0 }

test('startInstance creates container, waits healthy, marks running', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const inst = await makeInstance()
  // 预占端口，逼 allocatePort 选到我们的健康 server 端口之外——
  // 改为直接给实例指定端口，跳过分配不确定性：
  updateInstance(inst.id, { port })
  const result = await startInstance(inst.id)
  assert.equal(result.status, 'running')
  assert.equal(result.image_digest, 'sha256:' + 'b'.repeat(64))
  assert.ok(docker.containers.get('dsh-p-aa-aa').State.Running)
  srv.close()
})

test('startInstance without image digest fails with IMAGE_NOT_CONFIGURED', async () => {
  setSetting('image_digest', '')
  const inst = await makeInstance()
  await assert.rejects(() => startInstance(inst.id), /IMAGE_NOT_CONFIGURED/)
})

test('startInstance marks error when health check times out', async () => {
  const inst = await makeInstance()
  // 分配一个端口但不提供服务：找一个空闲端口直接写进实例
  const probe = http.createServer()
  await new Promise((r) => probe.listen(0, '127.0.0.1', r))
  const port = probe.address().port
  probe.close() // 端口空闲、无人服务 → 健康检查必超时
  updateInstance(inst.id, { port })
  setActiveConfig(loadConfig({ INSTANCE_START_TIMEOUT_MS: '2500' }))
  const result = await startInstance(inst.id)
  assert.equal(result.status, 'error')
  assert.match(result.error, /health/i)
})

test('stopInstance stops container and marks stopped', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const inst = await makeInstance()
  updateInstance(inst.id, { port: srv.address().port })
  await startInstance(inst.id)
  await stopInstance(inst.id)
  assert.equal(getInstanceById(inst.id).status, 'stopped')
  assert.equal(docker.containers.get('dsh-p-aa-aa').State.Running, false)
  srv.close()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/orchestrator-lifecycle.test.js`
Expected: FAIL — `effectiveQuota is not exported`

- [ ] **Step 3: 实现配额与生命周期**

`src/orchestrator/index.js` 追加：

```javascript
import { getSetting } from '../store/settings.js'
import { getSpaceById } from '../store/spaces.js'
import {
  getInstanceById, updateInstance, countRunningInstancesInSpace, countInstancesInSpace,
} from '../store/instances.js'
import { ApiError } from '../server.js'

// ---- 配额（spec §3：现算，不落统计表）----
export function effectiveQuota(space) {
  return {
    cpu: space.quota_cpu ?? Number(getSetting('default_quota_cpu', '4')),
    memMb: space.quota_mem_mb ?? Number(getSetting('default_quota_mem_mb', '8192')),
    instances: space.quota_instances ?? Number(getSetting('default_quota_instances', '8')),
  }
}

export function checkStartQuota(space) {
  const q = effectiveQuota(space)
  const running = countRunningInstancesInSpace(space.id)
  const { instanceCpus, instanceMemoryMb } = getConfig()
  if ((running + 1) * instanceCpus > q.cpu || (running + 1) * instanceMemoryMb > q.memMb) {
    throw apiError(409, 'QUOTA_EXCEEDED',
      `空间资源配额不足：运行中 ${running} 个实例，限额 ${q.cpu} 核 / ${q.memMb} MB`)
  }
}

export function checkInstanceCountQuota(space) {
  const q = effectiveQuota(space)
  if (countInstancesInSpace(space.id) >= q.instances) {
    throw apiError(409, 'QUOTA_EXCEEDED', `空间实例数已达上限 ${q.instances}`)
  }
}

// ---- 实例生命周期（portal provision 模式：锁内重读 + 故障落 error）----
export async function startInstance(instanceId) {
  const initial = getInstanceById(instanceId)
  if (!initial) throw apiError(404, 'NOT_FOUND', '实例不存在')
  const name = initial.container_name
  return withLifecycleLock(name, async () => {
    const inst = getInstanceById(instanceId)
    if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
    if (inst.status === 'running' && await containerRunning(name)) return inst

    const image = getSetting('image_digest')
    if (!image) throw apiError(503, 'IMAGE_NOT_CONFIGURED', '平台尚未配置 dsh 镜像，请联系管理员')
    const space = getSpaceById(inst.space_id)
    const config = getConfig()
    updateInstance(inst.id, { status: 'starting', error: null })
    try {
      checkStartQuota(space)
      const port = inst.port ?? await allocatePort()
      if (port !== inst.port) updateInstance(inst.id, { port })

      // 镜像 digest 变化或容器缺失 → 重建容器（保留卷）
      if (await containerExists(name)) {
        const info = await getDocker().getContainer(name).inspect()
        if (info.Image !== image && inst.image_digest && inst.image_digest !== image) {
          await removeContainerKeepVolumes(name)
        }
      }
      if (!(await containerExists(name))) {
        const spaceSlug = space.slug
        const handle = name.slice(`dsh-${spaceSlug}-`.length)
        await ensureVolume(sharedVolumeName(spaceSlug))
        await ensureVolume(privateVolumeName(spaceSlug, handle))
        await createInstanceContainer({ spaceSlug, handle, port, imageDigest: image })
      }
      if (!(await containerRunning(name, { fresh: true }))) {
        invalidateRunning(name)
        await getDocker().getContainer(name).start()
        invalidateRunning(name)
      }

      const healthy = await waitHealthy(port, config.instanceStartTimeoutMs)
      // 健康轮询期间行可能已被删除（空间删除级联）——复查墓碑
      const current = getInstanceById(instanceId)
      if (!current) {
        await removeContainerKeepVolumes(name)
        throw apiError(404, 'NOT_FOUND', '实例不存在')
      }
      if (healthy) {
        updateInstance(inst.id, {
          status: 'running', error: null, image_digest: image, last_active_at: Date.now(),
        })
      } else {
        await stopContainer(name)
        updateInstance(inst.id, { status: 'error', error: 'health check timed out' })
      }
      return getInstanceById(instanceId)
    } catch (err) {
      const current = getInstanceById(instanceId)
      if (current) {
        if (err instanceof ApiError) {
          // 业务错误（配额/端口）→ 回到 stopped，保留原因
          updateInstance(inst.id, { status: 'stopped', error: err.message })
        } else {
          updateInstance(inst.id, { status: 'error', error: String(err?.message ?? err) })
        }
      }
      throw err
    }
  })
}

export async function stopInstance(instanceId) {
  const inst = getInstanceById(instanceId)
  if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
  await stopContainer(inst.container_name)
  updateInstance(inst.id, { status: 'stopped', error: null })
  return getInstanceById(instanceId)
}

export async function rebuildInstance(instanceId) {
  const inst = getInstanceById(instanceId)
  if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
  await removeContainerKeepVolumes(inst.container_name)
  updateInstance(inst.id, { status: 'stopped', error: null })
  return startInstance(instanceId)
}
```

注意：`startInstance` 里用容器名反解 handle（`name.slice(...)`）是因为 instances 表不存 handle；容器名规则 `dsh-<slug>-<handle>` 由本模块唯一生成，反解安全。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/orchestrator-lifecycle.test.js test/orchestrator-core.test.js`
Expected: 全部 PASS（7 + 6）

- [ ] **Step 5: 提交**

```bash
git add src/orchestrator/index.js test/orchestrator-lifecycle.test.js
git commit -m "feat: instance lifecycle with quota enforcement"
```

---

### Task 5: reconcile、空闲休眠 sweep 与启动接线

**Files:**
- Modify: `src/orchestrator/index.js`
- Modify: `src/index.js`（ensureTenantNetwork + reconcile + startIdleSweep）
- Test: `test/orchestrator-reconcile.test.js`

**Interfaces:**
- Consumes: `listAllInstances`/`listRunningInstances`/`updateInstance`（Task 2）、`stopInstance`（Task 4）。
- Produces:
  - `reconcile()` — spec §5：对比 SQLite 与 `docker ps -a`，崩溃标 `error`、状态不一致纠正。
  - `sweepIdleInstances(now)` / `startIdleSweep()` — spec §5 空闲自动停止（阈值 `settings.idle_stop_minutes`，默认 60）。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/orchestrator-reconcile.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { setSetting } from '../src/store/settings.js'
import { createUser } from '../src/store/users.js'
import { createSpace } from '../src/store/spaces.js'
import {
  upsertInstance, updateInstance, getInstanceById,
} from '../src/store/instances.js'
import { reconcile, sweepIdleInstances } from '../src/orchestrator/index.js'

let docker, uid, sid
beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  sid = createSpace({ slug: 'p-aa', name: 'P', kind: 'personal', ownerId: uid })
  docker = {
    containers: [], // { Names: ['/dsh-p-aa-aa'], State: 'running'|'exited' }
    async listContainers() { return this.containers },
    getContainer(name) {
      const self = this
      return {
        async inspect() {
          const c = self.containers.find((x) => x.Names[0] === `/${name}`)
          if (!c) { const e = new Error(`no such container: ${name}`); e.statusCode = 404; throw e }
          return { State: { Running: c.State === 'running' } }
        },
        async stop() {
          const c = self.containers.find((x) => x.Names[0] === `/${name}`)
          if (c) c.State = 'exited'
        },
      }
    },
  }
  initDocker(docker)
})

test('reconcile marks vanished running/starting containers as error', async () => {
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  updateInstance(inst.id, { status: 'running' })
  await reconcile()
  assert.equal(getInstanceById(inst.id).status, 'error')
  assert.match(getInstanceById(inst.id).error, /disappeared|missing/i)
})

test('reconcile adopts actually-running containers', async () => {
  docker.containers.push({ Names: ['/dsh-p-aa-aa'], State: 'running' })
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  await reconcile()
  assert.equal(getInstanceById(inst.id).status, 'running')
})

test('sweepIdleInstances stops instances idle beyond threshold', async () => {
  setSetting('idle_stop_minutes', '60')
  docker.containers.push({ Names: ['/dsh-p-aa-aa'], State: 'running' })
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  const now = Date.now()
  updateInstance(inst.id, { status: 'running', last_active_at: now - 61 * 60 * 1000 })
  await sweepIdleInstances(now)
  assert.equal(getInstanceById(inst.id).status, 'stopped')
  // 活跃实例不动
  updateInstance(inst.id, { status: 'running', last_active_at: now })
  await sweepIdleInstances(now)
  assert.equal(getInstanceById(inst.id).status, 'running')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/orchestrator-reconcile.test.js`
Expected: FAIL — `reconcile is not exported`

- [ ] **Step 3: 实现 reconcile 与 sweep，接入启动**

`src/orchestrator/index.js` 追加：

```javascript
import { listAllInstances, listRunningInstances } from '../store/instances.js'

/** spec §5：启动时对比 SQLite 与 docker ps -a，纠正状态不一致。 */
export async function reconcile() {
  const containers = await getDocker().listContainers({ all: true })
  const byName = new Map()
  for (const c of containers) {
    const name = (c.Names?.[0] ?? '').replace(/^\//, '')
    if (name) byName.set(name, c)
  }
  for (const inst of listAllInstances()) {
    const c = byName.get(inst.container_name)
    if (!c) {
      if (inst.status === 'running' || inst.status === 'starting') {
        updateInstance(inst.id, { status: 'error', error: 'container disappeared' })
      }
    } else if (c.State === 'running' && inst.status === 'stopped') {
      updateInstance(inst.id, { status: 'running', error: null })
    }
  }
}

/** spec §5：空闲超时自动停止（阈值 settings.idle_stop_minutes，默认 60）。 */
export async function sweepIdleInstances(now = Date.now()) {
  const idleMin = Number(getSetting('idle_stop_minutes', '60'))
  const cutoff = now - idleMin * 60 * 1000
  for (const inst of listRunningInstances()) {
    const lastActive = inst.last_active_at ?? inst.created_at
    if (lastActive <= cutoff) {
      try {
        await stopInstance(inst.id)
      } catch (err) {
        console.error(`[orchestrator] idle stop failed for ${inst.container_name}:`, err?.message ?? err)
      }
    }
  }
}

export function startIdleSweep() {
  const timer = setInterval(() => {
    sweepIdleInstances().catch((err) =>
      console.error('[orchestrator] idle sweep failed:', err?.message ?? err))
  }, getConfig().idleSweepIntervalMs)
  timer.unref?.()
  return timer
}
```

`src/index.js` 在 `await verifyDockerRuntime(config)` 之后加入：

```javascript
import { ensureTenantNetwork, reconcile, startIdleSweep } from './orchestrator/index.js'
// ...
await ensureTenantNetwork()
await reconcile()
startIdleSweep()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/orchestrator-reconcile.test.js`
Expected: 3 PASS

- [ ] **Step 5: 提交**

```bash
git add src/orchestrator/index.js src/index.js test/orchestrator-reconcile.test.js
git commit -m "feat: startup reconcile and idle auto-stop sweep"
```

---

### Task 6: 个人空间惰性创建（替换 provisionNewUser stub）

**Files:**
- Modify: `src/spaces/service.js`（计划 02 的 no-op stub → 真实实现）
- Test: `test/spaces-service.test.js`

**Interfaces:**
- Consumes: store spaces/volumes、`deriveUniqueHandle`（计划 02）、`ensureVolume`/`prepareSharedVolume`（Task 3）、`writeAudit`（计划 01）。
- Produces:
  - `provisionNewUser(userId)` — 幂等：已有个人空间则直接返回 space row。被计划 02 的 OIDC 回调在用户创建后调用（接线已在计划 02 完成，本任务只替换实现）。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/spaces-service.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { createUser } from '../src/store/users.js'
import { listSpacesForUser, listSpaceMembers, getSpaceBySlug } from '../src/store/spaces.js'
import { listVolumesForSpace } from '../src/store/volumes.js'
import { listAudit } from '../src/store/audit.js'
import { provisionNewUser } from '../src/spaces/service.js'

const prepared = []
beforeEach(() => {
  prepared.length = 0
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  initDocker({
    async createVolume() { return {} },
    async createContainer(opts) {
      return { start: async () => {}, wait: async () => ({ StatusCode: 0 }) }
    },
    async listNetworks() { return [{ Name: 'dsh-tenants' }] },
  })
})

test('provisionNewUser creates personal space, volumes, owner membership, audit', async () => {
  const uid = createUser({ email: 'new@x.com', handle: 'newbie' })
  const space = await provisionNewUser(uid)
  assert.equal(space.slug, 'p-newbie')
  assert.equal(space.kind, 'personal')
  const members = listSpaceMembers(space.id)
  assert.equal(members.length, 1)
  assert.equal(members[0].role, 'owner')
  const vols = listVolumesForSpace(space.id)
  assert.deepEqual(vols.map((v) => v.docker_name).sort(),
    ['dshvol-p-newbie-newbie', 'dshvol-p-newbie-shared'])
  const audit = listAudit({ action: 'space.create' })
  assert.equal(audit.length, 1)
  assert.equal(JSON.parse(audit[0].detail_json).kind, 'personal')
})

test('provisionNewUser is idempotent and suffixes slug conflicts', async () => {
  createUser({ email: 'taken@x.com', handle: 'taken' })
  const uid = createUser({ email: 'n@x.com', handle: 'n' })
  // 手动占位 slug p-n
  const { createSpace } = await import('../src/store/spaces.js')
  createSpace({ slug: 'p-n', name: 'x', kind: 'team', ownerId: uid })
  const space = await provisionNewUser(uid)
  assert.equal(space.slug, 'p-n-2')
  const again = await provisionNewUser(uid)
  assert.equal(again.id, space.id)
  assert.equal(listSpacesForUser(uid).filter((s) => s.kind === 'personal').length, 1)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/spaces-service.test.js`
Expected: FAIL — `space.slug` 为 undefined（stub 什么都不做）

- [ ] **Step 3: 实现 provisionNewUser**

```javascript
// src/spaces/service.js（替换计划 02 的 stub）
import { getDb } from '../store/db.js'
import { getUserById } from '../store/users.js'
import {
  createSpace, getSpaceBySlug, addSpaceMember, listSpacesForUser,
} from '../store/spaces.js'
import { createVolume } from '../store/volumes.js'
import { writeAudit } from '../store/audit.js'
import { ensureVolume, prepareSharedVolume, sharedVolumeName, privateVolumeName }
  from '../orchestrator/index.js'

/**
 * spec §3：OIDC 首登后惰性创建个人空间（slug 从 handle 派生，冲突加后缀）
 * 及共享卷 + 该用户私有卷。幂等：已有个人空间直接返回。
 */
export async function provisionNewUser(userId) {
  const existing = listSpacesForUser(userId).find((s) => s.kind === 'personal')
  if (existing) return existing
  const user = getUserById(userId)
  let slug = `p-${user.handle}`
  for (let n = 2; getSpaceBySlug(slug) !== null; n += 1) slug = `p-${user.handle}-${n}`

  const spaceId = getDb().transaction(() => {
    const id = createSpace({ slug, name: `${user.display_name || user.handle} 的个人空间`, kind: 'personal', ownerId: userId })
    addSpaceMember({ spaceId: id, userId, role: 'owner' })
    createVolume({ spaceId: id, kind: 'shared', dockerName: sharedVolumeName(slug) })
    createVolume({ spaceId: id, kind: 'private', userId, dockerName: privateVolumeName(slug, user.handle) })
    return id
  })()

  // docker 侧资源在事务外创建；失败不吞——启动实例路径会再次 ensureVolume 自愈，
  // 这里失败仅影响 setgid 预置，留错日志即可。
  try {
    await ensureVolume(sharedVolumeName(slug))
    await ensureVolume(privateVolumeName(slug, user.handle))
    await prepareSharedVolume(sharedVolumeName(slug))
  } catch (err) {
    console.error(`[spaces] volume preparation for ${slug} failed:`, err?.message ?? err)
  }
  writeAudit({ actorId: userId, action: 'space.create', targetType: 'space',
    targetId: String(spaceId), detail: { kind: 'personal' } })
  return getSpaceBySlug(slug)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/spaces-service.test.js`
Expected: 2 PASS

- [ ] **Step 5: 提交**

```bash
git add src/spaces/service.js test/spaces-service.test.js
git commit -m "feat: personal space lazy provisioning on first login"
```

---

### Task 7: 空间与实例 REST API

**Files:**
- Create: `src/spaces/routes.js`
- Modify: `src/server.js`（注册 spacesRoutes）
- Test: `test/spaces-routes.test.js`

**Interfaces:**
- Consumes: `requireUser`（计划 02）、store、orchestrator 生命周期（Task 4）。
- Produces（REST 契约，计划 04/05 扩展同一插件文件）：
  - `GET /api/spaces` → `{ spaces: [{ id, slug, name, kind, memberRole, instanceStatus }] }`
  - `GET /api/spaces/:slug` → `{ space, members: [...], instance }`（成员限定）
  - `POST /api/spaces/:slug/instance/start` → `{ instance }`（幂等）
  - `POST /api/spaces/:slug/instance/stop` → `{ instance }`
  - `GET /api/spaces/:slug/instance` → `{ instance }`
  - `POST /api/spaces/:slug/instance/rebuild` → `{ instance }`

- [ ] **Step 1: 写失败的测试**

```javascript
// test/spaces-routes.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'
import { createUser } from '../src/store/users.js'
import { insertSession, SESSION_HELPER } from '../src/store/sessions.js'
import { SESSION_COOKIE } from '../src/auth/middleware.js'
import { setSetting } from '../src/store/settings.js'
import { provisionNewUser } from '../src/spaces/service.js'

let app, uid, token
beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  setSetting('image_digest', 'sha256:' + 'b'.repeat(64))
  initDocker({
    async createVolume() { return {} },
    async createContainer(opts) {
      return { start: async () => {}, wait: async () => ({ StatusCode: 0 }) }
    },
    async listNetworks() { return [{ Name: 'dsh-tenants' }] },
    async listContainers() { return [] },
  })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  token = 'a'.repeat(64)
  insertSession({ token, userId: uid })
  await provisionNewUser(uid)
})

const auth = () => ({ cookies: { [SESSION_COOKIE]: token } })

test('GET /api/spaces lists my personal space', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/spaces', ...auth() })
  assert.equal(res.statusCode, 200)
  const { spaces } = res.json()
  assert.equal(spaces.length, 1)
  assert.equal(spaces[0].slug, 'p-aa')
  assert.equal(spaces[0].kind, 'personal')
  assert.equal(spaces[0].instanceStatus, null)
})

test('GET /api/spaces/:slug 404s for non-member without leaking', async () => {
  const other = createUser({ email: 'b@x.com', handle: 'bb' })
  await provisionNewUser(other)
  const res = await app.inject({ method: 'GET', url: '/api/spaces/p-bb', ...auth() })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'NOT_FOUND')
})

test('instance start requires auth; anonymous gets 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/spaces/p-aa/instance/start' })
  assert.equal(res.statusCode, 401)
})

test('start converges duplicate requests to one instance row', async () => {
  // startInstance 的真实编排已由 Task 4 覆盖；这里 stub 掉实际启动，
  // 通过错误路径验证行收敛与状态返回：
  const r1 = await app.inject({ method: 'POST', url: '/api/spaces/p-aa/instance/start', ...auth() })
  // 假 docker 无健康服务 → 最终 error，但行必须存在且唯一
  const r2 = await app.inject({ method: 'GET', url: '/api/spaces/p-aa/instance', ...auth() })
  assert.equal(r2.statusCode, 200)
  assert.ok(r2.json().instance.id)
  assert.equal(r1.json().instance.id, r2.json().instance.id)
})

test('stop on never-started instance is a clean no-op-ish 200', async () => {
  await app.inject({ method: 'POST', url: '/api/spaces/p-aa/instance/start', ...auth() })
  const res = await app.inject({ method: 'POST', url: '/api/spaces/p-aa/instance/stop', ...auth() })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().instance.status, 'stopped')
})
```

注：`SESSION_HELPER` 导入若不存在则删掉该行（笔误防护；以计划 02 的实际导出为准——只依赖 `insertSession` 与 `SESSION_COOKIE`）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/spaces-routes.test.js`
Expected: FAIL — 404 on `/api/spaces`（路由未注册）

- [ ] **Step 3: 实现 routes.js 并注册**

```javascript
// src/spaces/routes.js
import { z } from 'zod'
import { apiError } from '../server.js'
import { requireUser } from '../auth/middleware.js'
import { writeAudit } from '../store/audit.js'
import {
  getSpaceBySlug, getSpaceMember, listSpacesForUser, listSpaceMembers,
} from '../store/spaces.js'
import {
  getInstance, upsertInstance, getInstanceById,
} from '../store/instances.js'
import { containerNameFor, startInstance, stopInstance, rebuildInstance }
  from '../orchestrator/index.js'

const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) })

function publicInstance(inst) {
  if (!inst) return null
  const { id, status, error, image_digest, last_active_at, port } = inst
  return { id, status, error, imageDigest: image_digest, lastActiveAt: last_active_at, port }
}

/** 成员限定解析；非成员 404（不泄露空间存在性）。 */
function requireMembership(req) {
  const space = getSpaceBySlug(req.params.slug)
  if (!space) throw apiError(404, 'NOT_FOUND', '空间不存在')
  const member = getSpaceMember(space.id, req.user.id)
  if (!member) throw apiError(404, 'NOT_FOUND', '空间不存在')
  return { space, member }
}

export async function spacesRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.get('/', async (req) => {
    const spaces = listSpacesForUser(req.user.id).map((s) => ({
      id: s.id, slug: s.slug, name: s.name, kind: s.kind, memberRole: s.member_role,
      instanceStatus: getInstance(s.id, req.user.id)?.status ?? null,
    }))
    return { spaces }
  })

  app.get('/:slug', { schema: { params: slugParams } }, async (req) => {
    const { space, member } = requireMembership(req)
    return {
      space: {
        id: space.id, slug: space.slug, name: space.name, kind: space.kind,
        memberRole: member.role,
      },
      members: listSpaceMembers(space.id).map((m) => ({
        userId: m.user_id, email: m.email, handle: m.handle,
        displayName: m.display_name, role: m.role,
      })),
      instance: publicInstance(getInstance(space.id, req.user.id)),
    }
  })

  app.post('/:slug/instance/start', { schema: { params: slugParams } }, async (req) => {
    const { space } = requireMembership(req)
    const inst = upsertInstance({
      spaceId: space.id, userId: req.user.id,
      containerName: containerNameFor(space.slug, req.user.handle),
    })
    const result = await startInstance(inst.id)
    writeAudit({ actorId: req.user.id, action: 'instance.start',
      targetType: 'instance', targetId: String(inst.id) })
    return { instance: publicInstance(result) }
  })

  app.post('/:slug/instance/stop', { schema: { params: slugParams } }, async (req) => {
    const { space } = requireMembership(req)
    const inst = getInstance(space.id, req.user.id)
    if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
    const result = await stopInstance(inst.id)
    writeAudit({ actorId: req.user.id, action: 'instance.stop',
      targetType: 'instance', targetId: String(inst.id) })
    return { instance: publicInstance(result) }
  })

  app.get('/:slug/instance', { schema: { params: slugParams } }, async (req) => {
    const { space } = requireMembership(req)
    return { instance: publicInstance(getInstance(space.id, req.user.id)) }
  })

  app.post('/:slug/instance/rebuild', { schema: { params: slugParams } }, async (req) => {
    const { space } = requireMembership(req)
    const inst = getInstance(space.id, req.user.id)
    if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
    const result = await rebuildInstance(inst.id)
    writeAudit({ actorId: req.user.id, action: 'instance.rebuild',
      targetType: 'instance', targetId: String(inst.id) })
    return { instance: publicInstance(result) }
  })
}
```

`src/server.js` 的 `buildServer` 中（auth 注册之后）加入：

```javascript
import { spacesRoutes } from './spaces/routes.js'
// ...
await app.register(spacesRoutes, { prefix: '/api/spaces' })
```

注意 `getInstanceById` 在本文件未用则不要 import（lint 整洁）。计划 05 会向本文件追加团队空间路由（POST `/`、成员管理、DELETE `/:slug`）——注册点不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/spaces-routes.test.js`
Expected: 5 PASS

- [ ] **Step 5: 提交**

```bash
git add src/spaces/routes.js src/server.js test/spaces-routes.test.js
git commit -m "feat: spaces and instance lifecycle REST api"
```

---

### Task 8: 前端空间列表与详情页

**Files:**
- Create: `src/web/src/pages/SpaceList.tsx`
- Create: `src/web/src/pages/SpaceDetail.tsx`
- Modify: `src/web/src/App.tsx`（路由）

**Interfaces:**
- Consumes: `apiFetch`/`ApiRequestError`/`useMe`/`RequireAuth`（计划 02）、Task 7 的 REST 契约。
- Produces: 路由 `/`（空间列表）与 `/spaces/:slug`（详情）。"打开" 链接指向 `/s/<slug>/<handle>/`（计划 04 网关就绪前 404，属预期）。

- [ ] **Step 1: 写页面组件**

```tsx
// src/web/src/pages/SpaceList.tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api'

interface SpaceRow {
  id: number
  slug: string
  name: string
  kind: 'personal' | 'team'
  memberRole: 'owner' | 'member'
  instanceStatus: string | null
}

const STATUS_TEXT: Record<string, string> = {
  stopped: '已停止', starting: '启动中', running: '运行中', error: '异常',
}

export default function SpaceList() {
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    apiFetch<{ spaces: SpaceRow[] }>('/api/spaces')
      .then((r) => setSpaces(r.spaces))
      .catch((e) => setError(e.message))
  }, [])
  if (error) return <main className="page"><p role="alert">加载失败：{error}</p></main>
  if (!spaces) return <main className="page"><p>加载中…</p></main>
  const personal = spaces.filter((s) => s.kind === 'personal')
  const team = spaces.filter((s) => s.kind === 'team')
  const renderTable = (rows: SpaceRow[]) => (
    <table>
      <thead>
        <tr><th>名称</th><th>标识</th><th>角色</th><th>我的实例</th></tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td><Link to={`/spaces/${s.slug}`}>{s.name}</Link></td>
            <td className="mono">{s.slug}</td>
            <td>{s.memberRole === 'owner' ? '所有者' : '成员'}</td>
            <td>{s.instanceStatus ? STATUS_TEXT[s.instanceStatus] : '未创建'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  return (
    <main className="page">
      <h1 className="title">空间</h1>
      <h2>个人空间</h2>
      {renderTable(personal)}
      <h2>团队空间</h2>
      {team.length ? renderTable(team) : <p className="body">还没有加入任何团队空间。</p>}
    </main>
  )
}
```

```tsx
// src/web/src/pages/SpaceDetail.tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiRequestError } from '../api'
import { useMe } from '../components/RequireAuth'

interface Instance {
  id: number
  status: 'stopped' | 'starting' | 'running' | 'error'
  error: string | null
  imageDigest: string | null
}

interface Detail {
  space: { id: number; slug: string; name: string; kind: string; memberRole: string }
  members: { userId: number; email: string; handle: string; displayName: string; role: string }[]
  instance: Instance | null
}

const STATUS_TEXT: Record<string, string> = {
  stopped: '已停止', starting: '启动中', running: '运行中', error: '异常',
}

export default function SpaceDetail() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useMe()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => apiFetch<Detail>(`/api/spaces/${slug}`).then(setDetail)
  useEffect(() => { load().catch((e) => setError(e.message)) }, [slug])

  // starting 状态每 3 秒轮询（spec §8：动效只表达状态变化）
  useEffect(() => {
    if (detail?.instance?.status !== 'starting') return
    const t = setInterval(() => { load().catch(() => {}) }, 3000)
    return () => clearInterval(t)
  }, [detail?.instance?.status, slug])

  if (error) return <main className="page"><p role="alert">加载失败：{error}</p></main>
  if (!detail) return <main className="page"><p>加载中…</p></main>
  const { space, members, instance } = detail

  const action = async (verb: 'start' | 'stop' | 'rebuild') => {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/spaces/${slug}/instance/${verb}`, { method: 'POST' })
      await load()
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h1 className="title">{space.name}</h1>
      <p className="body mono">{space.slug}</p>

      <h2>我的实例</h2>
      <p>
        状态：{instance ? STATUS_TEXT[instance.status] : '未创建'}
        {instance?.error ? <span role="alert">（{instance.error}）</span> : null}
      </p>
      <p>
        <button disabled={busy || instance?.status === 'running' || instance?.status === 'starting'}
          onClick={() => action('start')}>启动</button>{' '}
        <button disabled={busy || !instance || instance.status !== 'running'}
          onClick={() => action('stop')}>停止</button>{' '}
        <button disabled={busy || !instance} onClick={() => action('rebuild')}>重建</button>{' '}
        {instance?.status === 'running' && user ? (
          <a href={`/s/${space.slug}/${user.handle}/`}>打开</a>
        ) : null}
      </p>

      <h2>成员</h2>
      <table>
        <thead><tr><th>邮箱</th><th>标识</th><th>角色</th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>{m.email}</td>
              <td className="mono">{m.handle}</td>
              <td>{m.role === 'owner' ? '所有者' : '成员'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

```tsx
// src/web/src/App.tsx（替换计划 01 占位）
import { Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import RequireAuth from './components/RequireAuth'
import SpaceList from './pages/SpaceList'
import SpaceDetail from './pages/SpaceDetail'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><SpaceList /></RequireAuth>} />
      <Route path="/spaces/:slug" element={<RequireAuth><SpaceDetail /></RequireAuth>} />
    </Routes>
  )
}
```

（`RequireAuth` 的默认导出形式以计划 02 实际代码为准；若它是命名导出则改为 `import { RequireAuth } from ...`。）

- [ ] **Step 2: 类型检查与构建**

Run: `npm run build:web`
Expected: 无 TS 错误，构建成功

- [ ] **Step 3: 提交**

```bash
git add src/web/src/pages src/web/src/App.tsx
git commit -m "feat: space list and detail pages"
```

---

### Task 9: 镜像构建管线移植（build-image.sh + image/）

**Files:**
- Create: `scripts/build-image.sh`
- Create: `scripts/set-image-digest.js`
- Create: `image/Dockerfile`
- Create: `image/start.sh`
- Create: `image/dsh-security.patch`（从 portal 复制）
- Create: `.dockerignore`
- Create: `dsh/README.md`（占位说明，真实 clone 见文件内容）
- Test: `test/set-image-digest.test.js`

**Interfaces:**
- Consumes: portal 仓库文件（开发机上位于 `../deepseek-harness-portal/`；复制后与原仓库脱钩）。
- Produces:
  - `npm run build:image` → 走完整安全校验后 `docker build`，输出 `sha256:` digest。
  - `node scripts/set-image-digest.js <sha256:...>` → 写入 `settings.image_digest`。
  - 环境旋钮（计划 07 安全回归测试依赖，属显式交接）：`DSH_DIR`（默认 `./dsh`）、`IMAGE_DIR`（默认 `./image`）、`DOCKER_BUILD=false`（跑完全部校验但跳过 docker build/tag/inspect）。

- [ ] **Step 1: 复制 portal 资产**

```bash
mkdir -p image scripts
cp ../deepseek-harness-portal/image/dsh-security.patch image/dsh-security.patch
```

- [ ] **Step 2: 写失败的 set-image-digest 测试**

```javascript
// test/set-image-digest.test.js
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('set-image-digest validates format and writes settings', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-data-'))
  const digest = 'sha256:' + 'c'.repeat(64)
  execFileSync('node', ['scripts/set-image-digest.js', digest],
    { env: { ...process.env, DATA_DIR: dataDir } })
  const out = execFileSync('node', ['scripts/set-image-digest.js'],
    { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' })
  assert.match(out, new RegExp(digest))
})

test('set-image-digest rejects non-digest input', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-data-'))
  assert.throws(() =>
    execFileSync('node', ['scripts/set-image-digest.js', 'dsh:latest'],
      { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'pipe' }))
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run test/set-image-digest.test.js`
Expected: FAIL — 脚本不存在

- [ ] **Step 4: 实现全部管线文件**

```javascript
// scripts/set-image-digest.js
// 用法：node scripts/set-image-digest.js <sha256:digest>   写入 settings.image_digest
//       node scripts/set-image-digest.js                  打印当前值
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'
import { initDb } from '../src/store/db.js'
import { getSetting, setSetting } from '../src/store/settings.js'

const config = loadConfig()
initDb(join(config.dataDir, 'dsh-spaces.db'))
const arg = process.argv[2]
if (!arg) {
  console.log(getSetting('image_digest') || '(unset)')
  process.exit(0)
}
if (!/^sha256:[a-f0-9]{64}$/.test(arg)) {
  console.error('error: digest must match sha256:<64 lowercase hex>')
  process.exit(1)
}
setSetting('image_digest', arg)
console.log(`image_digest=${arg}`)
```

```bash
#!/bin/bash
# scripts/build-image.sh — 从批准的上游 commit 构建 dsh 镜像（移植自 portal，podman→docker）。
# 安全校验顺序：固定 commit → 工作区干净 → patch 可应用 → .dockerignore 白名单
# → git archive 干净上下文 → docker build → 输出不可变 sha256 digest。
# 环境旋钮（测试用）：DSH_DIR / IMAGE_DIR / DOCKER_BUILD=false（跳过构建只跑校验）。
set -euo pipefail
cd "$(dirname "$0")/.."

APPROVED_DSH_COMMIT='47f943859bef60e4160492346772ded9b24f765a'
IMAGE_TAG='dsh:47f9438-node24'
DSH_DIR="${DSH_DIR:-dsh}"
IMAGE_DIR="${IMAGE_DIR:-image}"
DOCKER_BUILD="${DOCKER_BUILD:-true}"

if [ ! -f "$DSH_DIR/package.json" ]; then
  echo "error: $DSH_DIR clone missing. See dsh/README.md for the pinned clone commands." >&2
  exit 1
fi
ACTUAL_DSH_COMMIT=$(git -C "$DSH_DIR" rev-parse HEAD)
if [ "$ACTUAL_DSH_COMMIT" != "$APPROVED_DSH_COMMIT" ]; then
  echo "error: dsh commit $ACTUAL_DSH_COMMIT is not approved $APPROVED_DSH_COMMIT" >&2
  exit 1
fi
if [ -n "$(git -C "$DSH_DIR" status --porcelain --untracked-files=all)" ]; then
  echo "error: dsh contains tracked or untracked changes; reset to the approved commit" >&2
  exit 1
fi
for patch in dsh-security.patch dsh-base-path.patch; do
  [ -s "$IMAGE_DIR/$patch" ] || { echo "error: $IMAGE_DIR/$patch missing" >&2; exit 1; }
  git -C "$DSH_DIR" apply --check "../$IMAGE_DIR/$patch" \
    || { echo "error: $IMAGE_DIR/$patch does not apply cleanly" >&2; exit 1; }
done

# deny-by-default 的 .dockerignore 只允许这些 re-inclusion。
expected_includes=(
  '!dsh/' '!dsh/**' '!image/' '!image/Dockerfile' '!image/start.sh'
  '!image/dsh-security.patch' '!image/dsh-base-path.patch'
)
mapfile -t actual_includes < <(grep '^!' .dockerignore)
if [ "${#actual_includes[@]}" -ne "${#expected_includes[@]}" ]; then
  echo 'error: .dockerignore contains an unexpected build-context inclusion' >&2
  exit 1
fi
for i in "${!expected_includes[@]}"; do
  if [ "${actual_includes[$i]}" != "${expected_includes[$i]}" ]; then
    echo "error: unexpected .dockerignore inclusion: ${actual_includes[$i]}" >&2
    exit 1
  fi
done

# 从 git archive 构建，绝不用工作区目录——本地凭据/生成文件无法混入上下文。
CONTEXT=$(mktemp -d)
cleanup() { rm -rf "$CONTEXT"; }
trap cleanup EXIT
mkdir -p "$CONTEXT/dsh" "$CONTEXT/image"
git -C "$DSH_DIR" archive "$APPROVED_DSH_COMMIT" | tar -x -C "$CONTEXT/dsh"
cp "$IMAGE_DIR/Dockerfile" "$IMAGE_DIR/start.sh" \
   "$IMAGE_DIR/dsh-security.patch" "$IMAGE_DIR/dsh-base-path.patch" "$CONTEXT/image/"
cp .dockerignore "$CONTEXT/.dockerignore"

if [ "$DOCKER_BUILD" != 'true' ]; then
  echo "checks passed (DOCKER_BUILD=$DOCKER_BUILD, skipping docker build)"
  exit 0
fi

docker build --pull=always -t "$IMAGE_TAG" -f "$CONTEXT/image/Dockerfile" "$CONTEXT"
docker tag "$IMAGE_TAG" dsh:latest   # 仅本地检查用；编排只按 digest 启动
IMAGE_ID="$(docker image inspect "$IMAGE_TAG" --format '{{.Id}}')"
echo "built $IMAGE_TAG from $APPROVED_DSH_COMMIT"
echo "set this immutable deployment reference:"
echo "  node scripts/set-image-digest.js $IMAGE_ID"
```

```
# .dockerignore — deny-by-default；白名单漂移即构建失败（build-image.sh 校验）
*
!dsh/
!dsh/**
!image/
!image/Dockerfile
!image/start.sh
!image/dsh-security.patch
!image/dsh-base-path.patch
```

```dockerfile
# image/Dockerfile — dsh 单实例容器（移植自 portal，新增 base-path patch）。
# 构建时 patch：
#   1. dsh-security.patch     — 依赖层安全补丁（portal 原有）
#   2. dsh-base-path.patch    — 新增：`dsh web --base-path` 支持（Task 10 生成）
# 另有两处 sed 校验式替换：harness 身份文案、放开 --host 0.0.0.0 限制
# （容器内只有 docker 发布的 loopback 端口可达）。
FROM node:24-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d

RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/dsh

COPY dsh/ ./
COPY image/dsh-security.patch /tmp/dsh-security.patch
COPY image/dsh-base-path.patch /tmp/dsh-base-path.patch
RUN git init . \
 && git apply --check /tmp/dsh-security.patch \
 && git apply /tmp/dsh-security.patch \
 && git apply --check /tmp/dsh-base-path.patch \
 && git apply /tmp/dsh-base-path.patch \
 && rm /tmp/dsh-security.patch /tmp/dsh-base-path.patch

RUN set -eux; \
    identity='packages/core/system-prompt/src/index.ts'; \
    startup='packages/bundle/web-app/src/startup.ts'; \
    test "$(grep -Fxc "        text: 'You are an AI agent powered by DeepSeek Harness.'," "$identity")" -eq 1; \
    test "$(grep -Fxc "    if (options.host === '0.0.0.0') {" "$startup")" -eq 1; \
    sed -i "s/text: 'You are an AI agent powered by DeepSeek Harness.'/text: 'You are an AI agent.'/" "$identity"; \
    sed -i "s/options.host === '0.0.0.0'/false/" "$startup"; \
    ! grep -Fq "You are an AI agent powered by DeepSeek Harness." "$identity"; \
    grep -Fq "text: 'You are an AI agent.'" "$identity"; \
    ! grep -Fq "options.host === '0.0.0.0'" "$startup"; \
    grep -Fq 'if (false) {' "$startup"

RUN corepack enable \
 && pnpm install --frozen-lockfile \
 && pnpm audit --prod \
 && pnpm run build

RUN useradd -m -s /bin/bash dsh \
 && mkdir -p /workspace/shared /home/dsh/.dsh \
 && chown -R dsh:dsh /workspace /home/dsh/.dsh

USER dsh
ENV HOME=/home/dsh \
    DSH_HOME=/home/dsh/.dsh
WORKDIR /workspace

EXPOSE 3000

COPY image/start.sh /start.sh
ENTRYPOINT ["/bin/bash", "/start.sh"]
```

```bash
#!/bin/bash
# image/start.sh — BASE_PATH 非空时透传 --base-path（网关路径反代，spec §5）。
set -euo pipefail

PORT="${PORT:-3000}"
ARGS=(web --host 0.0.0.0 --port "$PORT")
if [ -n "${TRUSTED_HOST:-}" ]; then
  ARGS+=(--trusted-host "$TRUSTED_HOST")
fi
if [ -n "${BASE_PATH:-}" ]; then
  ARGS+=(--base-path "$BASE_PATH")
fi

cd /app/dsh
exec node --import tsx/esm apps/cli/src/bin.ts "${ARGS[@]}"
```

```markdown
<!-- dsh/README.md — 占位；dsh/ 被 .gitignore 排除 -->
# dsh 上游检出货架

按批准的 commit 克隆上游源码（build-image.sh 校验 commit 一致）：

    git clone <上游仓库 URL> dsh
    git -C dsh checkout 47f943859bef60e4160492346772ded9b24f765a
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run test/set-image-digest.test.js`
Expected: 2 PASS

- [ ] **Step 6: 提交**

```bash
git add scripts image .dockerignore dsh/README.md test/set-image-digest.test.js
git commit -m "feat: dsh image build pipeline ported to docker"
```

---

### Task 10: dsh `--base-path` 上游 patch

**Files:**
- Create: `image/dsh-base-path.patch`（产物）
- Modify: 无仓库文件（工作发生在 `dsh/` 上游检出内，最终以 patch 形式落库）

**Interfaces:**
- Consumes: Task 9 的管线（`git apply --check` 是验收门）、`image/start.sh` 的 `--base-path` 透传。
- Produces: `image/dsh-base-path.patch` —— 使 `dsh web --base-path <path>` 把 Web UI 的资源、API、WebSocket URL 全部置于该前缀下（spec §5：路径路由与 dsh 适配）。

**本任务特殊性：** patch 的具体 diff 取决于固定上游 commit 的源码，需在 `dsh/` 检出中迭代开发后导出。步骤给出精确锚点与不变量；`git apply --check` + curl 实测是验收标准。

- [ ] **Step 1: 准备上游工作区**

```bash
git -C dsh checkout 47f943859bef60e4160492346772ded9b24f765a
git -C dsh status --porcelain   # 必须为空
```

- [ ] **Step 2: 按锚点定位并修改（`dsh/` 工作区内）**

锚点与不变量：

1. `packages/bundle/web-app/src/startup.ts`：在 `--host`/`--port`/`--trusted-host` 旁新增 `.option('--base-path <path>', 'serve the web app under this absolute path prefix (e.g. /s/space/user)')`；校验以 `/` 开头、不以 `/` 结尾；把值发布进 `WebStartupValues`（新增 `basePath?: string` 字段，与 `host`/`port` 同模式）。
2. `packages/host/webserver/src/index.ts`：路由分发处支持 base path——二选一实现：(a) 请求入口先把 `basePath` 前缀从 `req.url` 剥离再匹配路由（推荐，路由注册零改动）；非前缀内请求返回 404。(b) 注册时统一加前缀。升级（WebSocket）分发同样处理。
3. 客户端引导：`packages/client/web/src/boot.ts`、`packages/client/modules/src/client/manifest.ts` 与 `window.__DSH_BOOT__` 注入（`renderIndexInjections`）——把 basePath 注入 boot manifest，客户端所有绝对路径请求（`/api/...`、WS URL、模块 bundle URL）以 basePath 为前缀。注意 `apps/web/vite.config.ts` 已用 `base: './'`（相对资源 URL），静态资产通常无需改动——重点核查 fetch/WebSocket 的绝对路径。
4. 不变量（验收时逐条 curl 验证）：
   - `GET <base>/` 返回 index.html（200）
   - `GET <base>/api/...` 正常响应；`GET /api/...`（无前缀）404
   - index 内资源引用、boot manifest 请求均落在 `<base>/` 之下
   - WebSocket 握手路径带前缀且可升级

- [ ] **Step 3: 本地实测**

```bash
cd dsh && pnpm install --frozen-lockfile && pnpm run build
pnpm dsh web --base-path /s/test/u --port 3999 &
curl -sf http://127.0.0.1:3999/s/test/u/ | head -5        # 200 + index
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3999/api/health   # 404（无前缀拒绝）
kill %1
```

Expected: 三条均符合不变量；不符则回到 Step 2 修正。

- [ ] **Step 4: 导出 patch 并还原工作区**

```bash
git -C dsh diff > ../image/dsh-base-path.patch
git -C dsh checkout -- . && git -C dsh clean -fd
git -C dsh status --porcelain   # 必须为空（build-image.sh 的干净校验依赖于此）
```

- [ ] **Step 5: 管线验收**

Run: `DOCKER_BUILD=false bash scripts/build-image.sh`
Expected: 输出 `checks passed`（commit/干净树/双 patch `git apply --check`/白名单全部通过）

- [ ] **Step 6: 提交**

```bash
git add image/dsh-base-path.patch
git commit -m "feat: dsh --base-path patch for path-based routing"
```

---

### Task 11: 全量回归

**Files:**
- Modify: 无（仅验证）

- [ ] **Step 1: 全部服务端测试**

Run: `npm test`
Expected: 全部 PASS（计划 01 的 16 + 计划 02 + 本计划新增）

- [ ] **Step 2: 前端构建**

Run: `npm run build:web`
Expected: 无 TS 错误

- [ ] **Step 3: 管线干跑**

Run: `DOCKER_BUILD=false bash scripts/build-image.sh`（需要 `dsh/` 检出在位）
Expected: `checks passed`

- [ ] **Step 4: 无需提交；若有回归修复则单独 commit**
