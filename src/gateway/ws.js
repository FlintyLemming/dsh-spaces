import { sessionForToken } from '../store/sessions.js'
import { SESSION_COOKIE } from '../auth/middleware.js'
import { containerRunning, startInstance } from '../orchestrator/index.js'
import { touchInstanceActivity } from '../store/instances.js'
import { parseGatewayPath, mayAccessInstance, resolveGatewayTarget, getSpaceMember } from './routing.js'

const activeWebSockets = new Set() // { socket, userId, token, lastActivity }
const WS_TOUCH_INTERVAL_MS = 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

export function __socketsForTests() {
  return activeWebSockets
}

/** 从原始 Cookie 头解析会话 token（portal cookieToken 模式）。 */
function cookieToken(cookieHeader) {
  if (!cookieHeader) return null
  for (const part of String(cookieHeader).split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim()
      return /^[a-f0-9]{64}$/.test(value) ? value : null
    }
  }
  return null
}

function waitForStart(inst, timeoutMs) {
  // WS 升级没有页面可刷——短等冷启动，超时放弃（客户端会重连）。
  const deadline = Date.now() + timeoutMs
  return (async () => {
    try { await startInstance(inst.id) } catch { /* 状态由 DB 反映 */ }
    while (Date.now() < deadline) {
      if (await containerRunning(inst.container_name)) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  })()
}

export async function handleUpgrade(req, socket, head, { config, proxy, log }) {
  const parsed = parseGatewayPath(req.url ?? '')
  if (!parsed) return // 非网关路径：交给其他 upgrade 监听者

  const target = resolveGatewayTarget(parsed.slug, parsed.handle)
  if (!target) { socket.destroy(); return }

  const token = cookieToken(req.headers?.cookie)
  const user = sessionForToken(token)?.user ?? null
  const membership = user ? getSpaceMember(target.space.id, user.id) : null
  if (!user || !mayAccessInstance(user, target.instance, membership)) {
    socket.destroy()
    return
  }

  let running = target.instance.status === 'running'
    && (await containerRunning(target.instance.container_name))
  if (!running && target.instance.status !== 'error') {
    running = await waitForStart(target.instance, config.coldStartTimeoutMs)
  }
  if (!running) { socket.destroy(); return }

  // await 之后重读（portal 模式）：启动期间登出/禁用/删除不能逃逸吊销。
  const again = resolveGatewayTarget(parsed.slug, parsed.handle)
  const userAgain = sessionForToken(token)?.user ?? null
  const membershipAgain = again && userAgain ? getSpaceMember(again.space.id, userAgain.id) : null
  if (!again || again.instance.id !== target.instance.id || again.instance.status !== 'running'
      || !userAgain || !mayAccessInstance(userAgain, again.instance, membershipAgain)) {
    socket.destroy()
    return
  }

  touchInstanceActivity(again.instance.id)
  const tracked = { socket, userId: userAgain.id, token, lastActivity: Date.now() }
  activeWebSockets.add(tracked)
  const markActivity = () => {
    const now = Date.now()
    if (now - tracked.lastActivity >= WS_TOUCH_INTERVAL_MS) {
      tracked.lastActivity = now
      touchInstanceActivity(again.instance.id)
    }
  }
  const untrack = () => {
    activeWebSockets.delete(tracked)
    socket.off('data', markActivity)
  }
  socket.on('data', markActivity)
  socket.once('close', untrack)
  socket.once('error', untrack)

  // 与 HTTP 一致：实例只在 --base-path 前缀下接受升级握手，路径原样透传。
  proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${again.instance.port}` })
  log?.debug?.({ instance: again.instance.id }, 'gateway websocket forwarded')
}

export function sweepSocketsOnce() {
  for (const tracked of activeWebSockets) {
    if (!sessionForToken(tracked.token, { touch: false })) {
      if (!tracked.socket.destroyed) tracked.socket.destroy()
      activeWebSockets.delete(tracked)
    }
  }
}

export function closeUserSockets(userId) {
  for (const tracked of activeWebSockets) {
    if (tracked.userId === userId) {
      if (!tracked.socket.destroyed) tracked.socket.destroy()
      activeWebSockets.delete(tracked)
    }
  }
}

export function setupWebSocket(app, { config, proxy }) {
  // EventEmitter 不 await 异步监听器——把拒绝转成关 socket，
  // 不能让畸形输入或 docker 错误变成未处理拒绝杀掉进程（portal 模式）。
  app.server.on('upgrade', (req, socket, head) => {
    void handleUpgrade(req, socket, head, { config, proxy, log: app.log }).catch((err) => {
      app.log.error({ err }, 'gateway websocket upgrade failed')
      if (!socket.destroyed) socket.destroy()
    })
  })
  const sweep = setInterval(sweepSocketsOnce, SWEEP_INTERVAL_MS)
  sweep.unref?.()
}
