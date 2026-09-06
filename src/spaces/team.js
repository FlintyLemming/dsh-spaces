import { apiError } from '../server.js'
import { writeAudit } from '../store/audit.js'
import {
  createSpace, getSpaceBySlug, addSpaceMember, getSpaceMember,
} from '../store/spaces.js'
import { createVolume } from '../store/volumes.js'
import { ensureVolume, prepareSharedVolume } from '../orchestrator/index.js'

/** 团队空间 slug：小写 ascii + 连字符；全部剥离后兜底 'team'。 */
export function deriveTeamSlug(name) {
  const slug = String(name ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'team'
}

/** 空间必须存在且为团队空间；个人空间不接受任何成员/删除操作（spec §5）。 */
export function assertTeamSpace(space) {
  if (!space) throw apiError(404, 'SPACE_NOT_FOUND', '空间不存在')
  if (space.kind !== 'team') throw apiError(400, 'PERSONAL_SPACE', '个人空间不支持该操作')
}

export function requireSpaceOwner(user, space) {
  const member = getSpaceMember(space.id, user.id)
  if (!member || member.role !== 'owner') {
    throw apiError(403, 'FORBIDDEN', '仅空间所有者可执行该操作')
  }
  return member
}

const MAX_SLUG_ATTEMPTS = 20

/**
 * 创建团队空间：spaces + owner 成员行 + 共享卷行 + 创建者私有卷行，
 * 随后 provisioning docker 卷（共享卷置 setgid，见计划 03）。
 */
export async function createTeamSpace({ name, owner }) {
  const base = deriveTeamSlug(name)
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`
    if (getSpaceBySlug(slug)) continue
    try {
      createSpace({ slug, name: String(name).slice(0, 64), kind: 'team', ownerId: owner.id })
    } catch (err) {
      if (String(err?.message).includes('UNIQUE')) continue // 并发创建撞 slug
      throw err
    }
    const space = getSpaceBySlug(slug)
    addSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' })
    const sharedName = `dshvol-${slug}-shared`
    const privateName = `dshvol-${slug}-${owner.handle}`
    createVolume({ spaceId: space.id, kind: 'shared', userId: null, dockerName: sharedName })
    createVolume({ spaceId: space.id, kind: 'private', userId: owner.id, dockerName: privateName })
    await ensureVolume(sharedName)
    await prepareSharedVolume(sharedName)
    await ensureVolume(privateName)
    writeAudit({ actorId: owner.id, action: 'space.create', targetType: 'space',
      targetId: String(space.id), detail: { kind: 'team', slug } })
    return space
  }
  throw apiError(409, 'SLUG_EXHAUSTED', '空间名称冲突过多，请换一个名称')
}
