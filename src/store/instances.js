import { getDb } from './db.js'

export function upsertInstance({ spaceId, userId, containerName }) {
  getDb().prepare(
    `INSERT INTO instances (space_id, user_id, container_name, created_at)
     VALUES (?,?,?,?)
     ON CONFLICT(space_id, user_id) DO NOTHING`,
  ).run(spaceId, userId, containerName, Date.now())
  return getInstance(spaceId, userId)
}

export function getInstance(spaceId, userId) {
  return getDb().prepare('SELECT * FROM instances WHERE space_id = ? AND user_id = ?')
    .get(spaceId, userId) ?? null
}

export function getInstanceById(id) {
  return getDb().prepare('SELECT * FROM instances WHERE id = ?').get(id) ?? null
}

export function getInstanceByContainerName(name) {
  return getDb().prepare('SELECT * FROM instances WHERE container_name = ?').get(name) ?? null
}

export function listInstancesForSpace(spaceId) {
  return getDb().prepare('SELECT * FROM instances WHERE space_id = ? ORDER BY id').all(spaceId)
}

export function listAllInstances() {
  return getDb().prepare('SELECT * FROM instances ORDER BY id').all()
}

export function listRunningInstances() {
  return getDb().prepare("SELECT * FROM instances WHERE status = 'running' ORDER BY id").all()
}

const UPDATABLE = new Set(['port', 'status', 'error', 'image_digest', 'last_active_at'])
export function updateInstance(id, fields) {
  const keys = Object.keys(fields)
  for (const k of keys) {
    if (!UPDATABLE.has(k)) throw new Error(`instance field ${k} is not updatable`)
  }
  if (keys.length === 0) return
  const sets = keys.map((k) => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE instances SET ${sets} WHERE id = @id`).run({ id, ...fields })
}

export function touchInstanceActivity(id, now = Date.now()) {
  getDb().prepare('UPDATE instances SET last_active_at = ? WHERE id = ?').run(now, id)
}

export function deleteInstance(id) {
  getDb().prepare('DELETE FROM instances WHERE id = ?').run(id)
}

export function countInstancesInSpace(spaceId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM instances WHERE space_id = ?')
    .get(spaceId).n
}

export function countRunningInstancesInSpace(spaceId) {
  return getDb().prepare(
    "SELECT COUNT(*) AS n FROM instances WHERE space_id = ? AND status = 'running'",
  ).get(spaceId).n
}
