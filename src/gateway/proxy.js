import httpProxy from 'http-proxy'

// 浏览器→平台这一跳携带平台凭证与身份元数据；这些一律不进入平台→租户这一跳。
// 删除 Cookie 是有意的：dsh 不使用浏览器 cookie，而转发平台会话等于把
// bearer token 暴露给租户容器（portal 既有语义）。
export const STRIPPED_REQUEST_HEADERS = [
  'cookie', 'authorization', 'proxy-authorization', 'origin', 'x-csrf-token',
  'cf-access-jwt-assertion', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
  'x-forwarded-user', 'x-forwarded-email',
]

function hardenProxyRequest(proxyReq) {
  for (const name of STRIPPED_REQUEST_HEADERS) proxyReq.removeHeader(name)
}

function stripUpstreamCookies(headers) {
  if (!headers) return
  delete headers['set-cookie']
  delete headers['set-cookie2']
}

export function createGatewayProxy() {
  // changeOrigin：把 Host 改写为 127.0.0.1:<port>。dsh 的信任栅栏信任 loopback，
  // 而平台正是实例的已认证网关——以 loopback 呈现是正确且必需的。
  const proxy = httpProxy.createProxyServer({ xfwd: false, changeOrigin: true })

  proxy.on('proxyReq', hardenProxyRequest)
  proxy.on('proxyReqWs', (proxyReq) => {
    hardenProxyRequest(proxyReq)
    // http-proxy 在此监听器之后才会写出 101 或拒绝响应头；两条路径都要剥。
    proxyReq.once('upgrade', (proxyRes) => stripUpstreamCookies(proxyRes.headers))
    proxyReq.once('response', (proxyRes) => stripUpstreamCookies(proxyRes.headers))
  })
  proxy.on('proxyRes', (proxyRes) => stripUpstreamCookies(proxyRes.headers))

  proxy.on('error', (err, _req, res) => {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('upstream unavailable')
    } else if (res && typeof res.destroy === 'function' && !res.destroyed) {
      res.destroy()
    }
  })
  return proxy
}
