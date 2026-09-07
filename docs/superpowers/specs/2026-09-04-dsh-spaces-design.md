# dsh-spaces 云 DSH 平台设计

- 日期：2026-09-04
- 状态：待评审
- 前置调研：`deepseek-harness`（DeepSeek 开源 agent runtime，单机本地产品，CLI + Web UI + SDK）、`deepseek-harness-portal`（已有多租户雏形：Fastify + SQLite + Podman，邮箱 OTP + 密码认证，每用户 1:1 容器实例）

## 1. 目标与范围

搭建一个云平台：用户登录后拥有**个人空间**，并可创建/加入**团队空间**（多人共享存储与配额，成员各自独立实例）。平台支持 OIDC 登录（密码仅用于管理员引导），管理员可管理平台的用户、空间、实例、镜像与配额。容器编排基于单机 Docker。

**v1 范围**：

- OIDC 认证 + 管理员引导密码
- 个人空间（首登自动创建）与团队空间（创建、邀请、成员管理）
- 每（空间 × 成员）一个 dsh 容器实例，空间级共享卷 + 成员级私有卷
- 单域名路径路由反代到实例的 dsh Web UI
- 管理后台：用户管理、空间与实例管理、平台设置与镜像、用量监控与审计
- 单机 Docker 编排，dsh 镜像安全构建管线（移植自 portal）

**明确不做（YAGNI）**：

- 多机调度 / Kubernetes（架构上预留拆分可能，不实现）
- 计费、用量计费报表
- 空间内细粒度权限（v1 只有 owner/member 两档）
- 多 OIDC provider 并存（v1 单 provider）
- dsh 实例内的协作功能（会话共享等）——dsh 是单用户设计，不改造其内部

## 2. 总体架构

单进程控制面。一个 Fastify 5 进程（Node 24）承载：OIDC 认证、Spaces/Admin REST API、Docker 编排、路径反代、React SPA 静态托管。SQLite 单文件存储。部署为一个容器 + 挂载 `/var/run/docker.sock`。

### 进程内模块划分

模块各自独立目录，只通过公开接口调用，为未来拆分为独立 gateway/control-plane 进程留路：

```
src/
├── gateway/      # 反代热路径：/s/<space-slug>/<username>/... → 实例容器
│                 #   会话校验、成员资格校验、路径原样透传、WebSocket 升级转发
├── auth/         # OIDC authorization code + PKCE 流程、会话（cookie + SQLite
│                 #   token，7 天绝对 / 24 小时空闲）、管理员引导密码登录
├── spaces/       # 空间/成员/实例的 REST API 与业务规则
├── orchestrator/ # Docker 编排（dockerode）：实例与卷的创建/启停/销毁、
│                 #   资源限额、崩溃状态回收；移植改造 portal orchestrator.js
├── admin/        # 管理 API：用户、空间、配额、镜像、用量、审计
├── imagebuild/   # dsh 镜像构建管线：移植 portal build-image.sh 安全流程
│                 #   （固定 commit、工作区干净校验、patch 可应用校验、
│                 #   .dockerignore 白名单、git archive 干净上下文、digest 锁定）
├── store/        # better-sqlite3 数据访问层 + migration
└── web/          # React + Vite SPA，构建产物由 Fastify 托管
```

### 关键数据流

1. 浏览器请求单一域名，Fastify 按路径三分流：`/api/*` → API 模块；`/s/*` → gateway 反代；其余 → React SPA 静态资源。
2. API 请求经会话中间件鉴权后进入 `spaces`/`admin`；编排操作由 `orchestrator` 调 docker socket 完成。
3. `/s/<space-slug>/<username>/...` 请求由 gateway 校验会话与（空间 × 用户）成员资格，解析到 `dsh-<space-slug>-<username>` 容器的 `127.0.0.1:<port>`，路径原样反代（含 WebSocket）——实例以 `--base-path=/s/<space-slug>/<username>` 启动，只在该前缀下服务。

### 部署拓扑

```
┌──────────── 宿主机 ────────────┐
│  dsh-spaces 容器               │─── /var/run/docker.sock
│   └─ Fastify (API+gateway+SPA) │─── SQLite 数据卷
│  dsh-<space>-<user> 容器 × N   │◄── orchestrator 创建
│   ├─ 挂载: 空间共享卷           │
│   └─ 挂载: 成员私有卷           │
│  租户出口防火墙 (nftables)      │   移植 portal firewall/
└────────────────────────────────┘
         单域名 HTTPS 入口
```

## 3. 数据模型（SQLite）

```sql
users          (id, email UNIQUE, display_name, role[admin|user],
                status[active|disabled], created_at)
identities     (id, user_id → users, issuer, subject,
                UNIQUE(issuer, subject))          -- OIDC 账户绑定
sessions       (token PK, user_id, created_at, expires_at, idle_expires_at)
                -- 7 天绝对过期 / 24 小时空闲过期，沿用 portal 语义
spaces         (id, slug UNIQUE, name, kind[personal|team],
                owner_id → users,
                quota_cpu, quota_mem_mb, quota_instances,   -- NULL = 用平台默认
                created_at)
space_members  (space_id, user_id, role[owner|member], created_at,
                PRIMARY KEY (space_id, user_id))
volumes        (id, space_id, kind[shared|private], user_id NULL,
                docker_name UNIQUE)               -- private 卷带 user_id
instances      (id, space_id, user_id, container_name UNIQUE, port,
                status[stopped|starting|running|error],
                image_digest, last_active_at, created_at,
                UNIQUE (space_id, user_id))
settings       (key PK, value)   -- OIDC 配置、平台默认配额、当前镜像 digest
audit_log      (id, actor_id, action, target_type, target_id,
                detail_json, created_at)
```

规则：

- **个人空间惰性创建**：OIDC 首次登录成功后自动创建 `kind=personal` 空间（slug 从邮箱/用户名派生，冲突加后缀）及其卷。
- **实例键为 (space_id, user_id)**：团队空间内每成员至多一个实例。
- **配额不落统计表**：配额 = `settings` 平台默认 + `spaces` 覆盖字段，编排时现算；用量由 `docker stats`/`docker system df` 实时查询，避免双写不一致。
- **审计只写管理面动作**：登录、空间建/删、成员增删、角色变更、实例管理操作、镜像重建、设置修改。实例内部的用户操作归 dsh 自己管。

## 4. 认证流程

### OIDC（主路径）

1. `GET /api/auth/login` → 重定向到 IdP authorization endpoint（authorization code + PKCE + state/nonce 存短期 cookie）。
2. 回跳 `/api/auth/callback`：验 state/nonce，code 换 token，验 ID token 签名与 `iss`/`aud`/`exp`。
3. 按 `(issuer, subject)` 查 `identities`：存在 → 登录对应用户；不存在 → 按 email 匹配已有用户并绑定（email 需 IdP 已验证，`email_verified=true`）；无匹配 → 创建用户 + 惰性创建个人空间。
4. 建会话（httpOnly + Secure + SameSite=Lax cookie），跳转回原始目标路径。

### 管理员引导密码

- 平台首次启动且无 admin 用户时，从环境变量 `ADMIN_EMAIL` / `ADMIN_PASSWORD`（≥16 位）播种管理员（沿用 portal 模式）。
- 密码登录端点 `/api/auth/password-login` 仅在「该用户无 OIDC identity」时开放，用于引导管理员登录后在设置里配置 OIDC；bcrypt 哈希存储。
- OIDC 配置完成后，管理员可在设置中关闭密码登录（默认建议关闭）。

### 会话与权限

- 会话：token 存 SQLite，7 天绝对 / 24 小时空闲过期，滑动续期空闲窗口。
- 平台角色：`admin` / `user`（users.role）；空间角色：`owner` / `member`（space_members.role），两者正交。
- 禁用用户：所有会话立即失效，gateway 与 API 中间件统一拦截。

## 5. 空间与实例编排

### 空间生命周期

- **创建个人空间**：首登自动，含共享卷 + 该用户私有卷。
- **创建团队空间**：任何用户可建，创建者为 owner；含共享卷。邀请 = owner 输入对方邮箱，直接添加为成员——**仅限已注册（至少登录过一次）的用户**；v1 不做对未注册用户的邮件邀请。
- **删除空间**：owner 或平台 admin。销毁空间内全部实例容器 → 私有卷 → 共享卷，顺序执行，失败重试并标记 `error`，禁止残留孤儿资源。
- 个人空间不可删除（随用户禁用而停用其实例）。

### 实例生命周期

```
stopped → starting → running → stopped
   ↑_________ error（崩溃/编排失败）_________↑
```

- **启动**：成员在空间页点「启动」→ orchestrator 检查配额（空间实例数、CPU、内存）→ 创建容器：固定 UID、只读根文件系统、内存/CPU 限额、挂载共享卷（`/workspace/shared`）+ 私有卷（home 与 dsh 状态目录）、发布到 `127.0.0.1:<分配端口>`、出口防火墙规则约束。
- **停止/休眠**：手动停止 + 空闲超时自动停止（默认 60 分钟无请求，阈值可配；gateway 记录 `last_active_at`）。
- **重建**：换镜像版本时，销毁容器保留卷，用新 digest 重建。
- **回收**：进程启动时 reconcile——对比 SQLite 与 `docker ps -a`，把崩溃容器标 `error`、清理状态不一致的记录。

### 共享卷权限

所有实例容器以同一 UID/GID（如 1000:1000）运行，共享卷挂载点归属该 GID 并置 setgid，保证 A 写的文件 B 可改。dsh 状态（凭证、会话历史、SQLite）全部在私有卷，杜绝单用户设计的 dsh 状态互相踩踏。

### 路径路由与 dsh 适配

- gateway 把 `/s/<space-slug>/<username>/<rest>` 原样反代到对应实例：实例带 `--base-path` 启动，
  客户端拿到的资源/API/WS URL 都含该前缀，剥前缀会让实例对每个请求 404。
- dsh Web UI 需支持 base path：在镜像构建管线中新增源码 patch，使 `dsh web` 接受 `--base-path` 参数并以其为根生成资源 URL（portal 镜像构建已有 patch 机制，新增一个 patch 文件即可）。
- 实例未运行时访问：gateway 返回友好等待页并触发冷启动（starting 状态轮询），超时 30 秒报错。

## 6. 管理后台

四个板块（均属 `/api/admin/*`，要求 `users.role=admin`，全部写审计日志）：

1. **用户管理**：列表/搜索、禁用/启用、提升/降级 admin、查看用户的空间与实例。
2. **空间与实例管理**：全平台空间列表（类型/成员数/实例数/用量）、进入空间详情、停止/删除实例、修改空间配额覆盖、删除空间。
3. **平台设置与镜像**：OIDC provider 配置（issuer/client_id/secret/scope）、密码登录开关、平台默认配额、空闲休眠阈值；dsh 镜像管理——触发重新构建（走 imagebuild 安全管线）、查看/切换当前 digest、按新镜像批量重建实例。
4. **用量监控与审计**：全局仪表盘（运行中容器数、CPU/内存/存储占用，来自 docker 实时数据）、按空间聚合；审计日志查询（按操作者/动作/时间过滤）。

## 7. 安全设计

- **镜像供应链**：完整移植 portal 的 build-image 流程——上游 dsh 固定批准 commit、工作区干净校验、patch 可应用校验、`.dockerignore` 白名单漂移检测、`git archive` 干净构建上下文、输出不可变 `sha256:` digest；实例只按 digest 启动，不用 tag。
- **容器隔离**：只读根 fs、no-new-privileges、固定非 root UID、内存/CPU/PID 限额、端口只绑 `127.0.0.1`。
- **出口防火墙**：移植 portal 的 nftables 租户出口规则，禁止实例容器访问 RFC1918/loopback/link-local；应用失败则平台拒绝启动（fail-closed，沿用 portal run-portal.sh 语义）。
- **Web 安全**：httpOnly+Secure+SameSite cookie；CORS 默认关闭（同源部署）；所有 API 输入校验（zod）；SQL 全参数化（better-sqlite3 prepared statements）；反代仅允许白名单头部透传。
- **凭证边界**：用户的 DeepSeek API key 只在实例私有卷内，portal 永不接触（沿用 portal 边界）。

## 8. 前端与 UI 设计语言

React 18 + Vite + TypeScript，样式参考 Vercel 设计语言（vercel.com/design.md 的克制、单色、编辑感风格）：

- **单色设计**：黑白灰为主，颜色仅表达状态/操作/数据含义，且状态必须配非颜色提示（图标/文字）。
- **排版**：Geist Sans（正文/标题/数字），Geist Mono（仅代码、路径、容器名、digest 等短标识符）；固定字级阶梯（display/title/heading/body/caption），句首大写标题；正文行宽 60–68 字符；数字比较用等宽数字。
- **布局**：12 列桌面 / 6 列平板 / 4 列移动共享网格；用留白、对齐、排版层级而非卡片堆边框；禁止装饰性渐变、辉光、玻璃拟态、假阴影、胶囊标签、卡中卡。
- **暗色/亮色**：双主题隐式支持（跟随系统），不放可见主题切换器。
- **数据呈现即证据**：实例/用量用全宽语义化表格，列头与单元格对齐一致、数值右对齐；仪表盘首屏直接呈现关键数值与结论，不做装饰性 hero。
- **动效**：默认静止，仅在表达状态变化（实例 starting→running）时使用。

页面结构：登录页 → 空间列表（个人 + 所属团队）→ 空间详情（成员、我的实例、共享文件入口）→ 实例视图（嵌入反代的 dsh UI）→ 管理后台四板块。

## 9. 错误处理

- **编排失败**（docker 超时、配额不足、端口耗尽）：API 返回结构化错误码 + 用户可读消息；实例落 `error` 状态并记录原因；幂等重试（同一 (space,user) 重复启动请求收敛到同一实例记录）。
- **冷启动超时**：gateway 等 30 秒未 ready → 504 + 可重试提示。
- **实例崩溃**：healthcheck 发现 → 标 `error`，下次访问触发重建（保留卷）。
- **OIDC 故障**：IdP 不可达时登录页明确报错；已登录会话不受影响直至过期。
- **SQLite**：WAL 模式；migration 启动时顺序执行，失败即中止启动。
- **防火墙应用失败**：平台拒绝启动（fail-closed）。

## 10. 测试策略

- **单元测试**（Vitest）：store 层（真 SQLite 内存库）、spaces/admin 业务规则、配额计算、路径解析与权限判定、OIDC token 校验逻辑。
- **集成测试**：编排层用 docker API mock（或测试环境真 Docker，CI 可选）覆盖实例生命周期与 reconcile；gateway 用内存 Fastify inject + 假上游覆盖反代、鉴权拦截、冷启动路径。
- **端到端冒烟**：docker-compose 起平台 + 一个假 dsh 镜像，跑通「OIDC 登录（mock IdP）→ 个人空间 → 启动实例 → 路径反代访问」主链路。
- **安全回归**：镜像构建管线的各校验（commit 漂移、patch 失败、白名单漂移）各有负例测试；防火墙 fail-closed 行为有测试。

## 11. 从 portal 移植的清单

| 模块 | 来源 | 改造 |
|---|---|---|
| 镜像安全构建管线 | `build-image.sh` + `image/` | 新增 `--base-path` patch；digest 入库管理 |
| 出口防火墙 | `firewall/` | 不变，fail-closed 接入启动流程 |
| 会话存储与过期语义 | `portal/src` | 表结构沿用，身份来源换 OIDC |
| 容器编排 | `portal/src/orchestrator.js` | 1:1 实例模型 → (空间×成员) 实例模型；加共享卷；podman CLI → dockerode |
| 管理员播种 | `ADMIN_EMAIL/ADMIN_PASSWORD` | 不变 |

## 12. 里程碑（建议顺序，细节归实施计划）

1. 骨架：Fastify + SQLite migration + React SPA 托管 + dockerode 连通
2. 认证：OIDC 流程 + 管理员引导 + 会话中间件
3. 空间与编排：个人空间、实例生命周期、路径反代、dsh base-path patch、镜像构建管线移植
4. 团队空间：成员管理、共享卷、配额
5. 管理后台四板块 + 审计
6. 加固：防火墙、安全回归、E2E 冒烟
