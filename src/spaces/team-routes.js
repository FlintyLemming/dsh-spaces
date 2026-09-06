import { z } from 'zod'
import { requireUser } from '../auth/middleware.js'
import { createTeamSpace } from './team.js'

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
}
