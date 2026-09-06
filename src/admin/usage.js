const STATS_BUDGET_MS = 5000
const BYTES_PER_MB = 1024 * 1024

/** docker stats 的 CPU 占用公式：容器增量 / 系统增量 × 核数。 */
export function computeCpuPercent(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
  const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
  if (sysDelta <= 0 || cpuDelta < 0) return 0
  const cores = stats.cpu_stats.online_cpus || 1
  return Math.round((cpuDelta / sysDelta) * cores * 1000) / 10
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('stats timeout')), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 从资源名解析所属空间。容器是 dsh-<slug>-<handle>，卷是 dshvol-<slug>-<handle|shared>；
 * slug 与 handle 都可含连字符，所以只能按已登记 slug 做最长前缀匹配。
 */
function slugOf(name, prefix, slugsLongestFirst) {
  if (!name.startsWith(prefix)) return null
  const rest = name.slice(prefix.length)
  return slugsLongestFirst.find((slug) => rest.startsWith(`${slug}-`)) ?? null
}

/** 未传已登记 slug 时的兜底：假定 handle 不含连字符，剥掉最后一段。 */
function guessSlugs(containerNames) {
  return [...new Set(containerNames.map(
    (n) => n.replace(/^dsh-/, '').split('-').slice(0, -1).join('-'),
  ))].filter(Boolean)
}

/**
 * 实时用量（spec §6：来自 dockerode，不落库）。单容器 stats 有 5 秒预算，
 * 超时或失败只跳过该容器，不拖垮整个接口。
 */
export async function collectUsage(docker, knownSlugs = []) {
  const [containers, df] = await Promise.all([
    docker.listContainers({ filters: { name: ['dsh-'] } }),
    docker.df(),
  ])
  const instances = containers
    .map((c) => ({ id: c.Id, name: (c.Names?.[0] ?? '').replace(/^\//, '') }))
    .filter((c) => c.name.startsWith('dsh-'))
  const slugs = [...(knownSlugs.length ? knownSlugs : guessSlugs(instances.map((c) => c.name)))]
    .sort((a, b) => b.length - a.length)

  const spaces = new Map()
  const spaceEntry = (slug) => {
    if (!spaces.has(slug)) spaces.set(slug, { slug, running: 0, memoryBytes: 0, volumeBytes: 0 })
    return spaces.get(slug)
  }

  let cpuPercent = 0
  let memoryBytes = 0
  await Promise.all(instances.map(async (c) => {
    const slug = slugOf(c.name, 'dsh-', slugs)
    if (slug) spaceEntry(slug).running += 1
    try {
      const stats = await withTimeout(docker.getContainer(c.id).stats({ stream: false }), STATS_BUDGET_MS)
      const mem = stats.memory_stats?.usage ?? 0
      cpuPercent += computeCpuPercent(stats)
      memoryBytes += mem
      if (slug) spaceEntry(slug).memoryBytes += mem
    } catch { /* 单容器失败跳过：用量是尽力而为的观测面 */ }
  }))

  const volumes = (df.Volumes ?? []).filter((v) => v.Name.startsWith('dshvol-'))
  for (const vol of volumes) {
    const slug = slugOf(vol.Name, 'dshvol-', slugs)
    if (!slug) continue
    spaceEntry(slug).volumeBytes += vol.UsageData?.Size ?? 0
  }

  return {
    running: instances.length,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryMb: Math.round(memoryBytes / BYTES_PER_MB),
    diskBytes: volumes.reduce((sum, v) => sum + (v.UsageData?.Size ?? 0), 0),
    spaces: [...spaces.values()]
      .map(({ slug, running, memoryBytes: mem, volumeBytes }) => ({
        slug, running, memoryMb: Math.round(mem / BYTES_PER_MB), volumeBytes,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  }
}
