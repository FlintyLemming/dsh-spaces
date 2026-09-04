import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { initDb } from '../src/store/db.js'

test('SPA fallback serves index.html for non-api paths', async () => {
  initDb(':memory:')
  const dist = mkdtempSync(join(tmpdir(), 'dsh-web-'))
  writeFileSync(join(dist, 'index.html'), '<html><body>spa</body></html>')
  const app = await buildServer({ config: loadConfig({ WEB_DIST_DIR: dist }) })
  const res = await app.inject({ method: 'GET', url: '/spaces/team-alpha' })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /text\/html/)
  assert.match(res.body, /spa/)
  const api = await app.inject({ method: 'GET', url: '/api/nope' })
  assert.equal(api.statusCode, 404)
  assert.equal(api.json().error.code, 'NOT_FOUND')
  await app.close()
})
