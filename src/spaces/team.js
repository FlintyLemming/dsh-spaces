import { apiError } from '../server.js'
import { writeAudit } from '../store/audit.js'
import {
  createSpace, getSpaceBySlug, addSpaceMember, getSpaceMember, removeSpaceMember,
} from '../store/spaces.js'
import { createVolume, listVolumesForSpace, deleteVolume } from '../store/volumes.js'
import { getUserByEmail, getUserById } from '../store/users.js'
import { getInstance, deleteInstance } from '../store/instances.js'
import {
  ensureVolume, prepareSharedVolume, stopInstance, removeContainerKeepVolumes, removeVolume,
} from '../orchestrator/index.js'

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

/** 按邮箱添加成员（仅限已注册用户，spec §5）；同时建私有卷行并 provisioning。 */
export async function addMemberByEmail({ space, email, actor }) {
  assertTeamSpace(space)
  requireSpaceOwner(actor, space)
  const target = getUserByEmail(String(email).toLowerCase())
  if (!target) {
    throw apiError(404, 'USER_NOT_REGISTERED', '该用户尚未登录过平台，无法邀请')
  }
  if (getSpaceMember(space.id, target.id)) {
    throw apiError(409, 'ALREADY_MEMBER', '该用户已是空间成员')
  }
  addSpaceMember({ spaceId: space.id, userId: target.id, role: 'member' })
  const dockerName = `dshvol-${space.slug}-${target.handle}`
  createVolume({ spaceId: space.id, kind: 'private', userId: target.id, dockerName })
  await ensureVolume(dockerName)
  writeAudit({ actorId: actor.id, action: 'space.member_add', targetType: 'space',
    targetId: String(space.id), detail: { email: target.email } })
  return { userId: target.id, email: target.email, handle: target.handle,
    displayName: target.display_name, role: 'member' }
}

/** docker 步骤重试：最多 attempts 次，间隔 delayMs（测试可注入 0）。 */
export async function withRetry(fn, { attempts = 3, delayMs = 500 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }
  throw lastErr
}

/**
 * 移除成员并级联清理：停实例 → 删容器 → 删私有卷 → 删实例行 → 删卷行 → 删成员行。
 * 顺序固定，不可交换（spec §5：禁止残留孤儿资源）。
 */
export async function removeMemberCascade({ space, targetUserId, actor, retryDelayMs = 500 }) {
  assertTeamSpace(space)
  requireSpaceOwner(actor, space)
  const membership = getSpaceMember(space.id, targetUserId)
  if (!membership) throw apiError(404, 'MEMBER_NOT_FOUND', '该用户不是空间成员')
  if (membership.role === 'owner') {
    throw apiError(400, 'CANNOT_REMOVE_OWNER', '不能移除空间所有者')
  }
  const target = getUserById(targetUserId)
  const inst = getInstance(space.id, targetUserId)
  if (inst) {
    await withRetry(() => stopInstance(inst.id), { delayMs: retryDelayMs })
    await withRetry(() => removeContainerKeepVolumes(inst.container_name), { delayMs: retryDelayMs })
  }
  const vol = listVolumesForSpace(space.id)
    .find((v) => v.kind === 'private' && v.user_id === targetUserId)
  if (vol) await withRetry(() => removeVolume(vol.docker_name), { delayMs: retryDelayMs })
  if (inst) deleteInstance(inst.id)
  if (vol) deleteVolume(vol.id)
  removeSpaceMember(space.id, targetUserId)
  writeAudit({ actorId: actor.id, action: 'space.member_remove', targetType: 'space',
    targetId: String(space.id), detail: { email: target?.email } })
}
