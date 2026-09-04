import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'

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

export async function buildServer({ config }) {
  const app = Fastify({
    logger: { level: config.environment === 'development' ? 'info' : 'warn' },
    trustProxy: true,
  })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.register(cookie)

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } })
    }
    if (err instanceof ZodError || err.statusCode === 400) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_FAILED', message: '请求参数不合法' },
      })
    }
    req.log.error(err)
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
    })
  })

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
    }
    // SPA 回退在 Task 5 接线；这里先 404。
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '页面不存在' } })
  })

  app.get('/api/health', async () => ({ status: 'ok' }))
  return app
}
