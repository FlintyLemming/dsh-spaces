import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function num(env, name, fallback) {
  const v = env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`)
  return n
}

function bool(env, name, fallback) {
  const v = env[name]
  if (v === undefined || v === '') return fallback
  if (v === 'true') return true
  if (v === 'false') return false
  throw new Error(`${name} must be true or false`)
}

export function loadConfig(env = process.env) {
  const environment = env.NODE_ENV ?? 'development'
  const platformOrigin = env.PLATFORM_ORIGIN ?? 'http://localhost:8080'
  let origin
  try {
    origin = new URL(platformOrigin).origin
  } catch {
    throw new Error('PLATFORM_ORIGIN must be an absolute http(s) origin')
  }
  if (environment === 'production' && !origin.startsWith('https:')) {
    throw new Error('PLATFORM_ORIGIN must use https in production')
  }
  return {
    environment,
    port: num(env, 'PORT', 8080),
    host: env.HOST ?? '127.0.0.1',
    platformOrigin: origin,
    dataDir: env.DATA_DIR ?? join(root, 'data'),
    // Secure cookie：生产强制；本地 http 开发关闭。
    cookieSecure: bool(env, 'COOKIE_SECURE', environment === 'production'),

    sessionAbsoluteTtlMs: num(env, 'SESSION_ABSOLUTE_TTL_MS', 7 * 24 * 60 * 60 * 1000),
    sessionIdleTtlMs: num(env, 'SESSION_IDLE_TTL_MS', 24 * 60 * 60 * 1000),

    adminEmail: env.ADMIN_EMAIL ?? '',
    adminPassword: env.ADMIN_PASSWORD ?? '',

    dockerSocketPath: env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
    portRangeStart: num(env, 'PORT_RANGE_START', 18000),
    portRangeEnd: num(env, 'PORT_RANGE_END', 18100),

    instanceCpus: num(env, 'INSTANCE_CPUS', 2),
    instanceMemoryMb: num(env, 'INSTANCE_MEMORY_MB', 2048),
    instancePidsLimit: num(env, 'INSTANCE_PIDS_LIMIT', 512),
    instanceUid: num(env, 'INSTANCE_UID', 1000),
    instanceGid: num(env, 'INSTANCE_GID', 1000),
    instanceNetwork: env.INSTANCE_NETWORK ?? 'dsh-tenants',
    instanceStartTimeoutMs: num(env, 'INSTANCE_START_TIMEOUT_MS', 180 * 1000),
    coldStartTimeoutMs: num(env, 'COLD_START_TIMEOUT_MS', 30 * 1000),
    idleSweepIntervalMs: num(env, 'IDLE_SWEEP_INTERVAL_MS', 60 * 1000),

    webDistDir: env.WEB_DIST_DIR ?? join(root, 'src/web/dist'),
  }
}

export function validateConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535')
  }
  if (config.sessionIdleTtlMs > config.sessionAbsoluteTtlMs) {
    throw new Error('SESSION_IDLE_TTL_MS cannot exceed SESSION_ABSOLUTE_TTL_MS')
  }
  if (config.portRangeEnd - config.portRangeStart < 1) {
    throw new Error('PORT_RANGE_END must be greater than PORT_RANGE_START')
  }
}
