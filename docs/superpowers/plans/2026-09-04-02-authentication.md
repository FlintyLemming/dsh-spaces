# dsh-spaces 认证实施计划（计划 02 / 共 07）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现平台认证：OIDC authorization code + PKCE 主路径、管理员引导密码登录、SQLite 会话（7 天绝对 / 24 小时空闲滑动）、会话中间件与登录 UI。

**Architecture:** `src/auth/` 模块以 Fastify 插件挂到 `/api/auth`；OIDC 用 `openid-client` v6（discovery + PKCE + state/nonce 短期 cookie）；身份解析在 `src/auth/identity.js`，按 `(issuer, subject)` → `email_verified` 邮箱绑定 → 创建用户三级收敛；会话只存 SHA-256 哈希（沿用 portal 安全姿态）。新用户的个人空间惰性创建属于计划 03，本计划只定义 `provisionNewUser(userId)` 接缝（no-op stub）。

**Tech Stack:** openid-client v6, bcryptjs, better-sqlite3, Fastify 5, zod, Vitest（`vi.mock('openid-client')` 做 OIDC 单测）。

**Spec:** `docs/superpowers/specs/2026-09-04-dsh-spaces-design.md`（§3 数据模型、§4 认证流程、§7 安全设计、§9 错误处理）

**前置计划：** 计划 01（骨架）已完成：`src/config.js`、`src/store/db.js`、`src/store/settings.js`、`src/store/audit.js`、`src/server.js`、SPA 脚手架。本计划严格复用其 schema 与约定。

## Global Constraints

- 沿用计划 01 全部 Global Constraints（ESM JS、错误格式、提交风格、schema 列名等）。
- 会话 cookie 名 `dsh_session`；OIDC 事务 cookie 名 `dsh_oidc_txn`（10 分钟、httpOnly、SameSite=Lax、path=`/api/auth`）。
- 库中只存 `sha256(token)` 作为 `sessions.token_hash`；cookie 持原始 64 位 hex token。
- **CSRF 姿态（v1）**：SameSite=Lax cookie + 变更类端点强制 `content-type: application/json` + 不启用 CORS；不单独发 CSRF token。
- 密码登录所有失败（用户不存在 / 无密码哈希 / 已绑定 OIDC / 已禁用 / 密码错误）一律返回 401 `INVALID_CREDENTIALS`，避免用户枚举。
- 审计动作名约定：`user.login`（detail `{method:'oidc'|'password'}`）、`user.logout`、`user.create`（detail `{method:'oidc'|'bootstrap'}`）、`identity.bind`。
- OIDC 故障（IdP 不可达、discovery 失败）→ 502 `OIDC_UNAVAILABLE`；回调参数/state 非法 → 400 `OIDC_CALLBACK_INVALID`；未配置 → 503 `OIDC_NOT_CONFIGURED`。已登录会话不受 IdP 故障影响（spec §9）。
- UI 遵循 spec §8 设计语言。

---

### Task 1: users 与 identities 数据访问

**Files:**
- Create: `src/store/users.js`
- Create: `src/store/identities.js`
- Test: `test/store-users.test.js`

**Interfaces:**
- Consumes: `getDb()`（计划 01 Task 2）。
- Produces（后续任务与计划 05/06 直接使用这些精确签名）：
  - `createUser({ email, handle, displayName = '', role = 'user', passwordHash = null })` → 新用户 id（number）
  - `getUserById(id)` / `getUserByEmail(email)` / `getUserByHandle(handle)` → row 或 null（row 为 snake_case 列名）
  - `listUsers({ search } = {})` → rows（不含 `password_hash`）
  - `updateUser(id, fields)` — 白名单键：`display_name`, `role`, `status`
  - `deriveUniqueHandle(seed)` — 从邮箱/任意字符串派生唯一 handle：小写、`[^a-z0-9-]+`→`-`、去首尾 `-`、空则 `user`，冲突追加 `-2`/`-3`…
  - `createIdentity({ userId, issuer, subject })`
  - `getIdentityByIssuerSubject(issuer, subject)` → row 或 null
  - `userHasIdentity(userId)` → boolean

- [ ] **Step 1: 写失败的测试**

```javascript
// test/store-users.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import {
  createUser, getUserById, getUserByEmail, getUserByHandle,
  listUsers, updateUser, deriveUniqueHandle,
} from '../src/store/users.js'
import {
  createIdentity, getIdentityByIssuerSubject, userHasIdentity,
} from '../src/store/identities.js'

beforeEach(() => { initDb(':memory:') })

test('createUser + getters round-trip', () => {
  const id = createUser({ email: 'a@x.com', handle: 'aa', displayName: 'A' })
  assert.equal(getUserById(id).email, 'a@x.com')
  assert.equal(getUserByEmail('a@x.com').handle, 'aa')
  assert.equal(getUserByHandle('aa').id, id)
  assert.equal(getUserByEmail('b@x.com'), null)
})

test('email and handle are unique', () => {
  createUser({ email: 'a@x.com', handle: 'aa' })
  assert.throws(() => createUser({ email: 'a@x.com', handle: 'ab' }))
  assert.throws(() => createUser({ email: 'b@x.com', handle: 'aa' }))
})

test('deriveUniqueHandle sanitizes and suffixes on conflict', () => {
  assert.equal(deriveUniqueHandle('Flinty.Lemming@x.com'), 'flinty-lemming')
  createUser({ email: 'a@x.com', handle: 'flinty-lemming' })
  assert.equal(deriveUniqueHandle('flinty-lemming@y.com'), 'flinty-lemming-2')
  assert.equal(deriveUniqueHandle('@@@'), 'user')
})

test('listUsers omits password_hash and supports search', () => {
  createUser({ email: 'a@x.com', handle: 'aa', passwordHash: 'secret-hash' })
  createUser({ email: 'bob@x.com', handle: 'bob' })
  const all = listUsers()
  assert.equal(all.length, 2)
  assert.ok(!('password_hash' in all[0]))
  assert.deepEqual(listUsers({ search: 'bob' }).map((u) => u.handle), ['bob'])
})

test('updateUser only accepts whitelisted fields', () => {
  const id = createUser({ email: 'a@x.com', handle: 'aa' })
  updateUser(id, { status: 'disabled', role: 'admin' })
  assert.equal(getUserById(id).status, 'disabled')
  assert.equal(getUserById(id).role, 'admin')
  assert.throws(() => updateUser(id, { email: 'evil@x.com' }), /not updatable/)
})

test('identities: create, lookup, userHasIdentity, UNIQUE(issuer,subject)', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  assert.equal(userHasIdentity(uid), false)
  createIdentity({ userId: uid, issuer: 'https://idp.example.com', subject: 'sub-1' })
  assert.equal(userHasIdentity(uid), true)
  assert.equal(getIdentityByIssuerSubject('https://idp.example.com', 'sub-1').user_id, uid)
  assert.equal(getIdentityByIssuerSubject('https://idp.example.com', 'other'), null)
  assert.throws(() =>
    createIdentity({ userId: uid, issuer: 'https://idp.example.com', subject: 'sub-1' }))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/store-users.test.js`
Expected: FAIL — `Cannot find module '../src/store/users.js'`

- [ ] **Step 3: 实现 users.js 与 identities.js**

```javascript
// src/store/users.js
import { getDb } from './db.js'

export function createUser({ email, handle, displayName = '', role = 'user', passwordHash = null }) {
  return getDb().prepare(
    `INSERT INTO users (email, handle, display_name, role, password_hash, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(email, handle, displayName, role, passwordHash, Date.now()).lastInsertRowid
}

export function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null
}

export function getUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase()) ?? null
}

export function getUserByHandle(handle) {
  return getDb().prepare('SELECT * FROM users WHERE handle = ?').get(handle) ?? null
}

export function listUsers({ search } = {}) {
  const cols = 'id, email, handle, display_name, role, status, created_at'
  if (search) {
    return getDb().prepare(
      `SELECT ${cols} FROM users WHERE email LIKE ? OR handle LIKE ? OR display_name LIKE ?
       ORDER BY id`,
    ).all(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  return getDb().prepare(`SELECT ${cols} FROM users ORDER BY id`).all()
}

const UPDATABLE = new Set(['display_name', 'role', 'status'])
export function updateUser(id, fields) {
  const keys = Object.keys(fields)
  for (const k of keys) {
    if (!UPDATABLE.has(k)) throw new Error(`user field ${k} is not updatable`)
  }
  if (keys.length === 0) return
  const sets = keys.map((k) => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE users SET ${sets} WHERE id = @id`).run({ id, ...fields })
}

export function deriveUniqueHandle(seed) {
  const local = String(seed).split('@')[0].toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const base = local || 'user'
  let candidate = base
  for (let n = 2; getUserByHandle(candidate) !== null; n += 1) {
    candidate = `${base}-${n}`
  }
  return candidate
}
```

```javascript
// src/store/identities.js
import { getDb } from './db.js'

export function createIdentity({ userId, issuer, subject }) {
  getDb().prepare(
    'INSERT INTO identities (user_id, issuer, subject) VALUES (?,?,?)',
  ).run(userId, issuer, subject)
}

export function getIdentityByIssuerSubject(issuer, subject) {
  return getDb().prepare(
    'SELECT * FROM identities WHERE issuer = ? AND subject = ?',
  ).get(issuer, subject) ?? null
}

export function userHasIdentity(userId) {
  return getDb().prepare('SELECT 1 FROM identities WHERE user_id = ? LIMIT 1').get(userId) !== undefined
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/store-users.test.js`
Expected: 6 PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/users.js src/store/identities.js test/store-users.test.js
git commit -m "feat: users and identities data access"
```

---

### Task 2: 配置单例访问器 + sessions 数据访问

**Files:**
- Modify: `src/config.js`（追加 `setActiveConfig`/`getConfig`）
- Modify: `src/index.js`（启动时调用 `setActiveConfig`）
- Create: `src/store/sessions.js`
- Test: `test/store-sessions.test.js`

**Interfaces:**
- Consumes: `getDb()`、users store（Task 1）。
- Produces:
  - `setActiveConfig(config)` / `getConfig()`（`src/config.js`）— 与 `initDb`/`getDb` 同风格的进程级单例；store 层读 TTL 用。测试在 `beforeEach` 里 `initDb(':memory:')` + `setActiveConfig(loadConfig({...}))`。
  - `digestToken(token)` → sha256 hex
  - `insertSession({ token, userId, now = Date.now() })` — 按 `getConfig()` 的 TTL 计算 `expires_at`/`idle_expires_at`
  - `sessionForToken(token, { touch = true, now = Date.now() } = {})` → `{ user, session }` 或 null。过期即删；`user.status === 'disabled'` 时删除该用户全部会话并返回 null（spec §4「禁用用户：所有会话立即失效」）；touch 时滑动 `idle_expires_at`
  - `deleteSession(token)`、`deleteAllSessionsForUser(userId)`、`purgeExpiredSessions(now = Date.now())`

- [ ] **Step 1: 写失败的测试**

```javascript
// test/store-sessions.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { createUser, updateUser } from '../src/store/users.js'
import {
  digestToken, insertSession, sessionForToken,
  deleteSession, deleteAllSessionsForUser, purgeExpiredSessions,
} from '../src/store/sessions.js'

const config = loadConfig({
  SESSION_ABSOLUTE_TTL_MS: '1000',
  SESSION_IDLE_TTL_MS: '500',
})

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(config)
})

const token = 'a'.repeat(64)

test('insert + sessionForToken round-trip; db stores only the hash', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid, now: 1000 })
  const found = sessionForToken(token, { touch: false, now: 1100 })
  assert.equal(found.user.id, uid)
  assert.equal(found.user.handle, 'aa')
  assert.equal(found.session.expiresAt, 2000)
  assert.equal(found.session.idleExpiresAt, 1500)
  assert.equal(sessionForToken('b'.repeat(64), { now: 1100 }), null)
})

test('absolute expiry deletes the row', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid, now: 1000 })
  assert.equal(sessionForToken(token, { now: 2000 }), null)
  assert.equal(sessionForToken(token, { now: 1000 }), null) // 已删
})

test('idle expiry applies and touch slides the idle window', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid, now: 1000 })
  const touched = sessionForToken(token, { touch: true, now: 1400 })
  assert.equal(touched.session.idleExpiresAt, 1900) // 1400 + 500
  assert.equal(sessionForToken(token, { touch: false, now: 1899 }).user.id, uid)
  assert.equal(sessionForToken(token, { touch: false, now: 1900 }), null)
})

test('disabled user sessions are revoked immediately', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid, now: 1000 })
  updateUser(uid, { status: 'disabled' })
  assert.equal(sessionForToken(token, { now: 1100 }), null)
  // 该行已从库中删除
  assert.equal(sessionForToken(token, { now: 1100 }), null)
})

test('malformed tokens never hit the db', () => {
  assert.equal(sessionForToken('short'), null)
  assert.equal(sessionForToken(null), null)
  assert.equal(sessionForToken('g'.repeat(64)), null)
})

test('deleteSession / deleteAllSessionsForUser / purgeExpiredSessions', () => {
  const u1 = createUser({ email: 'a@x.com', handle: 'aa' })
  const u2 = createUser({ email: 'b@x.com', handle: 'bb' })
  const t2 = 'c'.repeat(64)
  insertSession({ token, userId: u1, now: 1000 })
  insertSession({ token: t2, userId: u2, now: 1000 })
  deleteSession(token)
  assert.equal(sessionForToken(token, { now: 1100 }), null)
  assert.notEqual(sessionForToken(t2, { touch: false, now: 1100 }), null)
  deleteAllSessionsForUser(u2)
  assert.equal(sessionForToken(t2, { now: 1100 }), null)
  insertSession({ token, userId: u1, now: 1000 })
  purgeExpiredSessions(2500)
  assert.equal(sessionForToken(token, { now: 2600 }), null)
})

test('digestToken is sha256 hex', () => {
  assert.match(digestToken('x'), /^[a-f0-9]{64}$/)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/store-sessions.test.js`
Expected: FAIL — `Cannot find module '../src/store/sessions.js'`

- [ ] **Step 3: 实现 config 单例与 sessions.js**

`src/config.js` 末尾追加：

```javascript
let activeConfig = null
export function setActiveConfig(config) {
  activeConfig = config
}
export function getConfig() {
  if (!activeConfig) throw new Error('config not initialized; call setActiveConfig() first')
  return activeConfig
}
```

`src/index.js` 在 `validateConfig(config)` 之后加入 `setActiveConfig(config)`（import 自 `./config.js`）。

```javascript
// src/store/sessions.js
import { createHash } from 'node:crypto'
import { getDb } from './db.js'
import { getConfig } from '../config.js'

export function digestToken(token) {
  return createHash('sha256').update(String(token ?? '')).digest('hex')
}

export function insertSession({ token, userId, now = Date.now() }) {
  const { sessionAbsoluteTtlMs, sessionIdleTtlMs } = getConfig()
  getDb().prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, idle_expires_at)
     VALUES (?,?,?,?,?)`,
  ).run(digestToken(token), userId, now, now + sessionAbsoluteTtlMs, now + sessionIdleTtlMs)
}

export function deleteSession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(digestToken(token))
}

export function deleteAllSessionsForUser(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function purgeExpiredSessions(now = Date.now()) {
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ? OR idle_expires_at <= ?')
    .run(now, now)
}

const SELECT = `
  SELECT u.id, u.email, u.handle, u.display_name, u.role, u.status,
         s.user_id, s.expires_at, s.idle_expires_at
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?`

export function sessionForToken(token, { touch = true, now = Date.now() } = {}) {
  if (!/^[a-f0-9]{64}$/.test(String(token ?? ''))) return null
  const db = getDb()
  const tokenHash = digestToken(token)
  const row = db.prepare(SELECT).get(tokenHash)
  if (!row) return null
  if (row.expires_at <= now || row.idle_expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return null
  }
  if (row.status === 'disabled') {
    deleteAllSessionsForUser(row.user_id)
    return null
  }
  const idleExpiresAt = now + getConfig().sessionIdleTtlMs
  if (touch) {
    db.prepare('UPDATE sessions SET idle_expires_at = ? WHERE token_hash = ?')
      .run(idleExpiresAt, tokenHash)
  }
  return {
    user: {
      id: row.id, email: row.email, handle: row.handle,
      display_name: row.display_name, role: row.role, status: row.status,
    },
    session: { expiresAt: row.expires_at, idleExpiresAt: touch ? idleExpiresAt : row.idle_expires_at },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/store-sessions.test.js`
Expected: 7 PASS

- [ ] **Step 5: 提交**

```bash
git add src/config.js src/index.js src/store/sessions.js test/store-sessions.test.js
git commit -m "feat: session storage with absolute/idle expiry and disable revocation"
```

---

### Task 3: 管理员引导播种

**Files:**
- Create: `src/auth/bootstrap.js`
- Modify: `src/index.js`（`initDb` 后调用 `ensureAdmin`）
- Test: `test/auth-bootstrap.test.js`

**Interfaces:**
- Consumes: users store（Task 1）、`writeAudit`（计划 01 Task 3）、`config.adminEmail/adminPassword`。
- Produces: `ensureAdmin(config)` → boolean（是否播种）。沿用 portal 语义：已有 admin → 直接返回；无 admin 且 env 缺失/密码 <16 位 → 抛错中止启动。管理员初始无 OIDC identity，因此可走密码登录端点（Task 5）。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/auth-bootstrap.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { initDb, getDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { getUserByEmail } from '../src/store/users.js'
import { listAudit } from '../src/store/audit.js'
import { ensureAdmin } from '../src/auth/bootstrap.js'

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({}))
})

test('seeds admin from env and is idempotent', () => {
  const config = loadConfig({ ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'a'.repeat(16) })
  assert.equal(ensureAdmin(config), true)
  const admin = getUserByEmail('root@x.com')
  assert.equal(admin.role, 'admin')
  assert.equal(admin.status, 'active')
  assert.ok(bcrypt.compareSync('a'.repeat(16), admin.password_hash))
  assert.equal(ensureAdmin(config), false) // 第二次不再播种
  assert.ok(listAudit({ action: 'user.create' }).length === 1)
})

test('throws when no admin exists and env is missing', () => {
  assert.throws(() => ensureAdmin(loadConfig({})), /ADMIN_EMAIL/)
})

test('throws for short password', () => {
  assert.throws(
    () => ensureAdmin(loadConfig({ ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'short' })),
    /16/,
  )
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/auth-bootstrap.test.js`
Expected: FAIL — `Cannot find module '../src/auth/bootstrap.js'`

- [ ] **Step 3: 实现 bootstrap.js 并接入 index.js**

```javascript
// src/auth/bootstrap.js
import bcrypt from 'bcryptjs'
import { getDb } from '../store/db.js'
import { createUser, deriveUniqueHandle } from '../store/users.js'
import { writeAudit } from '../store/audit.js'

/**
 * 平台首次启动且无 admin 时，从 ADMIN_EMAIL / ADMIN_PASSWORD 播种管理员
 * （spec §4「管理员引导密码」，沿用 portal 模式：无 admin 且 env 不全即中止启动）。
 */
export function ensureAdmin(config) {
  const existing = getDb().prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()
  if (existing) return false
  const password = String(config.adminPassword ?? '')
  if (!config.adminEmail || password.length < 16) {
    throw new Error('no admin exists: set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 16 characters')
  }
  const email = config.adminEmail.toLowerCase()
  const userId = createUser({
    email,
    handle: deriveUniqueHandle(email),
    displayName: 'Administrator',
    role: 'admin',
    passwordHash: bcrypt.hashSync(password, 10),
  })
  writeAudit({ actorId: userId, action: 'user.create', targetType: 'user', targetId: userId, detail: { method: 'bootstrap' } })
  console.log(`[dsh-spaces] seeded admin "${email}"`)
  return true
}
```

`src/index.js`：在 `initDb(...)` 之后加入

```javascript
import { ensureAdmin } from './auth/bootstrap.js'
// ...
ensureAdmin(config)
```

注意：此后本地启动必须提供 `ADMIN_EMAIL`/`ADMIN_PASSWORD`（复制 `.env.example` 到 `.env` 并填写，或在 shell 中导出）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/auth-bootstrap.test.js`
Expected: 3 PASS

- [ ] **Step 5: 提交**

```bash
git add src/auth/bootstrap.js src/index.js test/auth-bootstrap.test.js
git commit -m "feat: admin bootstrap seeding from env"
```

---

### Task 4: 会话中间件 + /api/auth/me + /api/auth/logout

**Files:**
- Create: `src/auth/middleware.js`
- Create: `src/auth/routes.js`
- Modify: `src/server.js`（根上下文挂 `resolveSession` 钩子 + 注册 auth 路由）
- Test: `test/auth-middleware.test.js`

**Interfaces:**
- Consumes: sessions store（Task 2）、`buildServer`/`apiError`（计划 01 Task 4）。
- Produces:
  - `SESSION_COOKIE = 'dsh_session'`（`src/auth/middleware.js` 导出，计划 04 gateway 复用）。
  - `resolveSession(req)` — `onRequest` 钩子函数：解析 cookie 并填充 `req.user`（全局解析，不做强制；在 `buildServer` 根上下文挂载）。
  - `requireUser` / `requireAdmin` — 作为路由级 `preHandler` 使用：`app.get('/x', { preHandler: requireUser }, handler)`。
  - `issueSession(reply, userId)` — 建会话 + 写 cookie（Task 5/6 的登录端点复用）。
  - `publicUser(user)` → `{ id, email, handle, displayName, role }`（所有 API 的用户出参形状，计划 03/05/06 复用）。
  - 路由：`GET /api/auth/me`、`POST /api/auth/logout`。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/auth-middleware.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { buildServer, apiError } from '../src/server.js'
import { createUser, updateUser } from '../src/store/users.js'
import { insertSession } from '../src/store/sessions.js'
import { requireUser, requireAdmin, SESSION_COOKIE } from '../src/auth/middleware.js'

const token = 'a'.repeat(64)
let app
let uid

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  insertSession({ token, userId: uid })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
  app.get('/api/_protected', { preHandler: requireUser }, async (req) => ({ handle: req.user.handle }))
  app.get('/api/_admin', { preHandler: requireAdmin }, async () => ({ ok: true }))
})

test('me/logout round-trip', async () => {
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(me.statusCode, 200)
  assert.deepEqual(me.json().user, { id: uid, email: 'a@x.com', handle: 'aa', displayName: '', role: 'user' })

  const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(out.statusCode, 200)
  const me2 = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(me2.statusCode, 401)
})

test('requireUser rejects anonymous and disabled users', async () => {
  const anon = await app.inject({ method: 'GET', url: '/api/_protected' })
  assert.equal(anon.statusCode, 401)
  assert.equal(anon.json().error.code, 'UNAUTHENTICATED')

  const ok = await app.inject({ method: 'GET', url: '/api/_protected', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().handle, 'aa')

  updateUser(uid, { status: 'disabled' })
  const disabled = await app.inject({ method: 'GET', url: '/api/_protected', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(disabled.statusCode, 401)
})

test('requireAdmin rejects non-admin with 403', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/_admin', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'FORBIDDEN')
  updateUser(uid, { role: 'admin' })
  const ok = await app.inject({ method: 'GET', url: '/api/_admin', cookies: { [SESSION_COOKIE]: token } })
  assert.equal(ok.statusCode, 200)
})

test('logout clears the cookie', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { [SESSION_COOKIE]: token } })
  const cleared = res.cookies.find((c) => c.name === SESSION_COOKIE)
  assert.ok(cleared)
  assert.equal(cleared.value, '')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/auth-middleware.test.js`
Expected: FAIL — `Cannot find module '../src/auth/middleware.js'`

- [ ] **Step 3: 实现 middleware.js、routes.js 并接入 server.js**

```javascript
// src/auth/middleware.js
import { randomBytes } from 'node:crypto'
import { apiError } from '../server.js'
import { getConfig } from '../config.js'
import { sessionForToken, insertSession, deleteSession } from '../store/sessions.js'

export const SESSION_COOKIE = 'dsh_session'

/** 解析会话 cookie 并填充 req.user（全局；强制由各路由 preHandler 决定）。
 *  注意：必须以根上下文 addHook 方式挂载（见下方 server.js 接线），
 *  不要用 app.register 包裹成插件——Fastify 封装上下文会让钩子对
 *  兄弟插件（spacesRoutes/adminRoutes 等）的路由不生效。 */
export async function resolveSession(req) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return
  const found = sessionForToken(token)
  if (found) req.user = found.user
}

export async function requireUser(req) {
  if (!req.user) throw apiError(401, 'UNAUTHENTICATED', '请先登录')
}

export async function requireAdmin(req) {
  if (!req.user) throw apiError(401, 'UNAUTHENTICATED', '请先登录')
  if (req.user.role !== 'admin') throw apiError(403, 'FORBIDDEN', '需要管理员权限')
}

export function issueSession(reply, userId) {
  const token = randomBytes(32).toString('hex')
  insertSession({ token, userId })
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: getConfig().cookieSecure,
    sameSite: 'lax',
    maxAge: Math.floor(getConfig().sessionAbsoluteTtlMs / 1000),
  })
  return token
}

export function clearSession(req, reply) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (token) deleteSession(token)
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    displayName: user.display_name,
    role: user.role,
  }
}
```

```javascript
// src/auth/routes.js
import { writeAudit } from '../store/audit.js'
import { requireUser, clearSession, publicUser } from './middleware.js'
import { passwordLoginRoutes } from './password-login.js'
import { oidcRoutes } from './oidc.js'

export async function authRoutes(app) {
  app.get('/me', { preHandler: requireUser }, async (req) => ({ user: publicUser(req.user) }))

  app.post('/logout', async (req, reply) => {
    if (req.user) {
      writeAudit({ actorId: req.user.id, action: 'user.logout', targetType: 'user', targetId: req.user.id })
    }
    clearSession(req, reply)
    return { ok: true }
  })

  await app.register(passwordLoginRoutes) // Task 5
  await app.register(oidcRoutes)          // Task 6
}
```

Task 5/6 之前，`password-login.js`/`oidc.js` 尚不存在——本 Task 的提交版本先不 register 这两个（只保留 me/logout），后续 Task 各自补上 register 行。

`src/server.js` 的 `buildServer` 中，在 `app.register(cookie)` 之后加入：

```javascript
import { resolveSession } from './auth/middleware.js'
import { authRoutes } from './auth/routes.js'
// ...
// 根上下文直接挂（不要 app.register 包裹，否则封装上下文会让钩子对兄弟插件路由失效）：
app.decorateRequest('user', null)
app.addHook('onRequest', resolveSession)
await app.register(authRoutes, { prefix: '/api/auth' })
```

（`buildServer` 变为 async 函数；调用方 `await buildServer(...)`。同步修改 `test/server.test.js`、`test/static-spa.test.js` 的调用为 `await buildServer(...)`。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/auth-middleware.test.js test/server.test.js test/static-spa.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/auth/middleware.js src/auth/routes.js src/server.js test/auth-middleware.test.js test/server.test.js test/static-spa.test.js
git commit -m "feat: session middleware, /api/auth/me and logout"
```

---

### Task 5: 密码登录端点（含限流）

**Files:**
- Create: `src/auth/password-login.js`
- Modify: `src/auth/routes.js`（注册 passwordLoginRoutes）
- Test: `test/auth-password-login.test.js`

**Interfaces:**
- Consumes: users/identities/sessions stores（Task 1/2）、`issueSession`/`publicUser`（Task 4）、`getSetting`。
- Produces: `POST /api/auth/password-login`，body `{email, password}`。开放条件（spec §4）：用户存在、有 `password_hash`、**无 OIDC identity**、`password_login_enabled` 设置开启、用户 `status=active`——任一不满足按 Global Constraints 统一返回 401 `INVALID_CREDENTIALS`（设置关闭除外：403 `PASSWORD_LOGIN_UNAVAILABLE`）。限流：内存 Map 按邮箱计数，15 分钟窗口内 5 次失败 → 429 `RATE_LIMITED`（进程重启清零，v1 可接受）。

- [ ] **Step 1: 写失败的测试**

```javascript
// test/auth-password-login.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { initDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'
import { createUser } from '../src/store/users.js'
import { createIdentity } from '../src/store/identities.js'
import { setSetting } from '../src/store/settings.js'
import { listAudit } from '../src/store/audit.js'
import { SESSION_COOKIE, resetPasswordRateLimits } from '../src/auth/middleware.js'
// resetPasswordRateLimits 从 password-login.js 导出、经 middleware re-export 不需要——
// 直接从 password-login.js 导入：
import { resetPasswordRateLimits as resetLimits } from '../src/auth/password-login.js'

const PASSWORD = 'correct-horse-battery'
let app
let uid

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  resetLimits()
  uid = createUser({
    email: 'root@x.com', handle: 'root',
    passwordHash: bcrypt.hashSync(PASSWORD, 10), role: 'admin',
  })
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
})

function login(email, password) {
  return app.inject({
    method: 'POST', url: '/api/auth/password-login',
    payload: { email, password },
    headers: { 'content-type': 'application/json' },
  })
}

test('successful login sets session cookie and writes audit', async () => {
  const res = await login('root@x.com', PASSWORD)
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().user.handle, 'root')
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)
  assert.ok(cookie && /^[a-f0-9]{64}$/.test(cookie.value))
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.sameSite, 'Lax')
  assert.equal(listAudit({ action: 'user.login' })[0].actor_id, uid)
})

test('wrong password / unknown user share the same 401', async () => {
  const wrong = await login('root@x.com', 'nope')
  const unknown = await login('ghost@x.com', 'nope')
  for (const res of [wrong, unknown]) {
    assert.equal(res.statusCode, 401)
    assert.equal(res.json().error.code, 'INVALID_CREDENTIALS')
  }
})

test('user with OIDC identity cannot use password login', async () => {
  createIdentity({ userId: uid, issuer: 'https://idp.example.com', subject: 'sub-1' })
  const res = await login('root@x.com', PASSWORD)
  assert.equal(res.statusCode, 401)
})

test('disabled password_login setting returns 403', async () => {
  setSetting('password_login_enabled', 'false')
  const res = await login('root@x.com', PASSWORD)
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'PASSWORD_LOGIN_UNAVAILABLE')
})

test('five failures in the window trigger 429', async () => {
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await login('root@x.com', 'bad')).statusCode, 401)
  }
  const res = await login('root@x.com', PASSWORD) // 正确密码也被限流
  assert.equal(res.statusCode, 429)
  assert.equal(res.json().error.code, 'RATE_LIMITED')
})
```

（测试文件顶部两行 import 二选一，以实际导出为准——实现里 `resetPasswordRateLimits` 由 `password-login.js` 导出，middleware.js 不 re-export；写测试时只保留 `import { resetPasswordRateLimits } from '../src/auth/password-login.js'` 一行。）

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/auth-password-login.test.js`
Expected: FAIL — `Cannot find module '../src/auth/password-login.js'`

- [ ] **Step 3: 实现 password-login.js**

```javascript
// src/auth/password-login.js
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { apiError } from '../server.js'
import { getUserByEmail } from '../store/users.js'
import { userHasIdentity } from '../store/identities.js'
import { getSetting } from '../store/settings.js'
import { writeAudit } from '../store/audit.js'
import { issueSession, publicUser } from './middleware.js'

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const failures = new Map() // email -> { count, windowStart }

export function resetPasswordRateLimits() {
  failures.clear()
}

function checkRateLimit(email, now = Date.now()) {
  const entry = failures.get(email)
  if (!entry) return
  if (now - entry.windowStart >= WINDOW_MS) {
    failures.delete(email)
    return
  }
  if (entry.count >= MAX_FAILURES) {
    throw apiError(429, 'RATE_LIMITED', '尝试过于频繁，请 15 分钟后再试')
  }
}

function recordFailure(email, now = Date.now()) {
  const entry = failures.get(email)
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    failures.set(email, { count: 1, windowStart: now })
  } else {
    entry.count += 1
  }
}

export async function passwordLoginRoutes(app) {
  app.post('/password-login', {
    schema: { body: z.object({ email: z.string().email(), password: z.string().min(1) }) },
  }, async (req, reply) => {
    const email = req.body.email.toLowerCase()
    if (getSetting('password_login_enabled', 'true') !== 'true') {
      throw apiError(403, 'PASSWORD_LOGIN_UNAVAILABLE', '密码登录已关闭，请使用 OIDC 登录')
    }
    checkRateLimit(email)
    const user = getUserByEmail(email)
    const allowed = user
      && user.status === 'active'
      && user.password_hash
      && !userHasIdentity(user.id)
    const ok = allowed && bcrypt.compareSync(req.body.password, user.password_hash)
    if (!ok) {
      recordFailure(email)
      throw apiError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误')
    }
    failures.delete(email)
    issueSession(reply, user.id)
    writeAudit({ actorId: user.id, action: 'user.login', targetType: 'user', targetId: user.id, detail: { method: 'password' } })
    return { user: publicUser(user) }
  })
}
```

`src/auth/routes.js` 中加入（取消 Task 4 的占位注释）：

```javascript
import { passwordLoginRoutes } from './password-login.js'
// authRoutes 内：
await app.register(passwordLoginRoutes)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/auth-password-login.test.js`
Expected: 5 PASS

- [ ] **Step 5: 提交**

```bash
git add src/auth/password-login.js src/auth/routes.js test/auth-password-login.test.js
git commit -m "feat: bootstrap password login with rate limiting"
```

---

### Task 6: OIDC 登录与回调

**Files:**
- Create: `src/auth/oidc.js`
- Create: `src/auth/identity.js`
- Create: `src/spaces/service.js`（no-op stub，计划 03 替换）
- Modify: `src/auth/routes.js`（注册 oidcRoutes）
- Test: `test/auth-identity.test.js`
- Test: `test/auth-oidc.test.js`

**Interfaces:**
- Consumes: users/identities/sessions stores、`issueSession`、`getSetting`、`getConfig()`、`writeAudit`。
- Produces:
  - `GET /api/auth/login?return_to=/path` → 302 到 IdP；`GET /api/auth/callback` → 建会话 + 302 回 `return_to`。
  - `resolveOidcIdentity({ issuer, claims })` → `{ userId, created }`（`src/auth/identity.js`，事务内执行）。
  - `provisionNewUser(userId)`（`src/spaces/service.js`）— 计划 03 实现个人空间惰性创建；本计划为 no-op stub。
  - OIDC 事务 cookie `dsh_oidc_txn`：JSON `{state, nonce, codeVerifier, returnTo}`，path=`/api/auth`，10 分钟。

- [ ] **Step 1: 写 identity 解析的失败测试**

```javascript
// test/auth-identity.test.js
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { createUser, getUserById } from '../src/store/users.js'
import { getIdentityByIssuerSubject, userHasIdentity } from '../src/store/identities.js'
import { listAudit } from '../src/store/audit.js'
import { resolveOidcIdentity } from '../src/auth/identity.js'

const ISSUER = 'https://idp.example.com'

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({}))
})

test('known identity logs in the bound user', () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  const first = resolveOidcIdentity({
    issuer: ISSUER,
    claims: { sub: 'sub-1', email: 'a@x.com', email_verified: true },
  })
  assert.equal(first.created, true)
  const again = resolveOidcIdentity({ issuer: ISSUER, claims: { sub: 'sub-1' } })
  assert.deepEqual(again, { userId: first.userId, created: false })
  assert.equal(uid === first.userId, false) // 创建了全新用户
})

test('verified email binds to the existing user', () => {
  const uid = createUser({ email: 'admin@x.com', handle: 'admin' })
  const res = resolveOidcIdentity({
    issuer: ISSUER,
    claims: { sub: 'sub-9', email: 'admin@x.com', email_verified: true, name: 'Admin' },
  })
  assert.deepEqual(res, { userId: uid, created: false })
  assert.equal(getIdentityByIssuerSubject(ISSUER, 'sub-9').user_id, uid)
  assert.ok(listAudit({ action: 'identity.bind' }).length === 1)
})

test('unverified email never binds; a new user is created instead', () => {
  const uid = createUser({ email: 'victim@x.com', handle: 'victim' })
  const res = resolveOidcIdentity({
    issuer: ISSUER,
    claims: { sub: 'attacker', email: 'victim@x.com', email_verified: false },
  })
  assert.equal(res.created, true)
  assert.notEqual(res.userId, uid)
  // attacker 的 synthetic 邮箱不是 victim 的
  assert.notEqual(getUserById(res.userId).email, 'victim@x.com')
  assert.equal(userHasIdentity(uid), false)
})

test('missing email falls back to a synthetic mailbox', () => {
  const res = resolveOidcIdentity({ issuer: ISSUER, claims: { sub: 'sub-42', name: 'No Mail' } })
  const user = getUserById(res.userId)
  assert.match(user.email, /@oidc\.local$/)
  assert.equal(user.display_name, 'No Mail')
})

test('handle collisions get suffixed', () => {
  createUser({ email: 'sam@a.com', handle: 'sam' })
  const res = resolveOidcIdentity({
    issuer: ISSUER,
    claims: { sub: 'sub-7', email: 'sam@b.com', email_verified: true },
  })
  assert.equal(getUserById(res.userId).handle, 'sam-2')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/auth-identity.test.js`
Expected: FAIL — `Cannot find module '../src/auth/identity.js'`

- [ ] **Step 3: 实现 identity.js 与 spaces/service.js stub**

```javascript
// src/auth/identity.js
import { getDb } from '../store/db.js'
import { createUser, getUserByEmail, deriveUniqueHandle } from '../store/users.js'
import { createIdentity, getIdentityByIssuerSubject } from '../store/identities.js'
import { writeAudit } from '../store/audit.js'

/**
 * spec §4 step 3：按 (issuer, subject) 查 identity → 命中即登录；
 * 未命中且 email 经 IdP 验证 → 绑定已有用户；
 * 否则创建新用户（调用方负责随后 provisionNewUser）。
 */
export function resolveOidcIdentity({ issuer, claims }) {
  const subject = String(claims.sub)
  return getDb().transaction(() => {
    const existing = getIdentityByIssuerSubject(issuer, subject)
    if (existing) return { userId: existing.user_id, created: false }

    const email = String(claims.email ?? '').toLowerCase()
    if (email && claims.email_verified === true) {
      const user = getUserByEmail(email)
      if (user) {
        createIdentity({ userId: user.id, issuer, subject })
        writeAudit({ actorId: user.id, action: 'identity.bind', targetType: 'user', targetId: user.id, detail: { issuer } })
        return { userId: user.id, created: false }
      }
    }

    // 无（可信）邮箱时用 synthetic 邮箱，保证 email 列非空且可区分来源。
    const effectiveEmail = (email && claims.email_verified === true)
      ? email
      : `${encodeURIComponent(subject)}@oidc.local`
    const userId = createUser({
      email: effectiveEmail,
      handle: deriveUniqueHandle(email || subject),
      displayName: String(claims.name ?? ''),
    })
    createIdentity({ userId, issuer, subject })
    writeAudit({ actorId: userId, action: 'user.create', targetType: 'user', targetId: userId, detail: { method: 'oidc', issuer } })
    return { userId, created: true }
  })()
}
```

```javascript
// src/spaces/service.js
// 计划 03 在此实现个人空间惰性创建（创建 personal 空间 + 共享卷 + 私有卷）。
// 计划 02 仅提供接缝：OIDC 首次登录创建用户后调用。
export function provisionNewUser() {}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/auth-identity.test.js`
Expected: 5 PASS

- [ ] **Step 5: 写 OIDC 路由的失败测试**

```javascript
// test/auth-oidc.test.js
import { test, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'

// openid-client 全部 mock：不触网。
vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({
    serverMetadata: () => ({ issuer: 'https://idp.example.com' }),
  })),
  randomState: () => 'state-123',
  randomNonce: () => 'nonce-123',
  randomPKCECodeVerifier: () => 'verifier-123',
  calculatePKCECodeChallenge: async () => 'challenge-123',
  buildAuthorizationUrl: (_config, params) =>
    new URL(`https://idp.example.com/authorize?state=${params.state}&nonce=${params.nonce}`
      + `&redirect_uri=${encodeURIComponent(params.redirect_uri)}`
      + `&code_challenge=${params.code_challenge}`),
  authorizationCodeGrant: vi.fn(async () => ({
    claims: () => ({ sub: 'sub-1', email: 'new@x.com', email_verified: true, name: 'New User' }),
  })),
}))

import { initDb, getDb } from '../src/store/db.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'
import { setSetting } from '../src/store/settings.js'
import { getUserByEmail } from '../src/store/users.js'
import { listAudit } from '../src/store/audit.js'
import { SESSION_COOKIE } from '../src/auth/middleware.js'

let app

beforeEach(async () => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development', PLATFORM_ORIGIN: 'http://localhost:8080' }))
  setSetting('oidc_issuer', 'https://idp.example.com')
  setSetting('oidc_client_id', 'dsh-spaces')
  setSetting('oidc_client_secret', 'secret')
  app = await buildServer({ config: loadConfig({ NODE_ENV: 'development', PLATFORM_ORIGIN: 'http://localhost:8080' }) })
})

test('login redirects to the IdP with PKCE params and sets txn cookie', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/login?return_to=/spaces' })
  assert.equal(res.statusCode, 302)
  const location = new URL(res.headers.location)
  assert.equal(location.origin, 'https://idp.example.com')
  assert.equal(location.searchParams.get('state'), 'state-123')
  assert.equal(location.searchParams.get('code_challenge'), 'challenge-123')
  assert.equal(location.searchParams.get('redirect_uri'), 'http://localhost:8080/api/auth/callback')
  const txn = res.cookies.find((c) => c.name === 'dsh_oidc_txn')
  assert.ok(txn)
  assert.equal(txn.httpOnly, true)
  const payload = JSON.parse(txn.value)
  assert.equal(payload.returnTo, '/spaces')
  assert.equal(payload.codeVerifier, 'verifier-123')
})

test('login rejects open redirects via return_to', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/login?return_to=//evil.com' })
  const txn = res.cookies.find((c) => c.name === 'dsh_oidc_txn')
  assert.equal(JSON.parse(txn.value).returnTo, '/')
})

test('OIDC not configured returns 503', async () => {
  initDb(':memory:') // 清掉 oidc 设置
  const res = await app.inject({ method: 'GET', url: '/api/auth/login' })
  assert.equal(res.statusCode, 503)
  assert.equal(res.json().error.code, 'OIDC_NOT_CONFIGURED')
})

test('callback creates user, session, and redirects to return_to', async () => {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login?return_to=/spaces' })
  const txn = login.cookies.find((c) => c.name === 'dsh_oidc_txn')
  const cb = await app.inject({
    method: 'GET',
    url: '/api/auth/callback?code=code-1&state=state-123',
    cookies: { dsh_oidc_txn: txn.value },
  })
  assert.equal(cb.statusCode, 302)
  assert.equal(cb.headers.location, '/spaces')
  const session = cb.cookies.find((c) => c.name === SESSION_COOKIE)
  assert.ok(session && /^[a-f0-9]{64}$/.test(session.value))
  const user = getUserByEmail('new@x.com')
  assert.ok(user)
  assert.equal(user.display_name, 'New User')
  assert.ok(listAudit({ action: 'user.create' }).length === 1)
  assert.ok(listAudit({ action: 'user.login' }).length === 1)
})

test('callback without txn cookie returns 400', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/callback?code=x&state=y' })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, 'OIDC_CALLBACK_INVALID')
})
```

- [ ] **Step 6: 运行测试确认失败**

Run: `npx vitest run test/auth-oidc.test.js`
Expected: FAIL — `Cannot find module '../src/auth/oidc.js'`

- [ ] **Step 7: 实现 oidc.js 并注册路由**

```javascript
// src/auth/oidc.js
import * as oidc from 'openid-client'
import { apiError } from '../server.js'
import { getConfig } from '../config.js'
import { getSetting } from '../store/settings.js'
import { writeAudit } from '../store/audit.js'
import { getUserById } from '../store/users.js'
import { issueSession } from './middleware.js'
import { resolveOidcIdentity } from './identity.js'
import { provisionNewUser } from '../spaces/service.js'

export const OIDC_TXN_COOKIE = 'dsh_oidc_txn'
const TXN_MAX_AGE_S = 600

let cached = null // { key, configuration }

/** discovery 结果按 (issuer, clientId) 缓存；配置在管理后台改动后自动失效。 */
async function getOidcConfiguration() {
  const issuer = getSetting('oidc_issuer')
  const clientId = getSetting('oidc_client_id')
  if (!issuer || !clientId) {
    throw apiError(503, 'OIDC_NOT_CONFIGURED', '平台尚未配置 OIDC 登录')
  }
  const key = `${issuer}|${clientId}`
  if (cached?.key === key) return cached.configuration
  let configuration
  try {
    configuration = await oidc.discovery(
      new URL(issuer), clientId, getSetting('oidc_client_secret') || undefined,
    )
  } catch (err) {
    throw apiError(502, 'OIDC_UNAVAILABLE', `无法连接身份提供方：${err.message}`)
  }
  cached = { key, configuration }
  return configuration
}

function safeReturnTo(value) {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : '/'
}

export async function oidcRoutes(app) {
  app.get('/login', async (req, reply) => {
    const configuration = await getOidcConfiguration()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    const codeVerifier = oidc.randomPKCECodeVerifier()
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
    const txn = JSON.stringify({
      state, nonce, codeVerifier, returnTo: safeReturnTo(req.query.return_to),
    })
    reply.setCookie(OIDC_TXN_COOKIE, txn, {
      path: '/api/auth', httpOnly: true,
      secure: getConfig().cookieSecure, sameSite: 'lax', maxAge: TXN_MAX_AGE_S,
    })
    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: `${getConfig().platformOrigin}/api/auth/callback`,
      scope: getSetting('oidc_scope', 'openid profile email'),
      state, nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return reply.redirect(url.href)
  })

  app.get('/callback', async (req, reply) => {
    const raw = req.cookies?.[OIDC_TXN_COOKIE]
    reply.clearCookie(OIDC_TXN_COOKIE, { path: '/api/auth' })
    let txn
    try {
      txn = JSON.parse(raw ?? '')
    } catch {
      throw apiError(400, 'OIDC_CALLBACK_INVALID', '登录会话已过期，请重新登录')
    }
    const configuration = await getOidcConfiguration()
    let claims
    try {
      const tokens = await oidc.authorizationCodeGrant(
        configuration,
        new URL(req.url, getConfig().platformOrigin),
        {
          pkceCodeVerifier: txn.codeVerifier,
          expectedState: txn.state,
          expectedNonce: txn.nonce,
          idTokenExpected: true,
        },
      )
      claims = tokens.claims()
    } catch (err) {
      req.log.warn({ err }, 'oidc callback failed')
      throw apiError(400, 'OIDC_CALLBACK_INVALID', '登录校验失败，请重新登录')
    }
    if (!claims?.sub) {
      throw apiError(400, 'OIDC_CALLBACK_INVALID', '身份提供方返回缺少 subject')
    }
    const issuer = configuration.serverMetadata().issuer
    const { userId, created } = resolveOidcIdentity({ issuer, claims })
    if (created) provisionNewUser(userId)
    const user = getUserById(userId)
    if (!user || user.status !== 'active') {
      throw apiError(403, 'FORBIDDEN', '账号已被禁用')
    }
    issueSession(reply, userId)
    writeAudit({ actorId: userId, action: 'user.login', targetType: 'user', targetId: userId, detail: { method: 'oidc', issuer } })
    return reply.redirect(safeReturnTo(txn.returnTo))
  })
}
```

`src/auth/routes.js` 中加入：

```javascript
import { oidcRoutes } from './oidc.js'
// authRoutes 内：
await app.register(oidcRoutes)
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npx vitest run test/auth-oidc.test.js test/auth-identity.test.js`
Expected: 全部 PASS

- [ ] **Step 9: 提交**

```bash
git add src/auth/oidc.js src/auth/identity.js src/spaces/service.js src/auth/routes.js test/auth-oidc.test.js test/auth-identity.test.js
git commit -m "feat: oidc authorization code + pkce login flow"
```

---

### Task 7: 登录 UI 与路由守卫

**Files:**
- Create: `src/web/src/api.ts`
- Create: `src/web/src/pages/Login.tsx`
- Create: `src/web/src/components/RequireAuth.tsx`
- Modify: `src/web/src/App.tsx`（路由）

**Interfaces:**
- Consumes: `/api/auth/me`、`/api/auth/login`、`/api/auth/password-login`、`/api/auth/logout`。
- Produces（计划 03+ 前端复用）：
  - `apiFetch<T>(path, init?)`（`src/web/src/api.ts`）— 相对路径 fetch，错误 envelope 抛 `ApiRequestError {status, code, message}`。
  - `useMe()` hook（`src/web/src/components/RequireAuth.tsx` 内导出）→ `{ user, loading }`。
  - `<RequireAuth>` 路由守卫：未登录跳 `/login?return_to=<current>`。
  - 登录页 `/login`。

- [ ] **Step 1: 写 api.ts**

```typescript
// src/web/src/api.ts
export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string } } | null = null
    try {
      body = await res.json()
    } catch {
      // 非 JSON 错误体
    }
    throw new ApiRequestError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `请求失败（${res.status}）`,
    )
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export interface Me {
  id: number
  email: string
  handle: string
  displayName: string
  role: 'admin' | 'user'
}
```

- [ ] **Step 2: 写 RequireAuth.tsx**

```tsx
// src/web/src/components/RequireAuth.tsx
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { apiFetch, type Me } from '../api'

let cachedUser: Me | null | undefined

export function useMe(): { user: Me | null; loading: boolean; refresh: () => void } {
  const [user, setUser] = useState<Me | null>(cachedUser ?? null)
  const [loading, setLoading] = useState(cachedUser === undefined)
  const refresh = () => {
    setLoading(true)
    apiFetch<{ user: Me }>('/api/auth/me')
      .then((r) => { cachedUser = r.user; setUser(r.user) })
      .catch(() => { cachedUser = null; setUser(null) })
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])
  return { user, loading, refresh }
}

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useMe()
  const location = useLocation()
  if (loading) return <main className="page"><p className="body">加载中…</p></main>
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?return_to=${returnTo}`} replace />
  }
  return <>{children}</>
}
```

- [ ] **Step 3: 写 Login.tsx**

```tsx
// src/web/src/pages/Login.tsx
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, ApiRequestError } from '../api'

export default function Login() {
  const [params] = useSearchParams()
  const returnTo = params.get('return_to') ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const oidcHref = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await apiFetch('/api/auth/password-login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      window.location.assign(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/')
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message)
      else setError('网络错误，请稍后重试')
    }
  }

  return (
    <main className="page" style={{ maxWidth: '40ch' }}>
      <h1 className="title">登录 dsh-spaces</h1>
      <p className="body">使用组织账号登录，或在平台尚未配置 OIDC 时使用管理员密码。</p>
      <p>
        <a href={oidcHref}><button type="button">使用 OIDC 登录</button></a>
      </p>
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '24px 0' }} />
      <form onSubmit={submitPassword}>
        <p>
          <label>邮箱<br />
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              type="email" required autoComplete="username" />
          </label>
        </p>
        <p>
          <label>密码<br />
            <input value={password} onChange={(e) => setPassword(e.target.value)}
              type="password" required autoComplete="current-password" />
          </label>
        </p>
        {error && <p style={{ color: 'var(--error)' }} role="alert">{error}</p>}
        <button type="submit">密码登录</button>
      </form>
    </main>
  )
}
```

`src/web/src/base.css` 追加输入框样式（保持单色语言）：

```css
input {
  font: inherit; color: var(--fg); background: var(--bg);
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px;
  width: 100%; max-width: 32ch;
}
input:focus { outline: 1px solid var(--muted); }
```

- [ ] **Step 4: 更新 App.tsx 路由**

```tsx
// src/web/src/App.tsx
import { Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import RequireAuth from './components/RequireAuth'

function Home() {
  return (
    <main className="page">
      <h1 className="title">dsh-spaces</h1>
      <p className="body">平台骨架已就绪。</p>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
    </Routes>
  )
}
```

- [ ] **Step 5: 构建前端验证类型与产物**

Run: `npm run build:web`
Expected: 无 TS 错误，dist 产物更新

- [ ] **Step 6: 运行全部服务端测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/web
git commit -m "feat: login page with oidc entry and password form"
```

---

## 收尾自查（执行者完成全部 Task 后确认）

- [ ] spec §4 全覆盖：OIDC 主路径（state/nonce/PKCE/email_verified 绑定）、管理员引导（≥16 位、无 identity 才开放密码登录、设置可关闭）、会话语义（7d/24h 滑动、禁用即失效）、平台角色与空间角色正交（空间角色在计划 03/05）。
- [ ] spec §9：OIDC 故障 503/502/400 三类路径有测试；已登录会话不受 IdP 故障影响（会话校验纯本地，无 IdP 调用）。
- [ ] `npm test` 全绿；`npm run build:web` 无错。
