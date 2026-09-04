import net from 'node:net'
import http from 'node:http'
import { getConfig } from '../config.js'
import { getDb } from '../store/db.js'
import { getDocker, isMissingContainerError } from './docker.js'
import { apiError } from '../server.js'

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
    try {
      await getDocker().getContainer(name).stop({ t: 15 })
    } catch (err) {
      // 已停止视为成功（304 not modified）
      if (err?.statusCode !== 304 && !isMissingContainerError(err)) throw err
    }
    invalidateRunning(name)
  })
}

export function removeContainer(name) {
  return withLifecycleLock(name, async () => {
    try {
      await getDocker().getContainer(name).remove({ force: true })
    } catch (err) {
      if (!isMissingContainerError(err)) throw err
    }
    invalidateRunning(name)
  })
}

/** 只删容器保留卷（重建/幂等再供给用）。 */
export const removeContainerKeepVolumes = removeContainer
