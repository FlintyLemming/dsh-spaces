import { randomBytes } from 'node:crypto'
import { apiError } from '../server.js'
import { getConfig } from '../config.js'
import { sessionForToken, insertSession, deleteSession } from '../store/sessions.js'

export const SESSION_COOKIE = 'dsh_session'

/** 解析会话 cookie 并填充 req.user（全局；强制由各路由 preHandler 决定）。
 *  注意：必须以根上下文 addHook 方式挂载（见下方 server.js 接线），
 *  不要用 app.register 包裹成插件——Fastify 封装上下文会让钩子对
 *  兄弟插件（spacesRoutes/adminRoutes 等）的路由不生效。 */
export async function resolveSession(req) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return
  const found = sessionForToken(token)
  if (found) req.user = found.user
}

export async function requireUser(req) {
  if (!req.user) throw apiError(401, 'UNAUTHENTICATED', '请先登录')
}

export async function requireAdmin(req) {
  if (!req.user) throw apiError(401, 'UNAUTHENTICATED', '请先登录')
  if (req.user.role !== 'admin') throw apiError(403, 'FORBIDDEN', '需要管理员权限')
}

export function issueSession(reply, userId) {
  const token = randomBytes(32).toString('hex')
  insertSession({ token, userId })
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: getConfig().cookieSecure,
    sameSite: 'lax',
    maxAge: Math.floor(getConfig().sessionAbsoluteTtlMs / 1000),
  })
  return token
}

export function clearSession(req, reply) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (token) deleteSession(token)
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    displayName: user.display_name,
    role: user.role,
  }
}
