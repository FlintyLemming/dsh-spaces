import net from 'node:net'
import http from 'node:http'
import { getConfig } from '../config.js'
import { getDb } from '../store/db.js'
import { getDocker, isMissingContainerError } from './docker.js'
import { apiError, ApiError } from '../server.js'
import { getSetting } from '../store/settings.js'
import { getSpaceById } from '../store/spaces.js'
import {
  getInstanceById, updateInstance, countRunningInstancesInSpace, countInstancesInSpace,
  listAllInstances, listRunningInstances,
} from '../store/instances.js'

// ---- 命名 ----
export function containerNameFor(spaceSlug, handle) {
  return `dsh-${spaceSlug}-${handle}`
}
export function sharedVolumeName(spaceSlug) {
  return `dshvol-${spaceSlug}-shared`
}
export function privateVolumeName(spaceSlug, handle) {
  return `dshvol-${spaceSlug}-${handle}`
}

// ---- 生命周期锁（portal withLifecycleLock 移植）----
const lifecycleLocks = new Map()
export function withLifecycleLock(name, operation) {
  const previous = lifecycleLocks.get(name) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  lifecycleLocks.set(name, current)
  return current.finally(() => {
    if (lifecycleLocks.get(name) === current) lifecycleLocks.delete(name)
  })
}

// ---- 卷 ----
export async function ensureVolume(name) {
  const docker = getDocker()
  try {
    await docker.getVolume(name).inspect()
    return
  } catch (err) {
    if (err?.statusCode !== 404) throw err
  }
  try {
    await docker.createVolume({ Name: name })
  } catch (err) {
    const text = String(err?.message ?? '')
    if (err?.statusCode !== 409 && !text.includes('already exists')) throw err
  }
}

export async function removeVolume(name) {
  try {
    await getDocker().getVolume(name).remove()
  } catch (err) {
    if (!isMissingContainerError(err) && err?.statusCode !== 404) throw err
  }
}

/** spec §5：共享卷归属统一 GID 并置 setgid，A 写的文件 B 可改。 */
export async function prepareSharedVolume(name) {
  const config = getConfig()
  const docker = getDocker()
  const container = await docker.createContainer({
    name: `dsh-volprep-${name}`,
    Image: 'alpine:3',
    User: '0:0',
    Cmd: ['sh', '-c', `chown :${config.instanceGid} /shared && chmod g+s /shared`],
    HostConfig: {
      Mounts: [{ Type: 'volume', Source: name, Target: '/shared' }],
      AutoRemove: true,
    },
  })
  await container.start()
  const { StatusCode } = await container.wait()
  if (StatusCode !== 0) throw new Error(`prepareSharedVolume(${name}) exited ${StatusCode}`)
}

// ---- 租户网络 ----
export async function ensureTenantNetwork() {
  const config = getConfig()
  const docker = getDocker()
  const found = await docker.listNetworks({ filters: { name: [config.instanceNetwork] } })
  if (found.length === 0) {
    await docker.createNetwork({ Name: config.instanceNetwork, Driver: 'bridge' })
  }
}

// ---- 端口分配（portal allocatePort 移植）----
export async function allocatePort() {
  const config = getConfig()
  const used = new Set(
    getDb().prepare('SELECT port FROM instances WHERE port IS NOT NULL').all()
      .map((r) => r.port),
  )
  for (let p = config.portRangeStart; p <= config.portRangeEnd; p++) {
    if (used.has(p)) continue
    if (await isPortFree(p)) return p
  }
  throw apiError(503, 'PORT_POOL_EXHAUSTED', '实例端口池已耗尽，请联系管理员')
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

// ---- 运行状态缓存（portal 模式：2s TTL + 生命周期操作失效）----
const runningCache = new Map()
const RUNNING_CACHE_TTL_MS = 2000

export function invalidateRunning(name) {
  runningCache.delete(name)
}

export async function containerRunning(name, { fresh = false } = {}) {
  const now = Date.now()
  const cached = runningCache.get(name)
  if (cached?.pending) return cached.pending
  if (!fresh && cached && cached.expiresAt > now) return cached.value
  const pending = getDocker().getContainer(name).inspect()
    .then((info) => info.State?.Running === true)
    .catch((err) => {
      if (isMissingContainerError(err)) return false
      throw err
    })
  const entry = { pending }
  runningCache.set(name, entry)
  try {
    const value = await pending
    if (runningCache.get(name) === entry) {
      runningCache.set(name, { value, expiresAt: Date.now() + RUNNING_CACHE_TTL_MS })
    }
    return value
  } catch (err) {
    if (runningCache.get(name) === entry) runningCache.delete(name)
    throw err
  }
}

// ---- 健康轮询（portal waitHealthy 移植）----
export function waitHealthy(port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/', timeout: 5000 },
        (res) => {
          res.resume()
          if (res.statusCode === 200) return resolve(true)
          schedule()
        },
      )
      req.on('error', schedule)
      req.on('timeout', () => { req.destroy(); schedule() })
      function schedule() {
        if (Date.now() >= deadline) return resolve(false)
        setTimeout(check, 2000)
      }
    }
    check()
  })
}

// ---- 容器创建（spec §7 容器隔离基线）----
export async function createInstanceContainer({ spaceSlug, handle, port, imageDigest }) {
  const config = getConfig()
  const name = containerNameFor(spaceSlug, handle)
  invalidateRunning(name)
  await getDocker().createContainer({
    name,
    Image: imageDigest,
    User: `${config.instanceUid}:${config.instanceGid}`,
    Env: [
      'DSH_HOME=/home/dsh/.dsh',
      `BASE_PATH=/s/${spaceSlug}/${handle}`,
    ],
    ExposedPorts: { '3000/tcp': {} },
    HostConfig: {
      PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
      Mounts: [
        { Type: 'volume', Source: sharedVolumeName(spaceSlug), Target: '/workspace/shared' },
        { Type: 'volume', Source: privateVolumeName(spaceSlug, handle), Target: '/home/dsh' },
      ],
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=64m' },
      Memory: config.instanceMemoryMb * 1024 * 1024,
      MemorySwap: config.instanceMemoryMb * 1024 * 1024, // 等值 = 禁 swap
      NanoCpus: Math.round(config.instanceCpus * 1e9),
      PidsLimit: config.instancePidsLimit,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: config.instanceNetwork,
      RestartPolicy: { Name: 'unless-stopped' },
    },
  })
  invalidateRunning(name)
}

export async function containerExists(name) {
  try {
    await getDocker().getContainer(name).inspect()
    return true
  } catch (err) {
    if (isMissingContainerError(err)) return false
    throw err
  }
}

export function startContainer(name) {
  return withLifecycleLock(name, async () => {
    invalidateRunning(name)
    await getDocker().getContainer(name).start()
    invalidateRunning(name)
  })
}

export function stopContainer(name) {
  return withLifecycleLock(name, async () => {
    invalidateRunning(name)
    await stopContainerInner(name)
    invalidateRunning(name)
  })
}

async function stopContainerInner(name) {
  try {
    await getDocker().getContainer(name).stop({ t: 15 })
  } catch (err) {
    // 已停止视为成功（304 not modified）
    if (err?.statusCode !== 304 && !isMissingContainerError(err)) throw err
  }
}

export function removeContainer(name) {
  return withLifecycleLock(name, async () => {
    await removeContainerInner(name)
    invalidateRunning(name)
  })
}

async function removeContainerInner(name) {
  try {
    await getDocker().getContainer(name).remove({ force: true })
  } catch (err) {
    if (!isMissingContainerError(err)) throw err
  }
}

/** 只删容器保留卷（重建/幂等再供给用）。 */
export const removeContainerKeepVolumes = removeContainer

// ---- 配额（spec §3：现算，不落统计表）----
export function effectiveQuota(space) {
  return {
    cpu: space.quota_cpu ?? Number(getSetting('default_quota_cpu', '4')),
    memMb: space.quota_mem_mb ?? Number(getSetting('default_quota_mem_mb', '8192')),
    instances: space.quota_instances ?? Number(getSetting('default_quota_instances', '8')),
  }
}

export function checkStartQuota(space) {
  const q = effectiveQuota(space)
  const running = countRunningInstancesInSpace(space.id)
  const { instanceCpus, instanceMemoryMb } = getConfig()
  if ((running + 1) * instanceCpus > q.cpu || (running + 1) * instanceMemoryMb > q.memMb) {
    throw apiError(409, 'QUOTA_EXCEEDED',
      `空间资源配额不足：运行中 ${running} 个实例，限额 ${q.cpu} 核 / ${q.memMb} MB`)
  }
}

export function checkInstanceCountQuota(space) {
  const q = effectiveQuota(space)
  if (countInstancesInSpace(space.id) >= q.instances) {
    throw apiError(409, 'QUOTA_EXCEEDED', `空间实例数已达上限 ${q.instances}`)
  }
}

// ---- 实例生命周期（portal provision 模式：锁内重读 + 故障落 error）----
export async function startInstance(instanceId) {
  const initial = getInstanceById(instanceId)
  if (!initial) throw apiError(404, 'NOT_FOUND', '实例不存在')
  const name = initial.container_name
  return withLifecycleLock(name, async () => {
    const inst = getInstanceById(instanceId)
    if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
    if (inst.status === 'running' && await containerRunning(name)) return inst

    const image = getSetting('image_digest')
    if (!image) throw apiError(503, 'IMAGE_NOT_CONFIGURED', '平台尚未配置 dsh 镜像，请联系管理员')
    const space = getSpaceById(inst.space_id)
    const config = getConfig()
    updateInstance(inst.id, { status: 'starting', error: null })
    try {
      checkStartQuota(space)
      const port = inst.port ?? await allocatePort()
      if (port !== inst.port) updateInstance(inst.id, { port })

      // 镜像 digest 变化或容器缺失 → 重建容器（保留卷）
      if (await containerExists(name)) {
        const info = await getDocker().getContainer(name).inspect()
        if (info.Image !== image && inst.image_digest && inst.image_digest !== image) {
          await removeContainerKeepVolumes(name)
        }
      }
      if (!(await containerExists(name))) {
        const spaceSlug = space.slug
        const handle = name.slice(`dsh-${spaceSlug}-`.length)
        await ensureVolume(sharedVolumeName(spaceSlug))
        await ensureVolume(privateVolumeName(spaceSlug, handle))
        await createInstanceContainer({ spaceSlug, handle, port, imageDigest: image })
      }
      if (!(await containerRunning(name, { fresh: true }))) {
        invalidateRunning(name)
        await getDocker().getContainer(name).start()
        invalidateRunning(name)
      }

      const healthy = await waitHealthy(port, config.instanceStartTimeoutMs)
      // 健康轮询期间行可能已被删除（空间删除级联）——复查墓碑
      const current = getInstanceById(instanceId)
      if (!current) {
        // 已持有该容器名的生命周期锁——用内部无锁版本，避免自我死锁
        await removeContainerInner(name)
        throw apiError(404, 'NOT_FOUND', '实例不存在')
      }
      if (healthy) {
        updateInstance(inst.id, {
          status: 'running', error: null, image_digest: image, last_active_at: Date.now(),
        })
      } else {
        await stopContainerInner(name)
        invalidateRunning(name)
        updateInstance(inst.id, { status: 'error', error: 'health check timed out' })
      }
      return getInstanceById(instanceId)
    } catch (err) {
      const current = getInstanceById(instanceId)
      if (current) {
        if (err instanceof ApiError) {
          // 业务错误（配额/端口）→ 回到 stopped，保留原因
          updateInstance(inst.id, { status: 'stopped', error: err.message })
        } else {
          updateInstance(inst.id, { status: 'error', error: String(err?.message ?? err) })
        }
      }
      throw err
    }
  })
}

export async function stopInstance(instanceId) {
  const inst = getInstanceById(instanceId)
  if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
  await stopContainer(inst.container_name)
  updateInstance(inst.id, { status: 'stopped', error: null })
  return getInstanceById(instanceId)
}

export async function rebuildInstance(instanceId) {
  const inst = getInstanceById(instanceId)
  if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
  await removeContainerKeepVolumes(inst.container_name)
  updateInstance(inst.id, { status: 'stopped', error: null })
  return startInstance(instanceId)
}

/** spec §5：启动时对比 SQLite 与 docker ps -a，纠正状态不一致。 */
export async function reconcile() {
  const containers = await getDocker().listContainers({ all: true })
  const byName = new Map()
  for (const c of containers) {
    const name = (c.Names?.[0] ?? '').replace(/^\//, '')
    if (name) byName.set(name, c)
  }
  for (const inst of listAllInstances()) {
    const c = byName.get(inst.container_name)
    if (!c) {
      if (inst.status === 'running' || inst.status === 'starting') {
        updateInstance(inst.id, { status: 'error', error: 'container disappeared' })
      }
    } else if (c.State === 'running' && inst.status === 'stopped') {
      updateInstance(inst.id, { status: 'running', error: null })
    }
  }
}

/** spec §5：空闲超时自动停止（阈值 settings.idle_stop_minutes，默认 60）。 */
export async function sweepIdleInstances(now = Date.now()) {
  const idleMin = Number(getSetting('idle_stop_minutes', '60'))
  const cutoff = now - idleMin * 60 * 1000
  for (const inst of listRunningInstances()) {
    const lastActive = inst.last_active_at ?? inst.created_at
    if (lastActive <= cutoff) {
      try {
        await stopInstance(inst.id)
      } catch (err) {
        console.error(`[orchestrator] idle stop failed for ${inst.container_name}:`, err?.message ?? err)
      }
    }
  }
}

export function startIdleSweep() {
  const timer = setInterval(() => {
    sweepIdleInstances().catch((err) =>
      console.error('[orchestrator] idle sweep failed:', err?.message ?? err))
  }, getConfig().idleSweepIntervalMs)
  timer.unref?.()
  return timer
}
