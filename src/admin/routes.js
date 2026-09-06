import { z } from 'zod'
import { apiError } from '../server.js'
import { requireAdmin } from '../auth/middleware.js'
import { getUserById, setUserStatus, updateUserRole } from '../store/users.js'
import { deleteAllSessionsForUser } from '../store/sessions.js'
import { listAllInstances, getInstance, deleteInstance } from '../store/instances.js'
import { getSpaceBySlug, updateSpaceQuotas } from '../store/spaces.js'
import { stopInstance, removeContainer } from '../orchestrator/index.js'
import { deleteSpaceCascade } from '../spaces/team.js'
import { closeUserSockets } from '../gateway/index.js'
import { writeAudit } from '../store/audit.js'
import { listUsersWithStats, listSpacesWithStats, getSpaceAdminDetail, countActiveAdmins }
  from './queries.js'

const idParams = z.object({ id: z.coerce.number().int().positive() })
const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) })
const instanceParams = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  userId: z.coerce.number().int().positive(),
})

function getTargetUser(req) {
  const user = getUserById(req.params.id)
  if (!user) throw apiError(404, 'USER_NOT_FOUND', '用户不存在')
  return user
}

function requireSpace(slug) {
  const space = getSpaceBySlug(slug)
  if (!space) throw apiError(404, 'SPACE_NOT_FOUND', '空间不存在')
  return space
}

function getInstanceInSpace(req) {
  const space = requireSpace(req.params.slug)
  const inst = getInstance(space.id, req.params.userId)
  if (!inst) throw apiError(404, 'INSTANCE_NOT_FOUND', '实例不存在')
  return inst
}

/** 管理后台路由；由 server.js 以 prefix '/api/admin' 注册，全部要求管理员。 */
export default async function adminRoutes(app) {
  app.addHook('preHandler', requireAdmin)

  app.get('/users', {
    schema: { querystring: z.object({ search: z.string().optional() }) },
  }, async (req) => ({ users: listUsersWithStats({ search: req.query.search ?? '' }) }))

  app.post('/users/:id/disable', { schema: { params: idParams } }, async (req) => {
    const target = getTargetUser(req)
    if (target.id === req.user.id) {
      throw apiError(400, 'CANNOT_MODIFY_SELF', '不能禁用当前登录的管理员账户')
    }
    setUserStatus(target.id, 'disabled')
    deleteAllSessionsForUser(target.id)
    closeUserSockets(target.id)
    // 逐个停止；单个实例失败不阻断禁用（账号已不可登录，残留由用量页暴露）。
    for (const inst of listAllInstances()) {
      if (inst.user_id !== target.id || inst.status !== 'running') continue
      await stopInstance(inst.id).catch((err) =>
        req.log.warn({ err }, `admin disable: stopping ${inst.container_name} failed`))
    }
    writeAudit({ actorId: req.user.id, action: 'admin.user_disable', targetType: 'user',
      targetId: target.id, detail: { email: target.email } })
    return { ok: true }
  })

  app.post('/users/:id/enable', { schema: { params: idParams } }, async (req) => {
    const target = getTargetUser(req)
    setUserStatus(target.id, 'active')
    writeAudit({ actorId: req.user.id, action: 'admin.user_enable', targetType: 'user',
      targetId: target.id, detail: { email: target.email } })
    return { ok: true }
  })

  app.post('/users/:id/role', {
    schema: { params: idParams, body: z.object({ role: z.enum(['admin', 'user']) }) },
  }, async (req) => {
    const target = getTargetUser(req)
    if (target.id === req.user.id) throw apiError(400, 'CANNOT_MODIFY_SELF', '不能修改自己的角色')
    if (target.role === 'admin' && req.body.role === 'user' && countActiveAdmins() <= 1) {
      throw apiError(400, 'LAST_ADMIN', '平台至少保留一名管理员')
    }
    updateUserRole(target.id, req.body.role)
    writeAudit({ actorId: req.user.id, action: 'admin.user_role', targetType: 'user',
      targetId: target.id, detail: { email: target.email, role: req.body.role } })
    return { ok: true }
  })

  app.get('/spaces', async () => ({ spaces: listSpacesWithStats() }))

  app.get('/spaces/:slug', { schema: { params: slugParams } }, async (req) => {
    const detail = getSpaceAdminDetail(req.params.slug)
    if (!detail) throw apiError(404, 'SPACE_NOT_FOUND', '空间不存在')
    return detail
  })

  // 三个字段各自可省略（保持原值）或显式传 null（回落平台默认配额）。
  app.put('/spaces/:slug/quota', {
    schema: {
      params: slugParams,
      body: z.object({
        quotaCpu: z.number().positive().nullable().optional(),
        quotaMemMb: z.number().int().positive().nullable().optional(),
        quotaInstances: z.number().int().positive().nullable().optional(),
      }),
    },
  }, async (req) => {
    const space = requireSpace(req.params.slug)
    const { quotaCpu, quotaMemMb, quotaInstances } = req.body
    const before = {
      quotaCpu: space.quota_cpu, quotaMemMb: space.quota_mem_mb,
      quotaInstances: space.quota_instances,
    }
    updateSpaceQuotas(space.id, {
      quotaCpu: quotaCpu === undefined ? space.quota_cpu : quotaCpu,
      quotaMemMb: quotaMemMb === undefined ? space.quota_mem_mb : quotaMemMb,
      quotaInstances: quotaInstances === undefined ? space.quota_instances : quotaInstances,
    })
    writeAudit({ actorId: req.user.id, action: 'admin.space_quota', targetType: 'space',
      targetId: space.id, detail: { slug: space.slug, before, after: req.body } })
    return { ok: true }
  })

  app.post('/spaces/:slug/instances/:userId/stop', {
    schema: { params: instanceParams },
  }, async (req) => {
    const inst = getInstanceInSpace(req)
    await stopInstance(inst.id)
    writeAudit({ actorId: req.user.id, action: 'instance.stop', targetType: 'instance',
      targetId: inst.id, detail: { container: inst.container_name, by: 'admin' } })
    return { ok: true }
  })

  // 删实例只销毁容器与实例行；卷保留（spec §5：数据删除需显式删空间/移成员）。
  app.delete('/spaces/:slug/instances/:userId', {
    schema: { params: instanceParams },
  }, async (req) => {
    const inst = getInstanceInSpace(req)
    await stopInstance(inst.id).catch((err) =>
      req.log.warn({ err }, `admin delete: stopping ${inst.container_name} failed`))
    await removeContainer(inst.container_name)
    deleteInstance(inst.id)
    writeAudit({ actorId: req.user.id, action: 'instance.stop', targetType: 'instance',
      targetId: inst.id, detail: { container: inst.container_name, by: 'admin', deleted: true } })
    return { ok: true }
  })

  // 级联删除由计划 05 的 deleteSpaceCascade 负责（含顺序、重试与失败标记）；
  // 它只接受团队空间，个人空间返回 PERSONAL_SPACE。
  app.delete('/spaces/:slug', { schema: { params: slugParams } }, async (req) => {
    const space = requireSpace(req.params.slug)
    await deleteSpaceCascade({ space, actor: req.user })
    return { ok: true }
  })
}
