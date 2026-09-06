import { getDb } from '../store/db.js'

/** 用户列表 + 聚合统计（spec §6：空间数与运行中实例数现算，不落统计表）。 */
export function listUsersWithStats({ search = '' } = {}) {
  return getDb().prepare(
    `SELECT u.id, u.email, u.handle, u.display_name, u.role, u.status, u.created_at,
       (SELECT COUNT(*) FROM space_members sm WHERE sm.user_id = u.id) AS space_count,
       (SELECT COUNT(*) FROM instances i WHERE i.user_id = u.id AND i.status = 'running')
         AS running_instances
     FROM users u
     WHERE (@search = '' OR u.email LIKE '%'||@search||'%'
            OR u.handle LIKE '%'||@search||'%' OR u.display_name LIKE '%'||@search||'%')
     ORDER BY u.id`,
  ).all({ search })
}

export function listSpacesWithStats() {
  return getDb().prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM space_members m WHERE m.space_id = s.id) AS member_count,
       (SELECT COUNT(*) FROM instances i WHERE i.space_id = s.id) AS instance_count,
       (SELECT COUNT(*) FROM instances i WHERE i.space_id = s.id AND i.status = 'running')
         AS running_count
     FROM spaces s ORDER BY s.id`,
  ).all()
}

export function getSpaceAdminDetail(slug) {
  const db = getDb()
  const space = db.prepare('SELECT * FROM spaces WHERE slug = ?').get(slug)
  if (!space) return null
  const members = db.prepare(
    `SELECT m.user_id, m.role, m.created_at, u.email, u.handle, u.display_name, u.status
     FROM space_members m JOIN users u ON u.id = m.user_id
     WHERE m.space_id = ? ORDER BY m.created_at, m.user_id`,
  ).all(space.id)
  const instances = db.prepare(
    `SELECT i.*, u.handle, u.email FROM instances i JOIN users u ON u.id = i.user_id
     WHERE i.space_id = ? ORDER BY i.id`,
  ).all(space.id)
  const volumes = db.prepare('SELECT * FROM volumes WHERE space_id = ? ORDER BY id').all(space.id)
  return { space, members, instances, volumes }
}

/** 降级/禁用管理员前的守卫：平台至少保留一名 active 管理员。 */
export function countActiveAdmins() {
  return getDb().prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'",
  ).get().n
}
