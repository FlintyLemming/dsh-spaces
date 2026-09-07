# dsh-spaces

基于空间的 dsh 开发环境云平台：多用户、多空间，按需启动 Docker 实例并通过网关反代访问。设计文档见 `docs/superpowers/specs/2026-09-04-dsh-spaces-design.md`。

## Prerequisites

- Node.js >= 24
- Docker（本机 `/var/run/docker.sock` 可达）

## 安装

```bash
npm install
npm --prefix src/web install
cp .env.example .env   # 按需修改
```

环境变量说明见 `.env.example`（端口、数据目录、Docker socket、管理员引导账号等）。

## 开发

```bash
npm run dev                    # 后端，--watch 热重启，监听 127.0.0.1:8080
npm --prefix src/web run dev   # 前端 Vite HMR，5173 端口，/api 与 /s 代理到 8080
```

## 测试

```bash
npm test          # Vitest 全量服务端测试（store 层使用 :memory: SQLite）
```

## 构建

```bash
npm run build:web     # 前端产物到 src/web/dist/，由 Fastify 静态托管
```

生产模式直接 `npm start`，非 `/api`、非 `/s` 路径回退到 SPA 的 `index.html`。

## 目录结构

```
src/
├── gateway/      # 反代热路径：/s/<space-slug>/<username>/... → 实例容器
│                 #   会话校验、成员资格校验、路径前缀剥离、WebSocket 升级转发
├── auth/         # OIDC authorization code + PKCE 流程、会话（cookie + SQLite
│                 #   token，7 天绝对 / 24 小时空闲）、管理员引导密码登录
├── spaces/       # 空间/成员/实例的 REST API 与业务规则
├── orchestrator/ # Docker 编排（dockerode）：实例与卷的创建/启停/销毁、
│                 #   资源限额、崩溃状态回收
├── admin/        # 管理 API：用户、空间、配额、镜像、用量、审计
├── imagebuild/   # dsh 镜像构建管线（固定 commit、干净上下文、digest 锁定）
├── store/        # better-sqlite3 数据访问层 + migration
└── web/          # React + Vite SPA，构建产物由 Fastify 托管
```

## 实施计划

`docs/superpowers/plans/` 下的 7 个计划按序执行：01 骨架 → 02 认证 → 03 空间与编排 → 04 网关反代 → 05 团队空间 → 06 管理后台 → 07 加固与 E2E。当前已完成 01。

## 部署（单机 Docker）

前置：Docker ≥ 24、nftables、Node 24（仅构建镜像时需要）。

1. 克隆上游 dsh 并 checkout 批准 commit（见 `scripts/build-image.sh` 顶部），构建实例镜像：
   `npm run build:image`（输出 `sha256:` digest）。
2. `cp .env.example .env` 并填写 `PLATFORM_ORIGIN`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`（≥16 位）。
3. `docker pull alpine:3`（防火墙探针镜像）。
4. `docker compose up -d`（首次启动创建 `dsh-tenants` 网络；此时启动校验会失败属预期）。
5. `sudo firewall/apply.sh`（应用租户出口防火墙）。
6. `docker compose restart platform`（fail-closed 校验通过，平台就绪）。
7. 浏览器打开平台，管理员密码登录 → 设置里配置 OIDC → 填实例镜像 digest → 建议关闭密码登录。

安全边界说明：平台容器挂载 /var/run/docker.sock（宿主 root 等价），v1 以 root 运行；
租户实例固定非 root UID、只读根 fs、no-new-privileges、限额、出口防火墙隔离。

### 两个 .dockerignore

- `image/.dockerignore` —— dsh **实例镜像**管线的 deny-by-default 白名单，
  由 `scripts/build-image.sh` 逐行校验（漂移即构建失败），并拷进 `git archive`
  生成的独立构建上下文。
- `.dockerignore`（仓库根）—— **平台镜像** `Dockerfile` 的构建上下文排除表。

两者职责不同，不要合并。

### 端到端冒烟

`npm run test:e2e` 拉起 mock OIDC IdP + 假 dsh 镜像 + 真实平台容器，跑通
「OIDC 登录 → 个人空间 → 启动实例 → 路径反代」。需要本机 Docker；
默认 `npm test` 不依赖 Docker 守护进程。收尾：
`docker compose -f test/e2e/docker-compose.yml down -v`。
