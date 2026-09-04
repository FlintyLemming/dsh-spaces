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
