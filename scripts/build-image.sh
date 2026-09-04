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
