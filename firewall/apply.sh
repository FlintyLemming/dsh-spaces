#!/bin/bash
# Apply the dsh-spaces tenant egress firewall on the Docker HOST (idempotent).
# 在宿主机以 root/sudo 执行；平台首次启动（创建 dsh-tenants 网络）之后运行。
set -euo pipefail
cd "$(dirname "$0")"

NETWORK="${TENANT_NETWORK:-dsh-tenants}"
SUBNET="$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' "$NETWORK" 2>/dev/null || true)"
if [ -z "$SUBNET" ]; then
  echo "error: docker network '$NETWORK' not found;" >&2
  echo "  start the platform once (it creates the network), or: docker network create '$NETWORK'" >&2
  exit 1
fi

echo "firewall: tenant network '$NETWORK' subnet $SUBNET"

# 幂等：先删旧表再整体加载。
nft delete table inet dsh-tenant-egress 2>/dev/null || true
sed "s|@TENANT_SUBNET@|$SUBNET|g" tenant-egress.nft | nft -f -

echo 'firewall: applied:'
nft list table inet dsh-tenant-egress
