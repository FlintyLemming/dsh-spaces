import { z } from 'zod'
import { apiError } from '../server.js'
import { requireUser } from '../auth/middleware.js'
import { writeAudit } from '../store/audit.js'
import {
  getSpaceBySlug, getSpaceMember, listSpacesForUser, listSpaceMembers,
} from '../store/spaces.js'
import { getInstance, upsertInstance } from '../store/instances.js'
import { containerNameFor, startInstance, stopInstance, rebuildInstance }
  from '../orchestrator/index.js'
import teamRoutes from './team-routes.js'

const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) })

function publicInstance(inst) {
  if (!inst) return null
  const { id, status, error, image_digest, last_active_at, port } = inst
  return { id, status, error, imageDigest: image_digest, lastActiveAt: last_active_at, port }
}

/** 成员限定解析；非成员 404（不泄露空间存在性）。 */
function requireMembership(req) {
  const space = getSpaceBySlug(req.params.slug)
  if (!space) throw apiError(404, 'NOT_FOUND', '空间不存在')
  const member = getSpaceMember(space.id, req.user.id)
  if (!member) throw apiError(404, 'NOT_FOUND', '空间不存在')
  return { space, member }
}

export async function spacesRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.get('/', async (req) => {
    const spaces = listSpacesForUser(req.user.id).map((s) => ({
      id: s.id, slug: s.slug, name: s.name, kind: s.kind, memberRole: s.member_role,
      instanceStatus: getInstance(s.id, req.user.id)?.status ?? null,
    }))
    return { spaces }
  })

  app.get('/:slug', { schema: { params: slugParams } }, async (req) => {
    const { space, member } = requireMembership(req)
    return {
      space: {
        id: space.id, slug: space.slug, name: space.name, kind: space.kind,
        memberRole: member.role,
      },
      members: listSpaceMembers(space.id).map((m) => ({
        userId: m.user_id, email: m.email, handle: m.handle,
        displayName: m.display_name, role: m.role,
      })),
      instance: publicInstance(getInstance(space.id, req.user.id)),
    }
  })

  app.post('/:slug/instance/start', { schema: { params: slugParams } }, async (req) => {
    const { space } = requireMembership(req)
    const inst = upsertInstance({
      spaceId: space.id, userId: req.user.id,
      containerName: containerNameFor(space.slug, req.user.handle),
    })
    const result = await startInstance(inst.id)
    writeAudit({ actorId: req.user.id, action: 'instance.start',
      targetType: 'instance', targetId: String(inst.id) })
    return { instance: publicInstance(result) }
  })

  app.post('/:slug/instance/stop', { schema: { params: slugParams } }, async (req) => {
    const { space } = requireMembership(req)
    const inst = getInstance(space.id, req.user.id)
    if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
    const result = await stopInstance(inst.id)
    writeAudit({ actorId: req.user.id, action: 'instance.stop',
      targetType: 'instance', targetId: String(inst.id) })
    return { instance: publicInstance(result) }
  })

  app.get('/:slug/instance', { schema: { params: slugParams } }, async (req) => {
    const { space } = requireMembership(req)
    return { instance: publicInstance(getInstance(space.id, req.user.id)) }
  })

  app.post('/:slug/instance/rebuild', { schema: { params: slugParams } }, async (req) => {
    const { space } = requireMembership(req)
    const inst = getInstance(space.id, req.user.id)
    if (!inst) throw apiError(404, 'NOT_FOUND', '实例不存在')
    const result = await rebuildInstance(inst.id)
    writeAudit({ actorId: req.user.id, action: 'instance.rebuild',
      targetType: 'instance', targetId: String(inst.id) })
    return { instance: publicInstance(result) }
  })

  // 团队空间管理（计划 05）：同前缀挂载，无独立 prefix。
  await app.register(teamRoutes)
}
