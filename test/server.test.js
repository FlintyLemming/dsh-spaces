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
