import { sessionForToken } from '../store/sessions.js'
import { SESSION_COOKIE } from '../auth/middleware.js'
import { touchInstanceActivity } from '../store/instances.js'
import { containerRunning, startInstance, rebuildInstance } from '../orchestrator/index.js'
import { parseGatewayPath, mayAccessInstance, resolveGatewayTarget, getSpaceMember } from './routing.js'
import { createGatewayProxy } from './proxy.js'
import { waitingPage, rebuildingPage } from './pages.js'
import { setupWebSocket, closeUserSockets } from './ws.js'

export { closeUserSockets }

const ACTIVITY_TOUCH_INTERVAL_MS = 60 * 1000

// 每个实例的启动/重建去重表：entry = { startedAt, done }
const ensureRunningPromises = new Map()
const ensureRebuildPromises = new Map()
const lastActivityTouch = new Map()

export function touchThrottled(instanceId, now = Date.now()) {
  const last = lastActivityTouch.get(instanceId) ?? 0
  if (now - last >= ACTIVITY_TOUCH_INTERVAL_MS) {
    lastActivityTouch.set(instanceId, now)
    touchInstanceActivity(instanceId)
  }
}

function ensureRunning(inst, log) {
  const existing = ensureRunningPromises.get(inst.container_name)
  if (existing) return existing
  const entry = { startedAt: Date.now(), done: null }
  ensureRunningPromises.set(inst.container_name, entry)
  entry.done = Promise.resolve()
    .then(() => startInstance(inst.id))
    .catch((err) => log.warn({ err }, 'gateway cold start failed'))
    .finally(() => { ensureRunningPromises.delete(inst.container_name) })
  return entry
}

function ensureRebuild(inst, log) {
  const existing = ensureRebuildPromises.get(inst.container_name)
  if (existing) return existing
  const entry = { startedAt: Date.now(), done: null }
  ensureRebuildPromises.set(inst.container_name, entry)
  entry.done = Promise.resolve()
    .then(() => rebuildInstance(inst.id))
    .catch((err) => log.warn({ err }, 'gateway rebuild failed'))
    .finally(() => { ensureRebuildPromises.delete(inst.container_name) })
  return entry
}

function wantsJson(req) {
  return String(req.headers.accept ?? '').includes('application/json')
}

function redirectToLogin(req, reply) {
  const returnTo = encodeURIComponent(req.raw.url)
  return reply.code(302).header('location', `/login?return_to=${returnTo}`).send()
}

/** 网关对会话自行解析（不经 req.user；见计划头 Architecture 的封装说明）。 */
function sessionUser(req) {
  return sessionForToken(req.cookies?.[SESSION_COOKIE])?.user ?? null
}

/**
 * /s/<slug>/<handle> 拦截钩子。直接调用（不要 app.register 封装），
 * 否则钩子对无路由匹配的 /s/ 请求不触发。
 */
export async function gatewayPlugin(app, { config, proxy = createGatewayProxy() }) {
  app.addHook('onRequest', async (req, reply) => {
    const parsed = parseGatewayPath(req.raw.url)
    if (!parsed) return

    const target = resolveGatewayTarget(parsed.slug, parsed.handle)
    if (!target) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '实例不存在' } })
    }
    const user = sessionUser(req)
    if (!user) return redirectToLogin(req, reply)

    const membership = getSpaceMember(target.space.id, user.id)
    if (!mayAccessInstance(user, target.instance, membership)) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '实例不存在' } })
    }
    if (parsed.bareRoot) {
      return reply.code(302).header('location', `/s/${parsed.slug}/${parsed.handle}/`).send()
    }

    const inst = target.instance
    const running = inst.status === 'running' && (await containerRunning(inst.container_name))
    if (!running) {
      if (inst.status === 'error') {
        ensureRebuild(inst, app.log)
        return reply.code(502).type('text/html; charset=utf-8').send(
          rebuildingPage({ containerName: inst.container_name }))
      }
      const entry = ensureRunning(inst, app.log)
      const waited = Date.now() - entry.startedAt
      if (waited >= config.coldStartTimeoutMs && wantsJson(req)) {
        return reply.code(504).send({
          error: { code: 'COLD_START_TIMEOUT', message: '实例启动超时，请重试' },
        })
      }
      return reply.code(503).type('text/html; charset=utf-8').send(
        waitingPage({ containerName: inst.container_name, timedOut: waited >= config.coldStartTimeoutMs }))
    }

    // await 之后重读：行被删、实例换血、会话吊销都必须重新判定（portal 模式）。
    const again = resolveGatewayTarget(parsed.slug, parsed.handle)
    const userAgain = sessionUser(req)
    const membershipAgain = again && userAgain ? getSpaceMember(again.space.id, userAgain.id) : null
    if (!again || again.instance.id !== inst.id || again.instance.status !== 'running'
        || !userAgain || !mayAccessInstance(userAgain, again.instance, membershipAgain)) {
      return reply.code(503).send({ error: { code: 'INSTANCE_UNAVAILABLE', message: '实例暂不可用' } })
    }

    touchThrottled(inst.id)
    req.raw.url = parsed.rest + parsed.query
    reply.hijack()
    proxy.web(req.raw, reply.raw, { target: `http://127.0.0.1:${again.instance.port}` })
  })

  setupWebSocket(app, { config, proxy })
}
