import { createHash } from 'node:crypto'
import { getDb } from './db.js'
import { getConfig } from '../config.js'

export function digestToken(token) {
  return createHash('sha256').update(String(token ?? '')).digest('hex')
}

export function insertSession({ token, userId, now = Date.now() }) {
  const { sessionAbsoluteTtlMs, sessionIdleTtlMs } = getConfig()
  getDb().prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, idle_expires_at)
     VALUES (?,?,?,?,?)`,
  ).run(digestToken(token), userId, now, now + sessionAbsoluteTtlMs, now + sessionIdleTtlMs)
}

export function deleteSession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(digestToken(token))
}

export function deleteAllSessionsForUser(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function purgeExpiredSessions(now = Date.now()) {
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ? OR idle_expires_at <= ?')
    .run(now, now)
}

const SELECT = `
  SELECT u.id, u.email, u.handle, u.display_name, u.role, u.status,
         s.user_id, s.expires_at, s.idle_expires_at
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?`

export function sessionForToken(token, { touch = true, now = Date.now() } = {}) {
  if (!/^[a-f0-9]{64}$/.test(String(token ?? ''))) return null
  const db = getDb()
  const tokenHash = digestToken(token)
  const row = db.prepare(SELECT).get(tokenHash)
  if (!row) return null
  if (row.expires_at <= now || row.idle_expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return null
  }
  if (row.status === 'disabled') {
    deleteAllSessionsForUser(row.user_id)
    return null
  }
  const idleExpiresAt = now + getConfig().sessionIdleTtlMs
  if (touch) {
    db.prepare('UPDATE sessions SET idle_expires_at = ? WHERE token_hash = ?')
      .run(idleExpiresAt, tokenHash)
  }
  return {
    user: {
      id: row.id, email: row.email, handle: row.handle,
      display_name: row.display_name, role: row.role, status: row.status,
    },
    session: { expiresAt: row.expires_at, idleExpiresAt: touch ? idleExpiresAt : row.idle_expires_at },
  }
}
