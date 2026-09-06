import { initDb, getDb } from '../src/store/db.js'
import { buildServer } from '../src/server.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { insertSession } from '../src/store/sessions.js'

export const ADMIN_TOKEN = 'a'.repeat(64)
export const USER_TOKEN = 'b'.repeat(64)

export const adminCookie = { cookie: `dsh_session=${ADMIN_TOKEN}` }
export const userCookie = { cookie: `dsh_session=${USER_TOKEN}` }

/** 最小 docker 桩：容器/卷操作全部成功，用量接口返回空集。 */
export function fakeDocker(overrides = {}) {
  return {
    ping: async () => 'OK',
    info: async () => ({ ContainersRunning: 0 }),
    df: async () => ({ Volumes: [] }),
    listContainers: async () => [],
    listNetworks: async () => [{ Name: 'dsh-tenants' }],
    getContainer: () => ({
      inspect: async () => ({ State: { Running: false } }),
      start: async () => {},
      stop: async () => {},
      remove: async () => {},
    }),
    getVolume: () => ({
      inspect: async () => ({}),
      remove: async () => {},
    }),
    ...overrides,
  }
}

/** admin=id 1、普通用户=id 2，两者各有一个有效会话（cookie 见上方导出）。 */
export async function makeAdminApp({ docker } = {}) {
  initDb(':memory:')
  const config = loadConfig({ NODE_ENV: 'development' })
  setActiveConfig(config)
  initDocker(docker ?? fakeDocker())
  const db = getDb()
  const now = Date.now()
  db.prepare("INSERT INTO users (id, email, handle, display_name, role, created_at) VALUES (1,'admin@x.com','admin','Admin','admin',?)").run(now)
  db.prepare("INSERT INTO users (id, email, handle, display_name, role, created_at) VALUES (2,'user@x.com','user','User','user',?)").run(now)
  insertSession({ token: ADMIN_TOKEN, userId: 1 })
  insertSession({ token: USER_TOKEN, userId: 2 })
  return buildServer({ config })
}
