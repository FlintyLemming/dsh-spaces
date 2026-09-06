import { z } from 'zod'
import { apiError } from '../server.js'
import { requireAdmin } from '../auth/middleware.js'
import { getUserById, setUserStatus, updateUserRole } from '../store/users.js'
import { deleteAllSessionsForUser } from '../store/sessions.js'
import { listAllInstances } from '../store/instances.js'
import { stopInstance } from '../orchestrator/index.js'
import { closeUserSockets } from '../gateway/index.js'
import { writeAudit } from '../store/audit.js'
import { listUsersWithStats, countActiveAdmins } from './queries.js'

const idParams = z.object({ id: z.coerce.number().int().positive() })

function getTargetUser(req) {
  const user = getUserById(req.params.id)
  if (!user) throw apiError(404, 'USER_NOT_FOUND', '用户不存在')
  return user
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
}
