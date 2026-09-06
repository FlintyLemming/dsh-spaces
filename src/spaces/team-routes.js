import { z } from 'zod'
import { requireUser } from '../auth/middleware.js'
import { getSpaceBySlug } from '../store/spaces.js'
import { addMemberByEmail, createTeamSpace, removeMemberCascade } from './team.js'

const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) })

function publicSpace(space) {
  return { id: space.id, slug: space.slug, name: space.name, kind: space.kind }
}

/** 团队空间管理路由；与 spacesRoutes 同挂 /api/spaces 前缀。 */
export default async function teamRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/', {
    schema: { body: z.object({ name: z.string().min(1).max(64) }) },
  }, async (req, reply) => {
    const space = await createTeamSpace({ name: req.body.name, owner: req.user })
    return reply.code(201).send({ space: publicSpace(space) })
  })

  app.post('/:slug/members', {
    schema: {
      params: slugParams,
      body: z.object({ email: z.string().email() }),
    },
  }, async (req, reply) => {
    const space = getSpaceBySlug(req.params.slug)
    const member = await addMemberByEmail({ space, email: req.body.email, actor: req.user })
    return reply.code(201).send({ member })
  })

  app.delete('/:slug/members/:userId', {
    schema: {
      params: z.object({
        slug: z.string().regex(/^[a-z0-9-]+$/),
        userId: z.coerce.number().int().positive(),
      }),
    },
  }, async (req, reply) => {
    const space = getSpaceBySlug(req.params.slug)
    await removeMemberCascade({ space, targetUserId: req.params.userId, actor: req.user })
    return reply.code(204).send()
  })
}
