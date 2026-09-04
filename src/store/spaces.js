import { getDb } from './db.js'

export function createSpace({ slug, name, kind, ownerId }) {
  return getDb().prepare(
    `INSERT INTO spaces (slug, name, kind, owner_id, created_at) VALUES (?,?,?,?,?)`,
  ).run(slug, name, kind, ownerId, Date.now()).lastInsertRowid
}

export function getSpaceById(id) {
  return getDb().prepare('SELECT * FROM spaces WHERE id = ?').get(id) ?? null
}

export function getSpaceBySlug(slug) {
  return getDb().prepare('SELECT * FROM spaces WHERE slug = ?').get(slug) ?? null
}

export function listSpacesForUser(userId) {
  return getDb().prepare(
    `SELECT s.*, m.role AS member_role FROM spaces s
     JOIN space_members m ON m.space_id = s.id
     WHERE m.user_id = ? ORDER BY s.id`,
  ).all(userId)
}

export function listAllSpaces() {
  return getDb().prepare('SELECT * FROM spaces ORDER BY id').all()
}

export function updateSpaceQuotas(id, { quotaCpu, quotaMemMb, quotaInstances }) {
  getDb().prepare(
    `UPDATE spaces SET quota_cpu = ?, quota_mem_mb = ?, quota_instances = ? WHERE id = ?`,
  ).run(quotaCpu, quotaMemMb, quotaInstances, id)
}

export function deleteSpace(id) {
  getDb().prepare('DELETE FROM spaces WHERE id = ?').run(id)
}

export function addSpaceMember({ spaceId, userId, role = 'member' }) {
  getDb().prepare(
    `INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?,?,?,?)`,
  ).run(spaceId, userId, role, Date.now())
}

export function getSpaceMember(spaceId, userId) {
  return getDb().prepare(
    'SELECT * FROM space_members WHERE space_id = ? AND user_id = ?',
  ).get(spaceId, userId) ?? null
}

export function listSpaceMembers(spaceId) {
  return getDb().prepare(
    `SELECT m.*, u.email, u.handle, u.display_name FROM space_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.space_id = ? ORDER BY m.created_at, m.user_id`,
  ).all(spaceId)
}

export function removeSpaceMember(spaceId, userId) {
  getDb().prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?')
    .run(spaceId, userId)
}

export function countSpaceMembers(spaceId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM space_members WHERE space_id = ?')
    .get(spaceId).n
}
