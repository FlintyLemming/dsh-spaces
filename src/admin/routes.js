import { z } from 'zod'
import { apiError } from '../server.js'
import { requireAdmin } from '../auth/middleware.js'
import { getUserById, setUserStatus, updateUserRole } from '../store/users.js'
import { deleteAllSessionsForUser } from '../store/sessions.js'
import { listAllInstances, getInstance, deleteInstance } from '../store/instances.js'
import { getSpaceBySlug, updateSpaceQuotas, listAllSpaces } from '../store/spaces.js'
import { stopInstance, removeContainer, rebuildInstance } from '../orchestrator/index.js'
import { getDocker } from '../orchestrator/docker.js'
import { runImageBuild } from '../imagebuild/index.js'
import { deleteSpaceCascade } from '../spaces/team.js'
import { closeUserSockets } from '../gateway/index.js'
import { writeAudit, listAudit } from '../store/audit.js'
import { getSetting, setSetting } from '../store/settings.js'
import { getConfig } from '../config.js'
import { listUsersWithStats, listSpacesWithStats, getSpaceAdminDetail, countActiveAdmins }
  from './queries.js'
import { collectUsage } from './usage.js'

// secret 不在此列：读接口只下发 oidc_client_secret_configured 布尔（spec §6）。
const SETTINGS_KEYS = [
  'oidc_issuer', 'oidc_client_id', 'oidc_scope', 'password_login_enabled',
  'default_quota_cpu', 'default_quota_mem_mb', 'default_quota_instances', 'idle_stop_minutes',
]

// issuer 生产强制 https；开发/E2E 允许 http —— mock IdP 没有 TLS。
// 用 refine 而非 startsWith，是为了在校验时（而非模块加载时）读当前环境。
const issuerSchema = z.union([
  z.literal(''),
  z.string().url().refine(
    (v) => v.startsWith('https://')
      || (getConfig().environment !== 'production' && v.startsWith('http://')),
    { message: 'oidc_issuer must use https' },
  ),
])

const DEFAULT_AUDIT_LIMIT = 100
const MAX_AUDIT_LIMIT = 500

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

  app.get('/settings', async () => {
    const settings = {}
    for (const key of SETTINGS_KEYS) settings[key] = getSetting(key)
    settings.oidc_client_secret_configured = getSetting('oidc_client_secret') !== ''
    return { settings }
  })

  // 部分更新：只写实际变化的键；oidc_client_secret 传空串表示保持不变。
  // 审计 detail 只记录键名，绝不记录值（spec §3：审计永不含 secret）。
  app.put('/settings', {
    schema: {
      body: z.object({
        oidc_issuer: issuerSchema.optional(),
        oidc_client_id: z.string().optional(),
        oidc_client_secret: z.string().optional(),
        oidc_scope: z.string().min(1).optional(),
        password_login_enabled: z.enum(['true', 'false']).optional(),
        default_quota_cpu: z.number().positive().optional(),
        default_quota_mem_mb: z.number().int().positive().optional(),
        default_quota_instances: z.number().int().positive().optional(),
        idle_stop_minutes: z.number().int().positive().optional(),
      }).strict(),
    },
  }, async (req) => {
    const changed = []
    for (const [key, value] of Object.entries(req.body)) {
      if (key === 'oidc_client_secret' && value === '') continue
      if (getSetting(key) === String(value)) continue
      setSetting(key, value)
      changed.push(key)
    }
    if (changed.length) {
      writeAudit({ actorId: req.user.id, action: 'admin.settings_update', targetType: 'settings',
        targetId: null, detail: { changed } })
    }
    return { ok: true, changed }
  })

  // 构建成功不自动切换 digest：切换是独立的、可审计的部署动作（spec §6）。
  app.post('/image/build', async (req, reply) => {
    let result
    try {
      result = await runImageBuild()
    } catch (err) {
      if (err.code === 'BUILD_IN_PROGRESS') {
        return reply.code(409).send({
          error: { code: 'BUILD_IN_PROGRESS', message: '已有构建在进行中' },
        })
      }
      const log = `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? err}`
      setSetting('image_last_build',
        JSON.stringify({ digest: null, at: Date.now(), ok: false, log: log.slice(-4096) }))
      writeAudit({ actorId: req.user.id, action: 'admin.image_build', targetType: 'image',
        targetId: null, detail: { ok: false } })
      throw apiError(500, 'IMAGE_BUILD_FAILED', '镜像构建失败，请查看构建日志')
    }
    setSetting('image_last_build',
      JSON.stringify({ digest: result.digest, at: Date.now(), ok: true, log: result.log }))
    writeAudit({ actorId: req.user.id, action: 'admin.image_build', targetType: 'image',
      targetId: result.digest, detail: { ok: true } })
    return { digest: result.digest }
  })

  app.get('/image', async () => {
    const lastBuild = getSetting('image_last_build')
    return { digest: getSetting('image_digest'), lastBuild: lastBuild ? JSON.parse(lastBuild) : null }
  })

  app.put('/image/digest', {
    schema: { body: z.object({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }) },
  }, async (req) => {
    try {
      await getDocker().getImage(req.body.digest).inspect()
    } catch {
      throw apiError(400, 'IMAGE_NOT_FOUND', '该 digest 的镜像在本地不存在，请先构建')
    }
    setSetting('image_digest', req.body.digest)
    writeAudit({ actorId: req.user.id, action: 'admin.image_digest', targetType: 'image',
      targetId: req.body.digest, detail: null })
    return { ok: true }
  })

  // 串行重建：避免宿主机被并发拉起的容器压垮（YAGNI 并发调度）。
  app.post('/image/rebuild-all', async (req) => {
    const results = []
    for (const inst of listAllInstances()) {
      try {
        await rebuildInstance(inst.id)
        results.push({ id: inst.id, container: inst.container_name, ok: true })
      } catch (err) {
        results.push({
          id: inst.id, container: inst.container_name, ok: false,
          error: String(err?.message ?? err),
        })
      }
    }
    const okCount = results.filter((r) => r.ok).length
    writeAudit({ actorId: req.user.id, action: 'admin.image_rebuild_all', targetType: 'image',
      targetId: getSetting('image_digest') || null, detail: { total: results.length, ok: okCount } })
    return { results, ok: okCount, total: results.length }
  })

  app.get('/usage', async () => collectUsage(getDocker(), listAllSpaces().map((s) => s.slug)))

  // limit 超过上限按上限截断（而非报错）：审计页的翻页控件不该因手改 URL 而失败。
  app.get('/audit', {
    schema: {
      querystring: z.object({
        actorId: z.coerce.number().int().optional(),
        action: z.string().optional(),
        since: z.coerce.number().int().optional(),
        until: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
    },
  }, async (req) => {
    const { limit, offset, ...filters } = req.query
    const entries = listAudit({
      ...filters,
      limit: Math.min(limit ?? DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT),
      offset: offset ?? 0,
    }).map((row) => ({
      ...row,
      actor_email: row.actor_id == null ? null : (getUserById(row.actor_id)?.email ?? null),
    }))
    return { entries }
  })
}
