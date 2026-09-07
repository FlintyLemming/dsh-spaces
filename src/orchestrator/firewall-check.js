// 探针目标取云元数据端点：它是规则表里最不可少的一条，且公网不可路由——
// 正常网络环境下它必然不可达，可达只能说明 forward 链没拦住租户子网。
const PROBE_TARGET = '169.254.169.254'
// 固定 alpine:3（busybox wget -T 超时）。dsh 镜像里没有 wget，不能拿 image_digest 当探针。
const PROBE_IMAGE = 'alpine:3'

export async function verifyTenantFirewall(docker, config) {
  if (!config.firewallRequired) {
    console.warn('[firewall] FIREWALL_REQUIRED=false — 未验证租户出口防火墙；严禁用于生产')
    return false
  }
  let container
  try {
    container = await docker.createContainer({
      Image: PROBE_IMAGE,
      Cmd: ['wget', '-T', '3', '-q', '-O', '/dev/null', `http://${PROBE_TARGET}/`],
      HostConfig: { NetworkMode: config.instanceNetwork, AutoRemove: true },
    })
  } catch (err) {
    throw new Error(`firewall probe container could not be created (is ${PROBE_IMAGE} pulled?): ${err.message}`)
  }
  try {
    await container.start()
    const { StatusCode } = await container.wait()
    if (StatusCode === 0) {
      throw new Error(
        `tenant egress firewall is NOT applied: a probe from network "${config.instanceNetwork}" `
        + `reached ${PROBE_TARGET}. Run sudo firewall/apply.sh on the docker host (fail-closed, spec §9)`,
      )
    }
    return true
  } finally {
    // AutoRemove 生效时 remove 会 404，忽略。
    try { await container.remove({ force: true }) } catch { /* already gone */ }
  }
}
