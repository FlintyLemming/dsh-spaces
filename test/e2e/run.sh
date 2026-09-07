#!/bin/bash
# test/e2e/run.sh — 构建并拉起 E2E 环境，灌入 OIDC 配置与假镜像 digest。
set -euo pipefail
cd "$(dirname "$0")"

docker build -q -t dsh-e2e-fake:latest ./fake-dsh >/dev/null
FAKE_DIGEST="$(docker image inspect dsh-e2e-fake:latest -f '{{.Id}}')"
echo "fake-dsh image: $FAKE_DIGEST"

docker compose up -d --build --wait

BASE=http://localhost:18080
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

# 平台监听就绪前 compose --wait 可能已返回（无 healthcheck），轮询一下。
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "$BASE/api/auth/me" && break
  curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" | grep -q '^[0-9]' && break
  sleep 1
done

curl -sf -c "$JAR" -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"e2e-admin-password-16+"}' \
  "$BASE/api/auth/password-login" >/dev/null
curl -sf -b "$JAR" -X PUT -H 'content-type: application/json' \
  -d '{"oidc_issuer":"http://localhost:19999","oidc_client_id":"dsh-spaces-e2e","oidc_client_secret":"e2e-secret","password_login_enabled":"true"}' \
  "$BASE/api/admin/settings" >/dev/null
curl -sf -b "$JAR" -X PUT -H 'content-type: application/json' \
  -d "{\"digest\":\"$FAKE_DIGEST\"}" "$BASE/api/admin/image/digest" >/dev/null

echo "e2e environment ready at $BASE"
