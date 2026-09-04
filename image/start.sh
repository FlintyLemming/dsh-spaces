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
