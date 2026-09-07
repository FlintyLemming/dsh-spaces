// test/e2e/mock-idp/server.mjs — E2E 专用最小 OIDC IdP。非生产代码。
// key.pem/jwks.json 是提交进仓库的公开测试密钥，严禁用于真实部署。
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createPrivateKey, sign as cryptoSign } from 'node:crypto'

const ISSUER = process.env.ISSUER ?? 'http://localhost:19999'
const PLATFORM = process.env.PLATFORM_ORIGIN ?? 'http://localhost:18080'
const PORT = Number(process.env.PORT ?? 9999)
const CLIENT_ID = 'dsh-spaces-e2e'
const CODE = 'e2e-auth-code'
const privateKey = createPrivateKey(readFileSync(new URL('./key.pem', import.meta.url)))
const jwks = JSON.parse(readFileSync(new URL('./jwks.json', import.meta.url)))

let lastNonce = null // authorize 时记录，token 时放回 ID token

const b64url = (s) => Buffer.from(s).toString('base64url')
function idToken() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: jwks.keys[0].kid, typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: ISSUER, sub: 'e2e-sub-1', aud: CLIENT_ID,
    email: 'e2e@example.com', email_verified: true, name: 'E2E User',
    iat: now, exp: now + 600,
    ...(lastNonce ? { nonce: lastNonce } : {}),
  }))
  const sig = cryptoSign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
  return `${header}.${payload}.${sig}`
}

const server = createServer((req, res) => {
  const url = new URL(req.url, ISSUER)
  if (url.pathname === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    }))
    return
  }
  if (url.pathname === '/jwks') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(jwks))
    return
  }
  if (url.pathname === '/authorize') {
    // 免交互：直接按测试用户放行。校验 redirect_uri 同源，防夹具被误用成开放重定向器。
    const redirectUri = url.searchParams.get('redirect_uri') ?? ''
    if (!redirectUri.startsWith(`${PLATFORM}/`)) {
      res.writeHead(400).end('bad redirect_uri')
      return
    }
    lastNonce = url.searchParams.get('nonce')
    const target = new URL(redirectUri)
    target.searchParams.set('code', CODE)
    target.searchParams.set('state', url.searchParams.get('state') ?? '')
    res.writeHead(302, { location: target.toString() }).end()
    return
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const params = new URLSearchParams(body)
      if (params.get('code') !== CODE) {
        res.writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'invalid_grant' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        access_token: 'e2e-access-token', token_type: 'Bearer', expires_in: 600,
        id_token: idToken(),
      }))
    })
    return
  }
  res.writeHead(404).end('not found')
})
server.listen(PORT, '0.0.0.0', () => console.log(`mock-idp on ${PORT}, issuer ${ISSUER}`))
