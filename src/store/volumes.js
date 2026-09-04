import { getDb } from './db.js'

export function createVolume({ spaceId, kind, userId = null, dockerName }) {
  return getDb().prepare(
    `INSERT INTO volumes (space_id, kind, user_id, docker_name) VALUES (?,?,?,?)`,
  ).run(spaceId, kind, userId, dockerName).lastInsertRowid
}

export function listVolumesForSpace(spaceId) {
  return getDb().prepare('SELECT * FROM volumes WHERE space_id = ? ORDER BY id').all(spaceId)
}

export function getVolumeByDockerName(dockerName) {
  return getDb().prepare('SELECT * FROM volumes WHERE docker_name = ?').get(dockerName) ?? null
}

export function deleteVolume(id) {
  getDb().prepare('DELETE FROM volumes WHERE id = ?').run(id)
}
