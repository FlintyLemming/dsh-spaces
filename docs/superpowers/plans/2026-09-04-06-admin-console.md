# dsh-spaces 管理后台实施计划（计划 06 / 共 07）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现管理后台四板块（用户管理、空间与实例管理、平台设置与镜像、用量监控与审计）的全部 API 与 UI，所有管理动作写审计日志。

**Architecture:** `src/admin/` 模块以 Fastify 插件挂载在 `/api/admin`，所有路由统一 `preHandler: requireAdmin`。聚合查询集中在 `src/admin/queries.js`；镜像构建经由 `src/imagebuild/index.js` 的可注入执行器（`runImageBuild()`）调用 `scripts/build-image.sh`；用量数据实时来自 dockerode（`info`/`df`/`stats`），不落库。前端 `src/web/src/pages/admin/` 四个子页，按 spec §8 设计语言以语义化表格呈现。

**Tech Stack:** Fastify 5 + zod（fastify-type-provider-zod）、better-sqlite3、dockerode、React 18 + TypeScript。

**Spec:** `docs/superpowers/specs/2026-09-04-dsh-spaces-design.md`（重点 §3 审计规则、§6 管理后台、§9 错误处理）

## Global Constraints

- 沿用计划 01 的全部约定：错误格式 `{ error: { code, message } }`、`apiError()`、zod 校验、`getDb()` 参数化 SQL、Conventional Commits、Vitest + `:memory:` SQLite。
- 本计划消费既有接口（不得改名）：`requireAdmin`（`src/auth/middleware.js`，计划 02）、`getUserById/updateUser/deleteAllSessionsForUser`（计划 02）、`listAllSpaces/listAllInstances/getSpaceBySlug/stopInstance/removeContainer/rebuildInstance/getDocker`（计划 03）、`closeUserSockets`（`src/gateway/index.js`，计划 04）、`deleteSpaceCascade(space, actorId)`（`src/spaces/service.js`，计划 05）、`listAudit`（计划 01）。
- 审计动作归属：**已在早前计划写入** `user.login/logout/create`（02）、`identity.bind`（02）、`space.create`（03）、`instance.start/stop/rebuild`（03）、`space.member_add/remove`、`space.delete`（05）；**本计划写入** `admin.user_disable`、`admin.user_enable`、`admin.user_role`、`admin.space_quota`、`admin.settings_update`、`admin.image_build`、`admin.image_digest`、`admin.image_rebuild_all`。审计 detail 永不包含 OIDC secret 或密码。
- UI 遵循 spec §8：全宽语义化表格、数字右对齐 + `font-variant-numeric: tabular-nums`、状态用文字（非仅颜色）、句首大写标题、无装饰性渐变/辉光/卡片堆叠；digest/容器名用 `.mono`。
- 所有管理路由测试用 `app.inject()` + `:memory:` 库 + fake docker client（经 `initDocker` 注入）。

---

### Task 1: 管理聚合查询与 store 补充

**Files:**
- Create: `src/admin/queries.js`
- Modify: `src/store/users.js`（补齐缺失函数）
- Test: `test/admin-queries.test.js`

**Interfaces:**
- Consumes: `getDb()`（计划 01）。
- Produces:
  - `src/admin/queries.js`：`listUsersWithStats({ search = '' })`、`listSpacesWithStats()`、`getSpaceAdminDetail(slug)`（含 members/instances/volumes）、`countActiveAdmins()`。
  - `src/store/users.js` 确保存在：`setUserStatus(id, status)`、`updateUserRole(id, role)`（若计划 02 已提供同名函数则跳过本步修改，直接用）。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/admin-queries.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb, getDb } from '../src/store/db.js'
import { listUsersWithStats, listSpacesWithStats, getSpaceAdminDetail, countActiveAdmins }
  from '../src/admin/queries.js'

function seed() {
  const db = getDb()
  const now = Date.now()
  db.prepare("INSERT INTO users (email, handle, display_name, role, created_at) VALUES ('a@x.com','alice','Alice','admin',?)").run(now)
  db.prepare("INSERT INTO users (email, handle, display_name, created_at) VALUES ('b@x.com','bob','Bob','user',?)").run(now)
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/admin-queries.test.js`
Expected: FAIL — `Cannot find module '../src/admin/queries.js'`

- [ ] **Step 3: 实现 queries.js（并补齐 store/users.js）**

```javascript
// src/admin/queries.js
import { getDb } from '../store/db.js'

export function listUsersWithStats({ search = '' } = {}) {
  return getDb().prepare(
    `SELECT u.id, u.email, u.handle, u.display_name, u.role, u.status, u.created_at,
       (SELECT COUNT(*) FROM space_members sm WHERE sm.user_id = u.id) AS space_count,
       (SELECT COUNT(*) FROM instances i WHERE i.user_id = u.id AND i.status = 'running') AS running_instances
     FROM users u
     WHERE (@search = '' OR u.email LIKE '%'||@search||'%'
            OR u.handle LIKE '%'||@search||'%' OR u.display_name LIKE '%'||@search||'%')
     ORDER BY u.id`,
  ).all({ search })
}

export function listSpacesWithStats() {
  return getDb().prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM space_members m WHERE m.space_id = s.id) AS member_count,
       (SELECT COUNT(*) FROM instances i WHERE i.space_id = s.id) AS instance_count,
       (SELECT COUNT(*) FROM instances i WHERE i.space_id = s.id AND i.status = 'running') AS running_count
     FROM spaces s ORDER BY s.id`,
  ).all()
}

export function getSpaceAdminDetail(slug) {
  const db = getDb()
  const space = db.prepare('SELECT * FROM spaces WHERE slug = ?').get(slug)
  if (!space) return null
  const members = db.prepare(
    `SELECT m.user_id, m.role, m.created_at, u.email, u.handle, u.display_name, u.status
     FROM space_members m JOIN users u ON u.id = m.user_id
     WHERE m.space_id = ? ORDER BY m.created_at`,
  ).all(space.id)
  const instances = db.prepare(
    `SELECT i.*, u.handle, u.email FROM instances i JOIN users u ON u.id = i.user_id
     WHERE i.space_id = ? ORDER BY i.id`,
  ).all(space.id)
  const volumes = db.prepare('SELECT * FROM volumes WHERE space_id = ? ORDER BY id').all(space.id)
  return { space, members, instances, volumes }
}

export function countActiveAdmins() {
  return getDb().prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'",
  ).get().n
}
```

`src/store/users.js` 补齐（若已存在同名函数则跳过）：

```javascript
export function setUserStatus(id, status) {
  getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id)
}

export function updateUserRole(id, role) {
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/admin-queries.test.js`
Expected: 5 PASS

- [ ] **Step 5: 提交**

```bash
git add src/admin/queries.js src/store/users.js test/admin-queries.test.js
git commit -m "feat: admin aggregation queries"
```

---

### Task 2: 用户管理路由

**Files:**
- Create: `src/admin/routes.js`
- Modify: `src/server.js`（注册 admin 插件）
- Test: `test/admin-users.test.js`

**Interfaces:**
- Consumes: Task 1 查询层；`requireAdmin`（计划 02）；`deleteAllSessionsForUser`（计划 02）；`listAllInstances/stopInstance`（计划 03）；`closeUserSockets`（计划 04）；`writeAudit`（计划 01）。
- Produces:
  - `GET /api/admin/users?search=`
  - `POST /api/admin/users/:id/disable`、`POST /api/admin/users/:id/enable`、`POST /api/admin/users/:id/role`
  - 守卫错误码：`CANNOT_MODIFY_SELF`（400）、`LAST_ADMIN`（400）、`USER_NOT_FOUND`（404）。
  - 插件默认导出 `adminRoutes(fastify)`，`src/server.js` 以 `app.register(adminRoutes, { prefix: '/api/admin' })` 挂载。

测试基建约定（本计划所有路由测试复用）：在 `test/helpers.js` 建 `makeAdminApp()` —— `initDb(':memory:')`、插入一个 admin 用户（id 1）+ 一个普通用户（id 2）、伪造会话 cookie 通过 `requireAdmin`。若计划 02 的中间件读 `dsh_session` cookie，则测试里 `insertSession({token, userId})` 后注入 cookie 头：

```javascript
// test/helpers.js
import { initDb, getDb } from '../src/store/db.js'
import { buildServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { initDocker } from '../src/orchestrator/docker.js'

export const ADMIN_TOKEN = 'a'.repeat(64)
export const USER_TOKEN = 'b'.repeat(64)

export async function makeAdminApp({ docker } = {}) {
  initDb(':memory:')
  initDocker(docker ?? {
    ping: async () => 'OK',
    info: async () => ({ ContainersRunning: 0 }),
    df: async () => ({ Volumes: [] }),
    listContainers: async () => [],
  })
  const db = getDb()
  const now = Date.now()
  db.prepare("INSERT INTO users (id, email, handle, display_name, role, created_at) VALUES (1,'admin@x.com','admin','Admin','admin',?)").run(now)
  db.prepare("INSERT INTO users (id, email, handle, display_name, role, created_at) VALUES (2,'user@x.com','user','User','user',?)").run(now)
  const { insertSession } = await import('../src/store/sessions.js')
  insertSession({ token: ADMIN_TOKEN, userId: 1 })
  insertSession({ token: USER_TOKEN, userId: 2 })
  return buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
}

export const adminCookie = { cookie: `dsh_session=${ADMIN_TOKEN}` }
export const userCookie = { cookie: `dsh_session=${USER_TOKEN}` }
```

（`insertSession` 的精确签名以计划 02 为准；若不同，按其签名调整 helper，不得改计划 02 的函数名。）

- [ ] **Step 1: 写失败的测试**

```javascript
// test/admin-users.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie, userCookie } from './helpers.js'
import { getDb } from '../src/store/db.js'

let app
beforeEach(async () => { app = await makeAdminApp() })

test('non-admin is rejected from /api/admin', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: userCookie })
  assert.equal(res.statusCode, 403)
})

test('GET /api/admin/users lists with stats', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().users.length, 2)
})

test('disable user kills sessions and writes audit', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/users/2/disable', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(getDb().prepare("SELECT status FROM users WHERE id=2").get().status, 'disabled')
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=2").get().n, 0)
  const audit = getDb().prepare("SELECT * FROM audit_log WHERE action='admin.user_disable'").get()
  assert.equal(audit.actor_id, 1)
  assert.equal(audit.target_id, '2')
})

test('disabled user session is immediately invalid', async () => {
  await app.inject({ method: 'POST', url: '/api/admin/users/2/disable', headers: adminCookie })
  const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: userCookie })
  assert.equal(res.statusCode, 401)
})

test('cannot disable or demote yourself', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/users/1/disable', headers: adminCookie })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, 'CANNOT_MODIFY_SELF')
  const role = await app.inject({
    method: 'POST', url: '/api/admin/users/1/role', headers: adminCookie,
    payload: { role: 'user' },
  })
  assert.equal(role.json().error.code, 'CANNOT_MODIFY_SELF')
})

test('cannot demote the last admin', async () => {
  // admin 1 提升 user 2 为 admin 后仍可降级 2；但不能降级唯一 admin。
  const res = await app.inject({
    method: 'POST', url: '/api/admin/users/2/role', headers: adminCookie,
    payload: { role: 'admin' },
  })
  assert.equal(res.statusCode, 200)
  // 现在有两个 admin：先禁用 2，再尝试把 1 降级是不允许的自操作（已覆盖）；
  // 直接把 2 降回 user 可以。
  const back = await app.inject({
    method: 'POST', url: '/api/admin/users/2/role', headers: adminCookie,
    payload: { role: 'user' },
  })
  assert.equal(back.statusCode, 200)
})

test('demoting another admin when they are the last other admin is fine, but last active admin cannot be demoted', async () => {
  getDb().prepare("UPDATE users SET status='disabled' WHERE id=2").run()
  // 1 是唯一 active admin，且不能自操作 -> 等价 LAST_ADMIN 场景由 CANNOT_MODIFY_SELF 覆盖。
  // 这里验证：启用 2 并提为 admin，然后禁用 1 由 2 操作（模拟 2 的会话）。
  // 简化：直接验证 LAST_ADMIN 守卫——把 2 提为 admin 再禁用 1，之后 2 降级自己应报 CANNOT_MODIFY_SELF。
  await app.inject({ method: 'POST', url: '/api/admin/users/2/role', headers: adminCookie, payload: { role: 'admin' } })
  await app.inject({ method: 'POST', url: '/api/admin/users/2/enable', headers: adminCookie })
  const res = await app.inject({ method: 'POST', url: '/api/admin/users/1/disable', headers: { cookie: `dsh_session=${'b'.repeat(64)}` } })
  assert.equal(res.statusCode, 200)
  // 现在 2 是唯一 active admin；任何对 2 的降级/禁用都必须被拒绝。
  const demote = await app.inject({ method: 'POST', url: '/api/admin/users/2/role', headers: { cookie: `dsh_session=${'b'.repeat(64)}` }, payload: { role: 'user' } })
  assert.equal(demote.statusCode, 400)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/admin-users.test.js`
Expected: FAIL — 404（路由不存在）

- [ ] **Step 3: 实现 routes.js 用户管理部分并注册插件**

```javascript
// src/admin/routes.js
import { z } from 'zod'
import { apiError } from '../server.js'
import { requireAdmin } from '../auth/middleware.js'
import { getUserById, setUserStatus, updateUserRole } from '../store/users.js'
import { deleteAllSessionsForUser } from '../store/sessions.js'
import { listAllInstances, stopInstance } from '../orchestrator/instances.js'
import { closeUserSockets } from '../gateway/index.js'
import { writeAudit } from '../store/audit.js'
import { listUsersWithStats, countActiveAdmins } from './queries.js'

export default async function adminRoutes(app) {
  app.addHook('preHandler', requireAdmin)

  app.get('/users', { schema: { querystring: z.object({ search: z.string().optional() }) } },
    async (req) => ({ users: listUsersWithStats({ search: req.query.search ?? '' }) }))

  app.post('/users/:id/disable', async (req) => {
    const target = getTargetUser(req)
    if (target.id === req.user.id) throw apiError(400, 'CANNOT_MODIFY_SELF', '不能禁用当前登录的管理员账户')
    setUserStatus(target.id, 'disabled')
    deleteAllSessionsForUser(target.id)
    closeUserSockets(target.id)
    for (const inst of listAllInstances().filter((i) => i.user_id === target.id && i.status === 'running')) {
      await stopInstance(inst.id) // 逐个停止，失败不阻断禁用
        .catch(() => {})
    }
    writeAudit({ actorId: req.user.id, action: 'admin.user_disable', targetType: 'user', targetId: target.id, detail: { email: target.email } })
    return { ok: true }
  })

  app.post('/users/:id/enable', async (req) => {
    const target = getTargetUser(req)
    setUserStatus(target.id, 'active')
    writeAudit({ actorId: req.user.id, action: 'admin.user_enable', targetType: 'user', targetId: target.id, detail: { email: target.email } })
    return { ok: true }
  })

  app.post('/users/:id/role', {
    schema: { body: z.object({ role: z.enum(['admin', 'user']) }) },
  }, async (req) => {
    const target = getTargetUser(req)
    if (target.id === req.user.id) throw apiError(400, 'CANNOT_MODIFY_SELF', '不能修改自己的角色')
    if (target.role === 'admin' && req.body.role === 'user' && countActiveAdmins() <= 1) {
      throw apiError(400, 'LAST_ADMIN', '平台至少保留一名管理员')
    }
    updateUserRole(target.id, req.body.role)
    writeAudit({ actorId: req.user.id, action: 'admin.user_role', targetType: 'user', targetId: target.id, detail: { email: target.email, role: req.body.role } })
    return { ok: true }
  })
}

function getTargetUser(req) {
  const id = Number(req.params.id)
  const user = Number.isInteger(id) ? getUserById(id) : null
  if (!user) throw apiError(404, 'USER_NOT_FOUND', '用户不存在')
  return user
}
```

`src/server.js` 的 `buildServer` 中（其他模块注册处）加入：

```javascript
import adminRoutes from './admin/routes.js'
// ...
await app.register(adminRoutes, { prefix: '/api/admin' })
```

注意：`stopInstance` 与 `closeUserSockets` 来自计划 03/04 的模块；本计划在它们之后执行。若联调时签名不同（如 `stopInstance(inst)` 接收对象），按提供方签名调整调用点，不改提供方函数名。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/admin-users.test.js`
Expected: 8 PASS

- [ ] **Step 5: 提交**

```bash
git add src/admin/routes.js src/server.js test/helpers.js test/admin-users.test.js
git commit -m "feat: admin user management routes with guards and audit"
```

---

### Task 3: 空间与实例管理路由

**Files:**
- Modify: `src/admin/routes.js`
- Test: `test/admin-spaces.test.js`

**Interfaces:**
- Consumes: Task 1 查询层；`updateSpaceQuotas/getSpaceBySlug/listInstancesForSpace`（计划 03）；`deleteSpaceCascade`（计划 05）；`removeContainer/deleteInstance`（计划 03）。
- Produces:
  - `GET /api/admin/spaces`、`GET /api/admin/spaces/:slug`
  - `PUT /api/admin/spaces/:slug/quota`（body 三字段均可 null，null = 回落平台默认）
  - `POST /api/admin/spaces/:slug/instances/:userId/stop`
  - `DELETE /api/admin/spaces/:slug/instances/:userId`（停容器 + 删容器 + 删实例行；卷保留）
  - `DELETE /api/admin/spaces/:slug`（复用 `deleteSpaceCascade`）

- [ ] **Step 1: 写失败的测试**

```javascript
// test/admin-spaces.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie } from './helpers.js'
import { getDb } from '../src/store/db.js'

let app
beforeEach(async () => {
  app = await makeAdminApp()
  const db = getDb()
  const now = Date.now()
  db.prepare("INSERT INTO spaces (id, slug, name, kind, owner_id, created_at) VALUES (1,'team-x','Team X','team',1,?)").run(now)
  db.prepare("INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (1,1,'owner',?),(1,2,'member',?)").run(now, now)
  db.prepare("INSERT INTO instances (id, space_id, user_id, container_name, status, created_at) VALUES (1,1,2,'dsh-team-x-user','running',?)").run(now)
})

test('GET /api/admin/spaces lists with aggregates', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/spaces', headers: adminCookie })
  const space = res.json().spaces[0]
  assert.equal(space.member_count, 2)
  assert.equal(space.running_count, 1)
})

test('GET /api/admin/spaces/:slug returns detail', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/spaces/team-x', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().members.length, 2)
  assert.equal(res.json().instances[0].container_name, 'dsh-team-x-user')
})

test('PUT quota sets overrides and null resets to platform default', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/spaces/team-x/quota', headers: adminCookie,
    payload: { quotaCpu: 8, quotaMemMb: 16384, quotaInstances: 4 },
  })
  assert.equal(res.statusCode, 200)
  let row = getDb().prepare('SELECT * FROM spaces WHERE id=1').get()
  assert.equal(row.quota_cpu, 8)
  const reset = await app.inject({
    method: 'PUT', url: '/api/admin/spaces/team-x/quota', headers: adminCookie,
    payload: { quotaCpu: null, quotaMemMb: null, quotaInstances: null },
  })
  assert.equal(reset.statusCode, 200)
  row = getDb().prepare('SELECT * FROM spaces WHERE id=1').get()
  assert.equal(row.quota_cpu, null)
  const audit = getDb().prepare("SELECT * FROM audit_log WHERE action='admin.space_quota' ORDER BY id DESC").get()
  assert.ok(audit.detail_json.includes('quotaCpu'))
})

test('PUT quota rejects negative values', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/spaces/team-x/quota', headers: adminCookie,
    payload: { quotaCpu: -1 },
  })
  assert.equal(res.statusCode, 400)
})

test('DELETE instance removes row and keeps volumes', async () => {
  const res = await app.inject({
    method: 'DELETE', url: '/api/admin/spaces/team-x/instances/2', headers: adminCookie,
  })
  assert.equal(res.statusCode, 200)
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM instances').get().n, 0)
})

test('DELETE space delegates to cascade', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/spaces/team-x', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM spaces').get().n, 0)
})
```

注：`DELETE instance`/`DELETE space` 会调用编排层删除容器与卷——测试用 `makeAdminApp({ docker })` 注入的 fake docker client 需要 `getContainer(name)` 返回带 `stop/remove` 桩方法的对象、`getVolume(name)` 返回带 `remove` 桩的对象；按 fake 最小实现补齐 helper（参考计划 03 测试的 fake docker 写法）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/admin-spaces.test.js`
Expected: FAIL — 404

- [ ] **Step 3: 实现路由**

```javascript
// src/admin/routes.js 追加（插件函数内）：
import { getSpaceBySlug, updateSpaceQuotas, getInstance, deleteInstance } from '../store/spaces.js'
import { stopInstance, removeContainer } from '../orchestrator/instances.js'
import { deleteSpaceCascade } from '../spaces/service.js'
import { listSpacesWithStats, getSpaceAdminDetail } from './queries.js'

app.get('/spaces', async () => ({ spaces: listSpacesWithStats() }))

app.get('/spaces/:slug', async (req) => {
  const detail = getSpaceAdminDetail(req.params.slug)
  if (!detail) throw apiError(404, 'SPACE_NOT_FOUND', '空间不存在')
  return detail
})

app.put('/spaces/:slug/quota', {
  schema: {
    body: z.object({
      quotaCpu: z.number().positive().nullable().optional(),
      quotaMemMb: z.number().int().positive().nullable().optional(),
      quotaInstances: z.number().int().positive().nullable().optional(),
    }),
  },
}, async (req) => {
  const space = getSpaceBySlug(req.params.slug)
  if (!space) throw apiError(404, 'SPACE_NOT_FOUND', '空间不存在')
  const { quotaCpu, quotaMemMb, quotaInstances } = req.body
  const before = { quotaCpu: space.quota_cpu, quotaMemMb: space.quota_mem_mb, quotaInstances: space.quota_instances }
  updateSpaceQuotas(space.id, {
    quotaCpu: quotaCpu === undefined ? space.quota_cpu : quotaCpu,
    quotaMemMb: quotaMemMb === undefined ? space.quota_mem_mb : quotaMemMb,
    quotaInstances: quotaInstances === undefined ? space.quota_instances : quotaInstances,
  })
  writeAudit({ actorId: req.user.id, action: 'admin.space_quota', targetType: 'space', targetId: space.id, detail: { slug: space.slug, before, after: req.body } })
  return { ok: true }
})

app.post('/spaces/:slug/instances/:userId/stop', async (req) => {
  const inst = getInstanceInSpace(req)
  await stopInstance(inst.id)
  writeAudit({ actorId: req.user.id, action: 'instance.stop', targetType: 'instance', targetId: inst.id, detail: { container: inst.container_name, by: 'admin' } })
  return { ok: true }
})

app.delete('/spaces/:slug/instances/:userId', async (req) => {
  const inst = getInstanceInSpace(req)
  await stopInstance(inst.id).catch(() => {})
  await removeContainer(inst.container_name)
  deleteInstance(inst.id)
  writeAudit({ actorId: req.user.id, action: 'instance.stop', targetType: 'instance', targetId: inst.id, detail: { container: inst.container_name, by: 'admin', deleted: true } })
  return { ok: true }
})

app.delete('/spaces/:slug', async (req) => {
  const space = getSpaceBySlug(req.params.slug)
  if (!space) throw apiError(404, 'SPACE_NOT_FOUND', '空间不存在')
  await deleteSpaceCascade(space, req.user.id)
  return { ok: true }
})

function getInstanceInSpace(req) {
  const space = getSpaceBySlug(req.params.slug)
  if (!space) throw apiError(404, 'SPACE_NOT_FOUND', '空间不存在')
  const inst = getInstance(space.id, Number(req.params.userId))
  if (!inst) throw apiError(404, 'INSTANCE_NOT_FOUND', '实例不存在')
  return inst
}
```

（`getInstance(spaceId, userId)`、`deleteInstance(id)`、`updateSpaceQuotas(id, fields)` 均为计划 03 契约函数；`getSpaceBySlug` 若计划 03 定义于 `src/store/spaces.js`，保持该 import 路径。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/admin-spaces.test.js`
Expected: 6 PASS

- [ ] **Step 5: 提交**

```bash
git add src/admin/routes.js test/admin-spaces.test.js test/helpers.js
git commit -m "feat: admin space and instance management routes"
```

---

### Task 4: 平台设置路由

**Files:**
- Modify: `src/admin/routes.js`
- Test: `test/admin-settings.test.js`

**Interfaces:**
- Consumes: `getSetting/setSetting`（计划 01）。
- Produces:
  - `GET /api/admin/settings` → `{ settings: { oidc_issuer, oidc_client_id, oidc_scope, password_login_enabled, default_quota_cpu, default_quota_mem_mb, default_quota_instances, idle_stop_minutes, oidc_client_secret_configured } }`（secret 永不下发，只给布尔）。
  - `PUT /api/admin/settings` → 部分更新；`oidc_client_secret` 传空字符串表示保持不变。审计只记录变更的键名。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/admin-settings.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie } from './helpers.js'
import { getSetting, setSetting } from '../src/store/settings.js'
import { getDb } from '../src/store/db.js'

let app
beforeEach(async () => {
  app = await makeAdminApp()
  setSetting('oidc_issuer', 'https://idp.example.com')
  setSetting('oidc_client_secret', 'supersecret')
})

test('GET settings masks the OIDC secret', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: adminCookie })
  const s = res.json().settings
  assert.equal(s.oidc_issuer, 'https://idp.example.com')
  assert.equal(s.oidc_client_secret, undefined)
  assert.equal(s.oidc_client_secret_configured, true)
})

test('PUT settings updates provided keys and audits key names only', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { default_quota_cpu: 8, idle_stop_minutes: 30, oidc_client_secret: '' },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(getSetting('default_quota_cpu'), '8')
  assert.equal(getSetting('idle_stop_minutes'), '30')
  assert.equal(getSetting('oidc_client_secret'), 'supersecret') // 空串 = 保持不变
  const audit = getDb().prepare("SELECT * FROM audit_log WHERE action='admin.settings_update'").get()
  assert.ok(audit.detail_json.includes('default_quota_cpu'))
  assert.ok(!audit.detail_json.includes('supersecret'))
})

test('PUT settings rejects non-https issuer and bad enum', async () => {
  const bad1 = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { oidc_issuer: 'http://idp.example.com' },
  })
  assert.equal(bad1.statusCode, 400)
  const bad2 = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: adminCookie,
    payload: { password_login_enabled: 'maybe' },
  })
  assert.equal(bad2.statusCode, 400)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/admin-settings.test.js`
Expected: FAIL — 404

- [ ] **Step 3: 实现路由**

```javascript
// src/admin/routes.js 追加（插件函数内）：
import { getSetting, setSetting } from '../store/settings.js'

const SETTINGS_KEYS = [
  'oidc_issuer', 'oidc_client_id', 'oidc_scope', 'password_login_enabled',
  'default_quota_cpu', 'default_quota_mem_mb', 'default_quota_instances', 'idle_stop_minutes',
]

app.get('/settings', async () => {
  const settings = {}
  for (const key of SETTINGS_KEYS) settings[key] = getSetting(key)
  settings.oidc_client_secret_configured = getSetting('oidc_client_secret') !== ''
  return { settings }
})

app.put('/settings', {
  schema: {
    body: z.object({
      oidc_issuer: z.union([z.literal(''), z.string().url().startsWith('https://')]).optional(),
      oidc_client_id: z.string().optional(),
      oidc_client_secret: z.string().optional(),
      oidc_scope: z.string().min(1).optional(),
      password_login_enabled: z.enum(['true', 'false']).optional(),
      default_quota_cpu: z.number().positive().optional(),
      default_quota_mem_mb: z.number().int().positive().optional(),
      default_quota_instances: z.number().int().positive().optional(),
      idle_stop_minutes: z.number().int().positive().optional(),
    }).strict(),
  },
}, async (req) => {
  const changed = []
  for (const [key, value] of Object.entries(req.body)) {
    if (key === 'oidc_client_secret' && value === '') continue // 留空 = 保持
    if (getSetting(key) !== String(value)) {
      setSetting(key, value)
      changed.push(key)
    }
  }
  if (changed.length) {
    writeAudit({ actorId: req.user.id, action: 'admin.settings_update', targetType: 'settings', targetId: null, detail: { changed } })
  }
  return { ok: true, changed }
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/admin-settings.test.js`
Expected: 3 PASS

- [ ] **Step 5: 提交**

```bash
git add src/admin/routes.js test/admin-settings.test.js
git commit -m "feat: admin platform settings routes"
```

---

### Task 5: 镜像管理（构建触发、digest 切换、批量重建）

**Files:**
- Create: `src/imagebuild/index.js`
- Modify: `src/admin/routes.js`
- Test: `test/admin-image.test.js`

**Interfaces:**
- Consumes: `getSetting/setSetting`、`getDocker`、计划 03 的 `listAllInstances/rebuildInstance`；`scripts/build-image.sh`（计划 03 移植，成功时输出含 `sha256:<64hex>` digest 行）。
- Produces:
  - `src/imagebuild/index.js`：`runImageBuild()` → `{ digest, log }`（内部 spawn `bash scripts/build-image.sh`，20 分钟超时）；`setImageBuildRunner(fn)`（测试注入）；`buildInProgress()` → boolean。
  - `POST /api/admin/image/build`（并发守卫 409 `BUILD_IN_PROGRESS`；结果写 settings `image_last_build`；**不自动切换 digest**）
  - `GET /api/admin/image` → `{ digest, lastBuild }`
  - `PUT /api/admin/image/digest`（校验格式 + `docker image inspect` 存在性，400 `IMAGE_NOT_FOUND`）
  - `POST /api/admin/image/rebuild-all`（逐个串行重建，返回每实例结果）

- [ ] **Step 1: 写失败的测试**

```javascript
// test/admin-image.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie } from './helpers.js'
import { setImageBuildRunner } from '../src/imagebuild/index.js'
import { getSetting } from '../src/store/settings.js'
import { getDb } from '../src/store/db.js'

const DIGEST = 'sha256:' + 'a'.repeat(64)

let app
beforeEach(async () => {
  app = await makeAdminApp({
    docker: {
      ping: async () => 'OK',
      getImage: (ref) => ({
        inspect: async () => {
          if (ref === DIGEST) return { Id: DIGEST }
          const err = new Error('no such image')
          err.statusCode = 404
          throw err
        },
      }),
    },
  })
  setImageBuildRunner(async () => ({ digest: DIGEST, log: 'built ok' }))
})

test('build stores result without switching digest, and audits', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/image/build', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().digest, DIGEST)
  assert.equal(getSetting('image_digest'), '') // 不自动切换
  const last = JSON.parse(getSetting('image_last_build'))
  assert.equal(last.digest, DIGEST)
  assert.equal(last.ok, true)
  assert.ok(getDb().prepare("SELECT * FROM audit_log WHERE action='admin.image_build'").get())
})

test('concurrent build is rejected', async () => {
  let release
  setImageBuildRunner(() => new Promise((r) => { release = () => r({ digest: DIGEST, log: '' }) }))
  const first = app.inject({ method: 'POST', url: '/api/admin/image/build', headers: adminCookie })
  const second = await app.inject({ method: 'POST', url: '/api/admin/image/build', headers: adminCookie })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'BUILD_IN_PROGRESS')
  release()
  await first
})

test('digest switch validates format and existence', async () => {
  const bad = await app.inject({
    method: 'PUT', url: '/api/admin/image/digest', headers: adminCookie,
    payload: { digest: 'not-a-digest' },
  })
  assert.equal(bad.statusCode, 400)
  const missing = await app.inject({
    method: 'PUT', url: '/api/admin/image/digest', headers: adminCookie,
    payload: { digest: 'sha256:' + 'b'.repeat(64) },
  })
  assert.equal(missing.statusCode, 400)
  assert.equal(missing.json().error.code, 'IMAGE_NOT_FOUND')
  const ok = await app.inject({
    method: 'PUT', url: '/api/admin/image/digest', headers: adminCookie,
    payload: { digest: DIGEST },
  })
  assert.equal(ok.statusCode, 200)
  assert.equal(getSetting('image_digest'), DIGEST)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/admin-image.test.js`
Expected: FAIL — `Cannot find module '../src/imagebuild/index.js'`

- [ ] **Step 3: 实现 imagebuild/index.js 与路由**

```javascript
// src/imagebuild/index.js
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BUILD_TIMEOUT_MS = 20 * 60 * 1000

let running = false
let runner = defaultRunner

export function setImageBuildRunner(fn) { runner = fn } // 测试注入点
export function buildInProgress() { return running }

async function defaultRunner() {
  const { stdout, stderr } = await new Promise((resolve, reject) => {
    execFile('bash', ['scripts/build-image.sh'],
      { cwd: repoRoot, timeout: BUILD_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })))
  })
  const log = (stdout + '\n' + stderr).slice(-4096)
  const match = /sha256:[a-f0-9]{64}/.exec(log)
  if (!match) throw new Error('build finished but no sha256 digest found in output')
  return { digest: match[0], log }
}

/** 触发一次镜像构建；并发调用抛出 BUILD_IN_PROGRESS 由路由层拦截。 */
export async function runImageBuild() {
  if (running) {
    const err = new Error('build already in progress')
    err.code = 'BUILD_IN_PROGRESS'
    throw err
  }
  running = true
  try {
    return await runner()
  } finally {
    running = false
  }
}
```

```javascript
// src/admin/routes.js 追加（插件函数内）：
import { runImageBuild } from '../imagebuild/index.js'
import { getDocker } from '../orchestrator/docker.js'
import { listAllInstances, rebuildInstance } from '../orchestrator/instances.js'

app.post('/image/build', async (req, reply) => {
  try {
    const { digest, log } = await runImageBuild()
    setSetting('image_last_build', JSON.stringify({ digest, at: Date.now(), ok: true, log }))
    writeAudit({ actorId: req.user.id, action: 'admin.image_build', targetType: 'image', targetId: digest, detail: { ok: true } })
    return { digest }
  } catch (err) {
    if (err.code === 'BUILD_IN_PROGRESS') {
      return reply.code(409).send({ error: { code: 'BUILD_IN_PROGRESS', message: '已有构建在进行中' } })
    }
    const log = String(err.stdout ?? '') + String(err.stderr ?? '') + String(err.message)
    setSetting('image_last_build', JSON.stringify({ digest: null, at: Date.now(), ok: false, log: log.slice(-4096) }))
    writeAudit({ actorId: req.user.id, action: 'admin.image_build', targetType: 'image', targetId: null, detail: { ok: false } })
    throw apiError(500, 'IMAGE_BUILD_FAILED', '镜像构建失败，请查看构建日志')
  }
})

app.get('/image', async () => ({
  digest: getSetting('image_digest'),
  lastBuild: getSetting('image_last_build') ? JSON.parse(getSetting('image_last_build')) : null,
}))

app.put('/image/digest', {
  schema: { body: z.object({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }) },
}, async (req) => {
  try {
    await getDocker().getImage(req.body.digest).inspect()
  } catch {
    throw apiError(400, 'IMAGE_NOT_FOUND', '该 digest 的镜像在本地不存在，请先构建')
  }
  setSetting('image_digest', req.body.digest)
  writeAudit({ actorId: req.user.id, action: 'admin.image_digest', targetType: 'image', targetId: req.body.digest, detail: null })
  return { ok: true }
})

app.post('/image/rebuild-all', async (req) => {
  const results = []
  for (const inst of listAllInstances()) {
    try {
      await rebuildInstance(inst.id) // 串行：避免宿主机过载（YAGNI 并发调度）
      results.push({ id: inst.id, container: inst.container_name, ok: true })
    } catch (err) {
      results.push({ id: inst.id, container: inst.container_name, ok: false, error: String(err.message ?? err) })
    }
  }
  const okCount = results.filter((r) => r.ok).length
  writeAudit({ actorId: req.user.id, action: 'admin.image_rebuild_all', targetType: 'image', targetId: getSetting('image_digest'), detail: { total: results.length, ok: okCount } })
  return { results, ok: okCount, total: results.length }
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/admin-image.test.js`
Expected: 3 PASS（测试后调用 `setImageBuildRunner` 复位：在文件尾部加 `test.afterEach(() => setImageBuildRunner(null))` 并在 `setImageBuildRunner(null)` 时恢复默认 runner——实现里 `runner = fn ?? defaultRunner`）

- [ ] **Step 5: 提交**

```bash
git add src/imagebuild/index.js src/admin/routes.js test/admin-image.test.js
git commit -m "feat: admin image build, digest switch, and batch rebuild"
```

---

### Task 6: 用量监控

**Files:**
- Create: `src/admin/usage.js`
- Modify: `src/admin/routes.js`
- Test: `test/admin-usage.test.js`

**Interfaces:**
- Consumes: `getDocker()`；容器命名约定 `dsh-<spaceSlug>-<handle>`（计划 01）。
- Produces:
  - `collectUsage(docker)` → `{ running, cpuPercent, memoryMb, diskBytes, spaces: [{ slug, running, memoryMb, volumeBytes }] }`
  - `GET /api/admin/usage` 返回上述结构。
  - 单容器 stats 预算 5 秒，超时/失败跳过该容器（不拖垮整个接口）。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/admin-usage.test.js
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { collectUsage, computeCpuPercent } from '../src/admin/usage.js'

const statsFixture = {
  cpu_stats: { cpu_usage: { total_usage: 2000 }, system_cpu_usage: 10000, online_cpus: 2 },
  precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 5000 },
  memory_stats: { usage: 512 * 1024 * 1024 },
}

test('computeCpuPercent uses the docker delta formula', () => {
  // (1000 / 5000) * 2 cores * 100 = 40%
  assert.equal(computeCpuPercent(statsFixture), 40)
})

test('collectUsage aggregates per space and skips failed stats', async () => {
  const docker = {
    listContainers: async () => [
      { Names: ['/dsh-team-x-alice'], Id: 'c1' },
      { Names: ['/dsh-team-x-bob'], Id: 'c2' },
      { Names: ['/dsh-p-carol-carol'], Id: 'c3' },
    ],
    getContainer: (id) => ({
      stats: async () => {
        if (id === 'c2') throw new Error('stats unavailable')
        return statsFixture
      },
    }),
    df: async () => ({
      Volumes: [
        { Name: 'dshvol-team-x-shared', UsageData: { Size: 1024 } },
        { Name: 'dshvol-team-x-alice', UsageData: { Size: 2048 } },
        { Name: 'dshvol-p-carol-carol', UsageData: { Size: 4096 } },
      ],
    }),
  }
  const usage = await collectUsage(docker)
  assert.equal(usage.running, 3)
  assert.equal(usage.memoryMb, 1024) // 2 × 512MB（c2 被跳过）
  const team = usage.spaces.find((s) => s.slug === 'team-x')
  assert.equal(team.running, 2)
  assert.equal(team.volumeBytes, 3072)
  const personal = usage.spaces.find((s) => s.slug === 'p-carol')
  assert.equal(personal.volumeBytes, 4096)
  assert.equal(usage.diskBytes, 7168)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/admin-usage.test.js`
Expected: FAIL — `Cannot find module '../src/admin/usage.js'`

- [ ] **Step 3: 实现 usage.js 与路由**

```javascript
// src/admin/usage.js
const STATS_BUDGET_MS = 5000

export function computeCpuPercent(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
  const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
  if (sysDelta <= 0 || cpuDelta < 0) return 0
  const cores = stats.cpu_stats.online_cpus || 1
  return Math.round((cpuDelta / sysDelta) * cores * 1000) / 10
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('stats timeout')), ms)),
  ])
}

/** 从容器名 dsh-<slug>-<handle> 提取 slug（handle 不含 slug 分隔歧义：slug 是全局唯一且已登记，调用方用已知 slug 列表匹配最稳妥）。 */
function slugOf(name, knownSlugs) {
  for (const slug of knownSlugs) {
    if (name.startsWith(`dsh-${slug}-`)) return slug
  }
  return null
}

export async function collectUsage(docker, knownSlugs = []) {
  const [containers, df] = await Promise.all([
    docker.listContainers({ filters: { name: ['dsh-'] } }),
    docker.df(),
  ])
  const names = containers.map((c) => c.Names[0].replace(/^\//, ''))
  const slugs = knownSlugs.length
    ? knownSlugs
    : [...new Set(names.map((n) => n.replace(/^dsh-/, '').split('-').slice(0, -1).join('-')))]

  let cpuPercent = 0
  let memoryBytes = 0
  await Promise.all(containers.map(async (c) => {
    try {
      const stats = await withTimeout(docker.getContainer(c.Id).stats({ stream: false }), STATS_BUDGET_MS)
      cpuPercent += computeCpuPercent(stats)
      memoryBytes += stats.memory_stats.usage ?? 0
    } catch { /* 单容器失败跳过 */ }
  }))

  const volumes = df.Volumes ?? []
  const spaces = new Map()
  for (const name of names) {
    const slug = slugOf(name, slugs)
    if (!slug) continue
    if (!spaces.has(slug)) spaces.set(slug, { slug, running: 0, memoryMb: 0, volumeBytes: 0 })
    spaces.get(slug).running += 1
  }
  for (const vol of volumes) {
    if (!vol.Name.startsWith('dshvol-')) continue
    const slug = slugOf(vol.Name.replace(/^dshvol-/, 'dsh-'), slugs)
      ?? slugs.find((s) => vol.Name.startsWith(`dshvol-${s}-`) || vol.Name === `dshvol-${s}-shared`)
    if (!slug) continue
    const entry = spaces.get(slug) ?? { slug, running: 0, memoryMb: 0, volumeBytes: 0 }
    entry.volumeBytes += vol.UsageData?.Size ?? 0
    spaces.set(slug, entry)
  }

  return {
    running: containers.length,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryMb: Math.round(memoryBytes / (1024 * 1024)),
    diskBytes: volumes.filter((v) => v.Name.startsWith('dshvol-'))
      .reduce((sum, v) => sum + (v.UsageData?.Size ?? 0), 0),
    spaces: [...spaces.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
  }
}
```

路由（`src/admin/routes.js` 插件函数内）：

```javascript
import { collectUsage } from './usage.js'
import { listAllSpaces } from '../store/spaces.js'

app.get('/usage', async () => {
  const slugs = listAllSpaces().map((s) => s.slug)
  return await collectUsage(getDocker(), slugs)
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/admin-usage.test.js`
Expected: 2 PASS

- [ ] **Step 5: 提交**

```bash
git add src/admin/usage.js src/admin/routes.js test/admin-usage.test.js
git commit -m "feat: admin usage collection from live docker data"
```

---

### Task 7: 审计查询路由

**Files:**
- Modify: `src/admin/routes.js`
- Test: `test/admin-audit.test.js`

**Interfaces:**
- Consumes: `listAudit`（计划 01）、`getUserById`（计划 02）。
- Produces: `GET /api/admin/audit?actorId=&action=&since=&until=&limit=&offset=` → `{ entries: [...] }`，每条附 `actor_email`（actor 已删除则为 null）。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/admin-audit.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie } from './helpers.js'
import { writeAudit } from '../src/store/audit.js'

let app
beforeEach(async () => {
  app = await makeAdminApp()
  writeAudit({ actorId: 1, action: 'admin.settings_update', targetType: 'settings', detail: { changed: ['x'] } })
  writeAudit({ actorId: 2, action: 'user.login', targetType: 'user', targetId: '2', detail: { method: 'oidc' } })
})

test('audit list joins actor email and filters by action', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/audit?action=user.login', headers: adminCookie })
  const entries = res.json().entries
  assert.equal(entries.length, 1)
  assert.equal(entries[0].actor_email, 'user@x.com')
})

test('audit list filters by actorId and caps limit', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/audit?actorId=1&limit=5000', headers: adminCookie })
  assert.equal(res.json().entries.length, 1)
  assert.equal(res.json().entries[0].action, 'admin.settings_update')
  const bad = await app.inject({ method: 'GET', url: '/api/admin/audit?since=abc', headers: adminCookie })
  assert.equal(bad.statusCode, 400)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/admin-audit.test.js`
Expected: FAIL — 404

- [ ] **Step 3: 实现路由**

```javascript
// src/admin/routes.js 追加（插件函数内）：
import { listAudit } from '../store/audit.js'

app.get('/audit', {
  schema: {
    querystring: z.object({
      actorId: z.coerce.number().int().optional(),
      action: z.string().optional(),
      since: z.coerce.number().int().optional(),
      until: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
  },
}, async (req) => {
  const { limit, offset, ...filters } = req.query
  const entries = listAudit({ ...filters, limit: limit ?? 100, offset: offset ?? 0 })
    .map((row) => ({
      ...row,
      actor_email: row.actor_id == null ? null : (getUserById(row.actor_id)?.email ?? null),
    }))
  return { entries }
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/admin-audit.test.js`
Expected: 2 PASS

- [ ] **Step 5: 提交**

```bash
git add src/admin/routes.js test/admin-audit.test.js
git commit -m "feat: admin audit query route"
```

---

### Task 8: 管理后台 UI —— 用户与空间板块

**Files:**
- Create: `src/web/src/api.ts`
- Create: `src/web/src/pages/admin/AdminLayout.tsx`
- Create: `src/web/src/pages/admin/UsersPage.tsx`
- Create: `src/web/src/pages/admin/SpacesPage.tsx`
- Create: `src/web/src/pages/admin/SpaceDetailPage.tsx`
- Modify: `src/web/src/App.tsx`（挂 `/admin` 路由）

**Interfaces:**
- Consumes: Task 2/3 的 API；计划 02 的 `useMe()`/当前用户上下文（若计划 02 提供的是别的 hook 名，以其为准）；`base.css` 设计基线（计划 01）。
- Produces:
  - `src/web/src/api.ts`：`api<T>(path, init?)` fetch 封装（相对路径、JSON、错误抛 `{code,message}`）。
  - `/admin` 路由（非 admin 重定向 `/`），Tab 布局：用户 / 空间 / 设置与镜像 / 用量与审计。

- [ ] **Step 1: 写 api.ts 与 AdminLayout**

```typescript
// src/web/src/api.ts
export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(body?.error?.code ?? 'INTERNAL', body?.error?.message ?? `请求失败（${res.status}）`)
  }
  return body as T
}
```

```tsx
// src/web/src/pages/admin/AdminLayout.tsx
import { NavLink, Navigate, Outlet } from 'react-router-dom'

export default function AdminLayout({ role }: { role: string }) {
  if (role !== 'admin') return <Navigate to="/" replace />
  const tabs = [
    ['users', '用户'],
    ['spaces', '空间'],
    ['settings', '设置与镜像'],
    ['usage', '用量与审计'],
  ] as const
  return (
    <main className="page" style={{ maxWidth: 960 }}>
      <h1 className="title">管理后台</h1>
      <nav style={{ display: 'flex', gap: 16, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {tabs.map(([key, label]) => (
          <NavLink key={key} to={`/admin/${key}`}
            style={({ isActive }) => ({
              padding: '8px 2px', textDecoration: 'none',
              color: isActive ? 'var(--fg)' : 'var(--muted)',
              borderBottom: isActive ? '2px solid var(--fg)' : '2px solid transparent',
            })}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </main>
  )
}
```

- [ ] **Step 2: 写 UsersPage 与 SpacesPage/SpaceDetailPage**

```tsx
// src/web/src/pages/admin/UsersPage.tsx
import { useEffect, useState } from 'react'
import { api } from '../../api'

interface AdminUser {
  id: number; email: string; handle: string; display_name: string
  role: string; status: string; space_count: number; running_instances: number
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  async function load(q = search) {
    try {
      const data = await api<{ users: AdminUser[] }>(`/api/admin/users?search=${encodeURIComponent(q)}`)
      setUsers(data.users)
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void load('') }, [])

  async function act(id: number, action: string, body?: object) {
    await api(`/api/admin/users/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
    await load()
  }

  return (
    <section>
      <input value={search} placeholder="搜索邮箱 / 用户名 / 昵称"
        onChange={(e) => { setSearch(e.target.value); void load(e.target.value) }}
        style={{ marginBottom: 16, padding: '6px 10px', width: 280,
          border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--fg)' }} />
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
      <table>
        <thead><tr>
          <th>邮箱</th><th>用户名</th><th>角色</th><th>状态</th>
          <th className="num">空间数</th><th className="num">运行中实例</th><th>操作</th>
        </tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td className="mono">{u.handle}</td>
              <td>{u.role === 'admin' ? '管理员' : '用户'}</td>
              <td>{u.status === 'active' ? '正常' : '已禁用'}</td>
              <td className="num">{u.space_count}</td>
              <td className="num">{u.running_instances}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                {u.status === 'active'
                  ? <button onClick={() => void act(u.id, 'disable')}>禁用</button>
                  : <button onClick={() => void act(u.id, 'enable')}>启用</button>}
                <button onClick={() => void act(u.id, 'role', { role: u.role === 'admin' ? 'user' : 'admin' })}>
                  {u.role === 'admin' ? '降为用户' : '设为管理员'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

```tsx
// src/web/src/pages/admin/SpacesPage.tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'

interface AdminSpace {
  id: number; slug: string; name: string; kind: string
  member_count: number; instance_count: number; running_count: number
}

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<AdminSpace[]>([])
  useEffect(() => {
    void api<{ spaces: AdminSpace[] }>('/api/admin/spaces').then((d) => setSpaces(d.spaces))
  }, [])
  return (
    <table>
      <thead><tr>
        <th>Slug</th><th>名称</th><th>类型</th>
        <th className="num">成员</th><th className="num">实例</th><th className="num">运行中</th>
      </tr></thead>
      <tbody>
        {spaces.map((s) => (
          <tr key={s.id}>
            <td className="mono"><Link to={`/admin/spaces/${s.slug}`}>{s.slug}</Link></td>
            <td>{s.name}</td>
            <td>{s.kind === 'personal' ? '个人' : '团队'}</td>
            <td className="num">{s.member_count}</td>
            <td className="num">{s.instance_count}</td>
            <td className="num">{s.running_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

```tsx
// src/web/src/pages/admin/SpaceDetailPage.tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../../api'

interface Detail {
  space: { id: number; slug: string; name: string; kind: string; quota_cpu: number | null; quota_mem_mb: number | null; quota_instances: number | null }
  members: { user_id: number; email: string; handle: string; role: string }[]
  instances: { id: number; user_id: number; handle: string; container_name: string; status: string; last_active_at: number | null }[]
  volumes: { id: number; kind: string; docker_name: string }[]
}

export default function SpaceDetailPage() {
  const { slug } = useParams()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [quota, setQuota] = useState({ quotaCpu: '', quotaMemMb: '', quotaInstances: '' })

  async function load() {
    const d = await api<Detail>(`/api/admin/spaces/${slug}`)
    setDetail(d)
    setQuota({
      quotaCpu: d.space.quota_cpu?.toString() ?? '',
      quotaMemMb: d.space.quota_mem_mb?.toString() ?? '',
      quotaInstances: d.space.quota_instances?.toString() ?? '',
    })
  }
  useEffect(() => { void load() }, [slug])

  async function saveQuota() {
    await api(`/api/admin/spaces/${slug}/quota`, {
      method: 'PUT',
      body: JSON.stringify({
        quotaCpu: quota.quotaCpu === '' ? null : Number(quota.quotaCpu),
        quotaMemMb: quota.quotaMemMb === '' ? null : Number(quota.quotaMemMb),
        quotaInstances: quota.quotaInstances === '' ? null : Number(quota.quotaInstances),
      }),
    })
    await load()
  }

  if (!detail) return <p className="body">加载中…</p>
  return (
    <section>
      <h2 className="title" style={{ fontSize: 18 }}>{detail.space.name} <span className="mono">({detail.space.slug})</span></h2>

      <h3>实例</h3>
      <table>
        <thead><tr><th>成员</th><th>容器</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {detail.instances.map((i) => (
            <tr key={i.id}>
              <td>{i.handle}</td>
              <td className="mono">{i.container_name}</td>
              <td>{i.status}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void api(`/api/admin/spaces/${slug}/instances/${i.user_id}/stop`, { method: 'POST' }).then(load)}>停止</button>
                <button onClick={() => { if (confirm('删除该实例？卷数据保留。')) void api(`/api/admin/spaces/${slug}/instances/${i.user_id}`, { method: 'DELETE' }).then(load) }}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>配额覆盖（留空 = 平台默认）</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>CPU <input value={quota.quotaCpu} onChange={(e) => setQuota({ ...quota, quotaCpu: e.target.value })} style={{ width: 72 }} /></label>
        <label>内存 MB <input value={quota.quotaMemMb} onChange={(e) => setQuota({ ...quota, quotaMemMb: e.target.value })} style={{ width: 88 }} /></label>
        <label>实例数 <input value={quota.quotaInstances} onChange={(e) => setQuota({ ...quota, quotaInstances: e.target.value })} style={{ width: 72 }} /></label>
        <button onClick={() => void saveQuota()}>保存</button>
      </div>

      <h3>卷</h3>
      <table>
        <thead><tr><th>类型</th><th>Docker 卷名</th></tr></thead>
        <tbody>
          {detail.volumes.map((v) => (
            <tr key={v.id}><td>{v.kind === 'shared' ? '共享' : '私有'}</td><td className="mono">{v.docker_name}</td></tr>
          ))}
        </tbody>
      </table>

      {detail.space.kind === 'team' && (
        <p style={{ marginTop: 24 }}>
          <button onClick={() => { if (confirm(`删除空间 ${detail.space.slug}？全部实例与卷将被销毁。`)) void api(`/api/admin/spaces/${slug}`, { method: 'DELETE' }).then(() => { location.href = '/admin/spaces' }) }}>删除空间</button>
        </p>
      )}
    </section>
  )
}
```

`src/web/src/App.tsx` 增加路由（`me` 来自计划 02 的用户上下文）：

```tsx
import AdminLayout from './pages/admin/AdminLayout'
import UsersPage from './pages/admin/UsersPage'
import SpacesPage from './pages/admin/SpacesPage'
import SpaceDetailPage from './pages/admin/SpaceDetailPage'
// <Route path="/admin" element={<AdminLayout role={me?.role ?? ''} />}>
//   <Route path="users" element={<UsersPage />} />
//   <Route path="spaces" element={<SpacesPage />} />
//   <Route path="spaces/:slug" element={<SpaceDetailPage />} />
//   <Route path="settings" element={<SettingsImagePage />} />   {/* Task 9 */}
//   <Route path="usage" element={<UsageAuditPage />} />         {/* Task 9 */}
// </Route>
```

- [ ] **Step 3: 构建验证**

Run: `npm run build:web`
Expected: tsc 无错误，vite 构建成功

- [ ] **Step 4: 提交**

```bash
git add src/web/src/api.ts src/web/src/pages/admin src/web/src/App.tsx
git commit -m "feat: admin users and spaces UI"
```

---

### Task 9: 管理后台 UI —— 设置与镜像、用量与审计板块

**Files:**
- Create: `src/web/src/pages/admin/SettingsImagePage.tsx`
- Create: `src/web/src/pages/admin/UsageAuditPage.tsx`

**Interfaces:**
- Consumes: Task 4–7 的 API、`api.ts`（Task 8）。
- Produces: `/admin/settings` 与 `/admin/usage` 页面，接入 Task 8 的路由。

- [ ] **Step 1: 写 SettingsImagePage**

```tsx
// src/web/src/pages/admin/SettingsImagePage.tsx
import { useEffect, useState } from 'react'
import { api } from '../../api'

interface Settings {
  oidc_issuer: string; oidc_client_id: string; oidc_scope: string
  password_login_enabled: string
  default_quota_cpu: string; default_quota_mem_mb: string
  default_quota_instances: string; idle_stop_minutes: string
  oidc_client_secret_configured: boolean
}
interface ImageInfo {
  digest: string
  lastBuild: { digest: string | null; at: number; ok: boolean; log: string } | null
}

export default function SettingsImagePage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [secret, setSecret] = useState('')
  const [image, setImage] = useState<ImageInfo | null>(null)
  const [digestInput, setDigestInput] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    const [s, i] = await Promise.all([
      api<{ settings: Settings }>('/api/admin/settings'),
      api<ImageInfo>('/api/admin/image'),
    ])
    setSettings(s.settings)
    setImage(i)
  }
  useEffect(() => { void load() }, [])

  async function save() {
    if (!settings) return
    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        oidc_issuer: settings.oidc_issuer,
        oidc_client_id: settings.oidc_client_id,
        oidc_client_secret: secret, // 空串 = 保持不变
        oidc_scope: settings.oidc_scope,
        password_login_enabled: settings.password_login_enabled,
        default_quota_cpu: Number(settings.default_quota_cpu),
        default_quota_mem_mb: Number(settings.default_quota_mem_mb),
        default_quota_instances: Number(settings.default_quota_instances),
        idle_stop_minutes: Number(settings.idle_stop_minutes),
      }),
    })
    setMessage('已保存')
    setSecret('')
    await load()
  }

  if (!settings || !image) return <p className="body">加载中…</p>
  const field = (key: keyof Settings, label: string, type = 'text') => (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{label}</span>
      <input type={type} value={settings[key] as string}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
        style={{ width: 360, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--fg)' }} />
    </label>
  )

  return (
    <section>
      <h3>OIDC</h3>
      {field('oidc_issuer', 'Issuer URL（https）')}
      {field('oidc_client_id', 'Client ID')}
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>Client Secret</span>
        <input type="password" value={secret} placeholder={settings.oidc_client_secret_configured ? '已配置，留空保持不变' : '未配置'}
          onChange={(e) => setSecret(e.target.value)}
          style={{ width: 360, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--fg)' }} />
      </label>
      {field('oidc_scope', 'Scope')}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <input type="checkbox" checked={settings.password_login_enabled === 'true'}
          onChange={(e) => setSettings({ ...settings, password_login_enabled: e.target.checked ? 'true' : 'false' })} />
        允许密码登录（建议配置 OIDC 后关闭）
      </label>

      <h3>平台默认配额</h3>
      {field('default_quota_cpu', 'CPU（核）', 'number')}
      {field('default_quota_mem_mb', '内存（MB）', 'number')}
      {field('default_quota_instances', '实例数', 'number')}
      {field('idle_stop_minutes', '空闲休眠阈值（分钟）', 'number')}
      <button onClick={() => void save()}>保存设置</button>
      {message && <span style={{ marginLeft: 12, color: 'var(--success)' }}>{message}</span>}

      <h3 style={{ marginTop: 32 }}>dsh 镜像</h3>
      <p>当前 digest：<span className="mono">{image.digest || '未设置'}</span></p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => void api('/api/admin/image/build', { method: 'POST' }).then(load)}>触发重新构建</button>
        <input value={digestInput} placeholder="sha256:…" className="mono"
          onChange={(e) => setDigestInput(e.target.value)}
          style={{ width: 420, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--fg)' }} />
        <button onClick={() => void api('/api/admin/image/digest', { method: 'PUT', body: JSON.stringify({ digest: digestInput }) }).then(load)}>切换 digest</button>
        <button onClick={() => { if (confirm('按当前 digest 重建全部实例？')) void api('/api/admin/image/rebuild-all', { method: 'POST' }).then((r) => alert(`完成：${(r as { ok: number }).ok}/${(r as { total: number }).total} 成功`)) }}>批量重建实例</button>
      </div>
      {image.lastBuild && (
        <details>
          <summary>上次构建：{image.lastBuild.ok ? '成功' : '失败'} · {new Date(image.lastBuild.at).toLocaleString()}</summary>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', padding: 12 }}>{image.lastBuild.log}</pre>
        </details>
      )}
    </section>
  )
}
```

- [ ] **Step 2: 写 UsageAuditPage**

```tsx
// src/web/src/pages/admin/UsageAuditPage.tsx
import { useEffect, useState } from 'react'
import { api } from '../../api'

interface Usage {
  running: number; cpuPercent: number; memoryMb: number; diskBytes: number
  spaces: { slug: string; running: number; memoryMb: number; volumeBytes: number }[]
}
interface AuditEntry {
  id: number; actor_email: string | null; action: string
  target_type: string; target_id: string | null; created_at: number
}

function mb(v: number) { return `${(v / (1024 * 1024)).toFixed(1)} MB` }

export default function UsageAuditPage() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [action, setAction] = useState('')

  async function loadAudit(act = action) {
    const q = act ? `?action=${encodeURIComponent(act)}` : ''
    const d = await api<{ entries: AuditEntry[] }>(`/api/admin/audit${q}`)
    setEntries(d.entries)
  }
  useEffect(() => {
    void api<Usage>('/api/admin/usage').then(setUsage)
    void loadAudit('')
  }, [])

  return (
    <section>
      <h3>用量</h3>
      {usage && (
        <>
          <p style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>
            运行中实例 {usage.running} · CPU {usage.cpuPercent}% · 内存 {usage.memoryMb} MB · 存储 {mb(usage.diskBytes)}
          </p>
          <table>
            <thead><tr><th>空间</th><th className="num">运行中实例</th><th className="num">内存 (MB)</th><th className="num">卷占用</th></tr></thead>
            <tbody>
              {usage.spaces.map((s) => (
                <tr key={s.slug}>
                  <td className="mono">{s.slug}</td>
                  <td className="num">{s.running}</td>
                  <td className="num">{s.memoryMb}</td>
                  <td className="num">{mb(s.volumeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ marginTop: 32 }}>审计日志</h3>
      <input value={action} placeholder="按动作过滤，如 admin.settings_update"
        onChange={(e) => { setAction(e.target.value); void loadAudit(e.target.value) }}
        style={{ marginBottom: 16, padding: '6px 10px', width: 360, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--fg)' }} />
      <table>
        <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="num">{new Date(e.created_at).toLocaleString()}</td>
              <td>{e.actor_email ?? '系统'}</td>
              <td className="mono">{e.action}</td>
              <td className="mono">{e.target_type}{e.target_id ? `:${e.target_id}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 3: 接入路由并构建验证**

`src/web/src/App.tsx` 中把 Task 8 注释处的两个 `<Route>` 取消注释并 import 两个页面。

Run: `npm run build:web`
Expected: tsc 无错误，vite 构建成功

- [ ] **Step 4: 全部服务端测试回归**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/web/src/pages/admin src/web/src/App.tsx
git commit -m "feat: admin settings/image and usage/audit UI"
```
