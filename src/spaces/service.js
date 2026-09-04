import { getDb } from '../store/db.js'
import { getUserById } from '../store/users.js'
import {
  createSpace, getSpaceBySlug, addSpaceMember, listSpacesForUser,
} from '../store/spaces.js'
import { createVolume } from '../store/volumes.js'
import { writeAudit } from '../store/audit.js'
import { ensureVolume, prepareSharedVolume, sharedVolumeName, privateVolumeName }
  from '../orchestrator/index.js'

/**
 * spec §3：OIDC 首登后惰性创建个人空间（slug 从 handle 派生，冲突加后缀）
 * 及共享卷 + 该用户私有卷。幂等：已有个人空间直接返回。
 */
export async function provisionNewUser(userId) {
  const existing = listSpacesForUser(userId).find((s) => s.kind === 'personal')
  if (existing) return existing
  const user = getUserById(userId)
  let slug = `p-${user.handle}`
  for (let n = 2; getSpaceBySlug(slug) !== null; n += 1) slug = `p-${user.handle}-${n}`

  const spaceId = getDb().transaction(() => {
    const id = createSpace({ slug, name: `${user.display_name || user.handle} 的个人空间`, kind: 'personal', ownerId: userId })
    addSpaceMember({ spaceId: id, userId, role: 'owner' })
    createVolume({ spaceId: id, kind: 'shared', dockerName: sharedVolumeName(slug) })
    createVolume({ spaceId: id, kind: 'private', userId, dockerName: privateVolumeName(slug, user.handle) })
    return id
  })()

  // docker 侧资源在事务外创建；失败不吞——启动实例路径会再次 ensureVolume 自愈，
  // 这里失败仅影响 setgid 预置，留错日志即可。
  try {
    await ensureVolume(sharedVolumeName(slug))
    await ensureVolume(privateVolumeName(slug, user.handle))
    await prepareSharedVolume(sharedVolumeName(slug))
  } catch (err) {
    console.error(`[spaces] volume preparation for ${slug} failed:`, err?.message ?? err)
  }
  writeAudit({ actorId: userId, action: 'space.create', targetType: 'space',
    targetId: String(spaceId), detail: { kind: 'personal' } })
  return getSpaceBySlug(slug)
}
