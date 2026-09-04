import { getDb } from '../store/db.js'
import { createUser, getUserByEmail, deriveUniqueHandle } from '../store/users.js'
import { createIdentity, getIdentityByIssuerSubject } from '../store/identities.js'
import { writeAudit } from '../store/audit.js'

/**
 * spec §4 step 3：按 (issuer, subject) 查 identity → 命中即登录；
 * 未命中且 email 经 IdP 验证 → 绑定已有用户；
 * 否则创建新用户（调用方负责随后 provisionNewUser）。
 */
export function resolveOidcIdentity({ issuer, claims }) {
  const subject = String(claims.sub)
  return getDb().transaction(() => {
    const existing = getIdentityByIssuerSubject(issuer, subject)
    if (existing) return { userId: existing.user_id, created: false }

    const email = String(claims.email ?? '').toLowerCase()
    if (email && claims.email_verified === true) {
      const user = getUserByEmail(email)
      if (user) {
        createIdentity({ userId: user.id, issuer, subject })
        writeAudit({ actorId: user.id, action: 'identity.bind', targetType: 'user', targetId: user.id, detail: { issuer } })
        return { userId: user.id, created: false }
      }
    }

    // 无（可信）邮箱时用 synthetic 邮箱，保证 email 列非空且可区分来源。
    const effectiveEmail = (email && claims.email_verified === true)
      ? email
      : `${encodeURIComponent(subject)}@oidc.local`
    const userId = createUser({
      email: effectiveEmail,
      handle: deriveUniqueHandle(email || subject),
      displayName: String(claims.name ?? ''),
    })
    createIdentity({ userId, issuer, subject })
    writeAudit({ actorId: userId, action: 'user.create', targetType: 'user', targetId: userId, detail: { method: 'oidc', issuer } })
    return { userId, created: true }
  })()
}
