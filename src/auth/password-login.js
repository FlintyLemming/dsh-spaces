import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { apiError } from '../server.js'
import { getUserByEmail } from '../store/users.js'
import { userHasIdentity } from '../store/identities.js'
import { getSetting } from '../store/settings.js'
import { writeAudit } from '../store/audit.js'
import { issueSession, publicUser } from './middleware.js'

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const failures = new Map() // email -> { count, windowStart }

export function resetPasswordRateLimits() {
  failures.clear()
}

function checkRateLimit(email, now = Date.now()) {
  const entry = failures.get(email)
  if (!entry) return
  if (now - entry.windowStart >= WINDOW_MS) {
    failures.delete(email)
    return
  }
  if (entry.count >= MAX_FAILURES) {
    throw apiError(429, 'RATE_LIMITED', '尝试过于频繁，请 15 分钟后再试')
  }
}

function recordFailure(email, now = Date.now()) {
  const entry = failures.get(email)
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    failures.set(email, { count: 1, windowStart: now })
  } else {
    entry.count += 1
  }
}

export async function passwordLoginRoutes(app) {
  app.post('/password-login', {
    schema: { body: z.object({ email: z.string().email(), password: z.string().min(1) }) },
  }, async (req, reply) => {
    const email = req.body.email.toLowerCase()
    if (getSetting('password_login_enabled', 'true') !== 'true') {
      throw apiError(403, 'PASSWORD_LOGIN_UNAVAILABLE', '密码登录已关闭，请使用 OIDC 登录')
    }
    checkRateLimit(email)
    const user = getUserByEmail(email)
    const allowed = user
      && user.status === 'active'
      && user.password_hash
      && !userHasIdentity(user.id)
    const ok = allowed && bcrypt.compareSync(req.body.password, user.password_hash)
    if (!ok) {
      recordFailure(email)
      throw apiError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误')
    }
    failures.delete(email)
    issueSession(reply, user.id)
    writeAudit({ actorId: user.id, action: 'user.login', targetType: 'user', targetId: user.id, detail: { method: 'password' } })
    return { user: publicUser(user) }
  })
}
