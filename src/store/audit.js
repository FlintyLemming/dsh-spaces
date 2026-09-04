import { getDb } from './db.js'

export function writeAudit({ actorId = null, action, targetType, targetId = null, detail = null }) {
  getDb().prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(actorId, action, targetType, targetId == null ? null : String(targetId),
    detail == null ? null : JSON.stringify(detail), Date.now())
}

export function listAudit({ actorId, action, since, until, limit = 100, offset = 0 } = {}) {
  const where = []
  const params = {}
  if (actorId !== undefined) { where.push('actor_id = @actorId'); params.actorId = actorId }
  if (action !== undefined) { where.push('action = @action'); params.action = action }
  if (since !== undefined) { where.push('created_at >= @since'); params.since = since }
  if (until !== undefined) { where.push('created_at <= @until'); params.until = until }
  const sql = `SELECT * FROM audit_log
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`
  return getDb().prepare(sql).all({ ...params, limit, offset })
}
