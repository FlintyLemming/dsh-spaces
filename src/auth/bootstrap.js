import bcrypt from 'bcryptjs'
import { getDb } from '../store/db.js'
import { createUser, deriveUniqueHandle } from '../store/users.js'
import { writeAudit } from '../store/audit.js'

/**
 * 平台首次启动且无 admin 时，从 ADMIN_EMAIL / ADMIN_PASSWORD 播种管理员
 * （spec §4「管理员引导密码」，沿用 portal 模式：无 admin 且 env 不全即中止启动）。
 */
export function ensureAdmin(config) {
  const existing = getDb().prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()
  if (existing) return false
  const password = String(config.adminPassword ?? '')
  if (!config.adminEmail || password.length < 16) {
    throw new Error('no admin exists: set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 16 characters')
  }
  const email = config.adminEmail.toLowerCase()
  const userId = createUser({
    email,
    handle: deriveUniqueHandle(email),
    displayName: 'Administrator',
    role: 'admin',
    passwordHash: bcrypt.hashSync(password, 10),
  })
  writeAudit({ actorId: userId, action: 'user.create', targetType: 'user', targetId: userId, detail: { method: 'bootstrap' } })
  console.log(`[dsh-spaces] seeded admin "${email}"`)
  return true
}
