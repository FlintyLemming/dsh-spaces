import { writeAudit } from '../store/audit.js'
import { requireUser, clearSession, publicUser } from './middleware.js'
import { passwordLoginRoutes } from './password-login.js'
import { oidcRoutes } from './oidc.js'

export async function authRoutes(app) {
  app.get('/me', { preHandler: requireUser }, async (req) => ({ user: publicUser(req.user) }))

  app.post('/logout', async (req, reply) => {
    if (req.user) {
      writeAudit({ actorId: req.user.id, action: 'user.logout', targetType: 'user', targetId: req.user.id })
    }
    clearSession(req, reply)
    return { ok: true }
  })

  await app.register(passwordLoginRoutes)
  await app.register(oidcRoutes)
}
