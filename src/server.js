import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveSession } from './auth/middleware.js'
import { authRoutes } from './auth/routes.js'
import { spacesRoutes } from './spaces/routes.js'
import { gatewayPlugin } from './gateway/index.js'
import adminRoutes from './admin/routes.js'

export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export function apiError(statusCode, code, message) {
  return new ApiError(statusCode, code, message)
}

export async function buildServer({ config, gatewayProxy } = {}) {
  const app = Fastify({
    logger: { level: config.environment === 'development' ? 'info' : 'warn' },
    trustProxy: true,
  })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.register(cookie)

  // 无 body 的 POST/DELETE（启动实例、禁用用户、构建镜像…）客户端仍会带
  // content-type: application/json；Fastify 默认对空 body 报 400。把空 body
  // 当作「无 body」，畸形 JSON 仍然 400。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (body === '' || body === undefined || body === null) return done(null, undefined)
    try {
      done(null, JSON.parse(body))
    } catch (err) {
      err.statusCode = 400
      done(err)
    }
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } })
    }
    if (err instanceof ZodError || err.statusCode === 400) {
      // 非 zod 的 400（协议层错误，如空 JSON body）此前无声消失，只留下
      // 一句「请求参数不合法」——记一条日志，否则这类问题无从排查。
      if (!(err instanceof ZodError)) req.log.warn({ err }, 'request rejected with 400')
      return reply.code(400).send({
        error: { code: 'VALIDATION_FAILED', message: '请求参数不合法' },
      })
    }
    req.log.error(err)
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
    })
  })

  // 根上下文直接挂（不要 app.register 包裹，否则封装上下文会让钩子对兄弟插件路由失效）。
  // 必须在 setErrorHandler 之后注册：子上下文在注册时快照父级错误处理器。
  app.decorateRequest('user', null)
  app.addHook('onRequest', resolveSession)
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(spacesRoutes, { prefix: '/api/spaces' })
  await app.register(adminRoutes, { prefix: '/api/admin' })

  // 网关拦截钩子挂在根上下文：/s/ 请求大多无路由匹配，封装上下文的钩子不会触发。
  // 必须在静态托管之前接线，避免 SPA 回退先接管 /s/ 路径。
  await gatewayPlugin(app, { config, ...(gatewayProxy ? { proxy: gatewayProxy } : {}) })

  // dist 存在时托管 SPA，非 /api、非 /s 的 GET 路径回退到 index.html（客户端路由）。
  const indexPath = join(config.webDistDir, 'index.html')
  let indexHtml = null
  if (existsSync(indexPath)) {
    await app.register(fastifyStatic, { root: config.webDistDir })
    indexHtml = await readFile(indexPath, 'utf8')
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
    }
    if (indexHtml === null) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '页面不存在' } })
    }
    if (req.url.startsWith('/s/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '实例不存在' } })
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '页面不存在' } })
    }
    return reply.type('text/html').send(indexHtml)
  })

  app.get('/api/health', async () => ({ status: 'ok' }))
  return app
}
