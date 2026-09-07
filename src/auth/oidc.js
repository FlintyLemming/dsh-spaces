import * as oidc from 'openid-client'
import { apiError } from '../server.js'
import { getConfig } from '../config.js'
import { getSetting } from '../store/settings.js'
import { writeAudit } from '../store/audit.js'
import { getUserById } from '../store/users.js'
import { issueSession } from './middleware.js'
import { resolveOidcIdentity } from './identity.js'
import { provisionNewUser } from '../spaces/service.js'

export const OIDC_TXN_COOKIE = 'dsh_oidc_txn'
const TXN_MAX_AGE_S = 600

let cached = null // { key, configuration }

/** discovery 结果按 (issuer, clientId) 缓存；配置在管理后台改动后自动失效。 */
async function getOidcConfiguration() {
  const issuer = getSetting('oidc_issuer')
  const clientId = getSetting('oidc_client_id')
  if (!issuer || !clientId) {
    throw apiError(503, 'OIDC_NOT_CONFIGURED', '平台尚未配置 OIDC 登录')
  }
  const key = `${issuer}|${clientId}`
  if (cached?.key === key) return cached.configuration
  let configuration
  try {
    // openid-client 默认拒绝非 HTTPS issuer。开发/E2E 的 mock IdP 跑在 http 上，
    // 需显式放行；生产走不到这里——issuer 的 https 由 PUT /api/admin/settings 强制。
    const insecure = getConfig().environment !== 'production' && issuer.startsWith('http://')
    configuration = await oidc.discovery(
      new URL(issuer), clientId, getSetting('oidc_client_secret') || undefined,
      undefined,
      insecure ? { execute: [oidc.allowInsecureRequests] } : undefined,
    )
  } catch (err) {
    throw apiError(502, 'OIDC_UNAVAILABLE', `无法连接身份提供方：${err.message}`)
  }
  cached = { key, configuration }
  return configuration
}

function safeReturnTo(value) {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : '/'
}

export async function oidcRoutes(app) {
  app.get('/login', async (req, reply) => {
    const configuration = await getOidcConfiguration()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    const codeVerifier = oidc.randomPKCECodeVerifier()
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
    const txn = JSON.stringify({
      state, nonce, codeVerifier, returnTo: safeReturnTo(req.query.return_to),
    })
    reply.setCookie(OIDC_TXN_COOKIE, txn, {
      path: '/api/auth', httpOnly: true,
      secure: getConfig().cookieSecure, sameSite: 'lax', maxAge: TXN_MAX_AGE_S,
    })
    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: `${getConfig().platformOrigin}/api/auth/callback`,
      scope: getSetting('oidc_scope', 'openid profile email'),
      state, nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return reply.redirect(url.href)
  })

  app.get('/callback', async (req, reply) => {
    const raw = req.cookies?.[OIDC_TXN_COOKIE]
    reply.clearCookie(OIDC_TXN_COOKIE, { path: '/api/auth' })
    let txn
    try {
      txn = JSON.parse(raw ?? '')
    } catch {
      throw apiError(400, 'OIDC_CALLBACK_INVALID', '登录会话已过期，请重新登录')
    }
    const configuration = await getOidcConfiguration()
    let claims
    try {
      const tokens = await oidc.authorizationCodeGrant(
        configuration,
        new URL(req.url, getConfig().platformOrigin),
        {
          pkceCodeVerifier: txn.codeVerifier,
          expectedState: txn.state,
          expectedNonce: txn.nonce,
          idTokenExpected: true,
        },
      )
      claims = tokens.claims()
    } catch (err) {
      req.log.warn({ err }, 'oidc callback failed')
      throw apiError(400, 'OIDC_CALLBACK_INVALID', '登录校验失败，请重新登录')
    }
    if (!claims?.sub) {
      throw apiError(400, 'OIDC_CALLBACK_INVALID', '身份提供方返回缺少 subject')
    }
    const issuer = configuration.serverMetadata().issuer
    const { userId } = resolveOidcIdentity({ issuer, claims })
    const user = getUserById(userId)
    if (!user || user.status !== 'active') {
      throw apiError(403, 'FORBIDDEN', '账号已被禁用')
    }
    // 无条件调用：provisionNewUser 幂等，已有个人空间直接返回。只在「新建用户」
    // 时调会漏掉「按已验证邮箱绑定到已有用户」那一支（典型：引导管理员配好 OIDC
    // 后自己登录），那类用户将永远没有个人空间。放在状态校验之后，避免给已禁用
    // 账号建空间；必须 await，否则回调可能先于空间创建完成就跳转。
    await provisionNewUser(userId)
    issueSession(reply, userId)
    writeAudit({ actorId: userId, action: 'user.login', targetType: 'user', targetId: userId, detail: { method: 'oidc', issuer } })
    return reply.redirect(safeReturnTo(txn.returnTo))
  })
}
