# syntax=docker/dockerfile:1
# dsh-spaces 平台镜像。基础镜像按 digest 锁定。
# 查最新 digest: docker buildx imagetools inspect node:24-trixie-slim --format '{{.Manifest.Digest}}'
FROM node:24-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0 AS webbuild
WORKDIR /app
COPY src/web/package.json src/web/package-lock.json src/web/
RUN npm --prefix src/web ci
COPY src/web src/web
RUN npm --prefix src/web run build

FROM node:24-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY image ./image
COPY firewall ./firewall
COPY --from=webbuild /app/src/web/dist ./src/web/dist

ENV DATA_DIR=/data
EXPOSE 8080

# SECURITY: v1 有意以 root 运行。本容器挂载 /var/run/docker.sock，该 socket
# 本身即宿主机 root 等价物，容器内降权不带来额外隔离；真正的边界是
# 租户容器（固定非 root UID + 只读根 fs + no-new-privileges）与出口防火墙。
CMD ["node", "src/index.js"]
