# E2E 夹具

`mock-idp/key.pem` 与 `mock-idp/jwks.json` 是**提交进仓库的 E2E 专用测试密钥**，
公开可见，**严禁用于任何真实部署**。它们只服务于 `mock-idp/server.mjs` 这个
最小 OIDC IdP 夹具。

`fake-dsh/` 是最小实例镜像（任意路径返回 200），用来验证网关反代链路，
不含 dsh 本体。

跑法：`npm run test:e2e`（需要本机 Docker）。收尾：`cd test/e2e && docker compose down -v`。
