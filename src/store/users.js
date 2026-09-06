import { getDb } from './db.js'

export function createUser({ email, handle, displayName = '', role = 'user', passwordHash = null }) {
  return getDb().prepare(
    `INSERT INTO users (email, handle, display_name, role, password_hash, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(email, handle, displayName, role, passwordHash, Date.now()).lastInsertRowid
}

export function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null
}

export function getUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase()) ?? null
}

export function getUserByHandle(handle) {
  return getDb().prepare('SELECT * FROM users WHERE handle = ?').get(handle) ?? null
}

export function listUsers({ search } = {}) {
  const cols = 'id, email, handle, display_name, role, status, created_at'
  if (search) {
    return getDb().prepare(
      `SELECT ${cols} FROM users WHERE email LIKE ? OR handle LIKE ? OR display_name LIKE ?
       ORDER BY id`,
    ).all(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  return getDb().prepare(`SELECT ${cols} FROM users ORDER BY id`).all()
}

const UPDATABLE = new Set(['display_name', 'role', 'status'])
export function updateUser(id, fields) {
  const keys = Object.keys(fields)
  for (const k of keys) {
    if (!UPDATABLE.has(k)) throw new Error(`user field ${k} is not updatable`)
  }
  if (keys.length === 0) return
  const sets = keys.map((k) => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE users SET ${sets} WHERE id = @id`).run({ id, ...fields })
}

export function deriveUniqueHandle(seed) {
  const local = String(seed).split('@')[0].toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const base = local || 'user'
  let candidate = base
  for (let n = 2; getUserByHandle(candidate) !== null; n += 1) {
    candidate = `${base}-${n}`
  }
  return candidate
}

export function setUserStatus(id, status) {
  updateUser(id, { status })
}

export function updateUserRole(id, role) {
  updateUser(id, { role })
}
