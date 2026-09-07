import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { initDb } from '../src/store/db.js'

async function makeApp() {
  initDb(':memory:')
  return buildServer({ config: loadConfig({ NODE_ENV: 'development' }) })
}

test('GET /api/health returns ok', async () => {
  const app = await makeApp()
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { status: 'ok' })
  await app.close()
})

test('unknown /api route returns structured 404', async () => {
  const app = await makeApp()
  const res = await app.inject({ method: 'GET', url: '/api/nope' })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'NOT_FOUND')
  await app.close()
})

test('zod validation failure returns 400 with structured error', async () => {
  const app = await makeApp()
  const { z } = await import('zod')
  app.post('/api/_test', { schema: { body: z.object({ name: z.string() }) } },
    async (req) => ({ ok: true, name: req.body.name }))
  const res = await app.inject({
    method: 'POST', url: '/api/_test',
    payload: { name: 42 }, headers: { 'content-type': 'application/json' },
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, 'VALIDATION_FAILED')
  await app.close()
})

// 回归：SPA 的 apiFetch 对每个请求都带 content-type: application/json，
// 无 body 的 POST（启动/停止实例、禁用用户、构建镜像…）因此会带着空 body 到达。
// Fastify 默认对此报 FST_ERR_CTP_EMPTY_JSON_BODY(400)，曾被错误处理器伪装成
// 「请求参数不合法」，导致整类操作在 UI 上失败。空 body 必须当作无 body 处理。
test('bodyless POST with a json content-type is accepted', async () => {
  const app = await makeApp()
  app.post('/api/echo-body', async (req) => ({ body: req.body ?? null }))
  await app.ready()
  const res = await app.inject({
    method: 'POST',
    url: '/api/echo-body',
    headers: { 'content-type': 'application/json' },
    payload: '',
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { body: null })
  await app.close()
})

test('malformed json body still returns a 400', async () => {
  const app = await makeApp()
  app.post('/api/echo-body2', async (req) => ({ body: req.body ?? null }))
  await app.ready()
  const res = await app.inject({
    method: 'POST',
    url: '/api/echo-body2',
    headers: { 'content-type': 'application/json' },
    payload: '{not json',
  })
  assert.equal(res.statusCode, 400)
  await app.close()
})
