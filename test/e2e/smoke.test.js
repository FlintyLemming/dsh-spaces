// test/e2e/smoke.test.js
// 主链路：OIDC 登录（mock IdP）→ 个人空间自动创建 → 启动实例 → 路径反代访问。
// 默认跳过；先跑 test/e2e/run.sh，再以 E2E=1 执行（npm run test:e2e）。
import { test } from 'vitest'
import assert from 'node:assert/strict'

const BASE = process.env.E2E_BASE ?? 'http://localhost:18080'

class Browser {
  cookies = new Map()
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  absorb(res) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(';')
      const eq = pair.indexOf('=')
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
  async fetch(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      redirect: 'manual',
      ...opts,
      headers: { cookie: this.cookieHeader(), ...(opts.headers ?? {}) },
    })
    this.absorb(res)
    return res
  }
}

test('oidc login → personal space → instance → proxied dsh ui', { timeout: 180_000 }, async (t) => {
  if (process.env.E2E !== '1') return t.skip('set E2E=1 and run test/e2e/run.sh first')

  const b = new Browser()
  // 1) OIDC 登录：平台生成 PKCE/state/nonce 并 302 到 mock IdP。
  const login = await b.fetch('/api/auth/login?return_to=/')
  assert.equal(login.status, 302)
  const authorizeUrl = login.headers.get('location')
  assert.ok(authorizeUrl.startsWith('http://localhost:19999/authorize'))

  // 2) authorize 发往 IdP 自己的 19999 端口（不走平台 BASE），它直接 302 回 callback。
  const idpRes = await fetch(authorizeUrl, { redirect: 'manual' })
  assert.equal(idpRes.status, 302)
  const callback = new URL(idpRes.headers.get('location'))
  const cb = await b.fetch(callback.pathname + callback.search)
  assert.equal(cb.status, 302)
  assert.ok(b.cookies.has('dsh_session'))

  // 3) 个人空间已惰性创建。
  const spaces = await (await b.fetch('/api/spaces')).json()
  assert.equal(spaces.spaces.length, 1)
  const space = spaces.spaces[0]
  assert.equal(space.kind, 'personal')
  const me = await (await b.fetch('/api/auth/me')).json()
  const handle = me.user.handle

  // 4) 启动实例并轮询到 running。
  const start = await b.fetch(`/api/spaces/${space.slug}/instance/start`, { method: 'POST' })
  assert.equal(start.status, 200)
  // 实例路由统一返回 { instance: ... } 信封。
  let inst
  for (let i = 0; i < 60; i += 1) {
    ;({ instance: inst } = await (await b.fetch(`/api/spaces/${space.slug}/instance`)).json())
    if (inst?.status === 'running') break
    if (inst?.status === 'error') assert.fail(`instance error: ${inst.error}`)
    await new Promise((r) => setTimeout(r, 2000))
  }
  assert.equal(inst.status, 'running')

  // 5) 路径反代：经 gateway 访问实例。
  const page = await b.fetch(`/s/${space.slug}/${handle}/`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /fake dsh/)

  // 6) 停止实例。
  const stop = await b.fetch(`/api/spaces/${space.slug}/instance/stop`, { method: 'POST' })
  assert.equal(stop.status, 200)
})
