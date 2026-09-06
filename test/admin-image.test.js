import { test, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdminApp, adminCookie } from './helpers.js'
import { setImageBuildRunner } from '../src/imagebuild/index.js'
import { getSetting } from '../src/store/settings.js'
import { getDb } from '../src/store/db.js'

const DIGEST = 'sha256:' + 'a'.repeat(64)

let app
beforeEach(async () => {
  app = await makeAdminApp({
    docker: {
      ping: async () => 'OK',
      getImage: (ref) => ({
        inspect: async () => {
          if (ref === DIGEST) return { Id: DIGEST }
          const err = new Error('no such image')
          err.statusCode = 404
          throw err
        },
      }),
    },
  })
  setImageBuildRunner(async () => ({ digest: DIGEST, log: 'built ok' }))
})
afterEach(() => { setImageBuildRunner(null) })

test('build stores result without switching digest, and audits', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/image/build', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().digest, DIGEST)
  assert.equal(getSetting('image_digest'), '') // 不自动切换
  const last = JSON.parse(getSetting('image_last_build'))
  assert.equal(last.digest, DIGEST)
  assert.equal(last.ok, true)
  assert.ok(getDb().prepare("SELECT * FROM audit_log WHERE action='admin.image_build'").get())
})

test('a failing build is recorded and reported as 500', async () => {
  setImageBuildRunner(async () => { throw new Error('docker build exploded') })
  const res = await app.inject({ method: 'POST', url: '/api/admin/image/build', headers: adminCookie })
  assert.equal(res.statusCode, 500)
  assert.equal(res.json().error.code, 'IMAGE_BUILD_FAILED')
  const last = JSON.parse(getSetting('image_last_build'))
  assert.equal(last.ok, false)
  assert.ok(last.log.includes('docker build exploded'))
})

test('concurrent build is rejected', async () => {
  let release
  let signalStarted
  const started = new Promise((r) => { signalStarted = r })
  setImageBuildRunner(() => new Promise((resolve) => {
    release = () => resolve({ digest: DIGEST, log: '' })
    signalStarted()
  }))
  const first = app.inject({ method: 'POST', url: '/api/admin/image/build', headers: adminCookie })
  await started // 第一个请求已持有构建锁，第二个必然撞上并发守卫
  const second = await app.inject({ method: 'POST', url: '/api/admin/image/build', headers: adminCookie })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'BUILD_IN_PROGRESS')
  release()
  assert.equal((await first).statusCode, 200)
})

test('GET image reports the current digest and last build', async () => {
  await app.inject({ method: 'POST', url: '/api/admin/image/build', headers: adminCookie })
  await app.inject({
    method: 'PUT', url: '/api/admin/image/digest', headers: adminCookie,
    payload: { digest: DIGEST },
  })
  const res = await app.inject({ method: 'GET', url: '/api/admin/image', headers: adminCookie })
  assert.equal(res.json().digest, DIGEST)
  assert.equal(res.json().lastBuild.ok, true)
})

test('digest switch validates format and existence', async () => {
  const bad = await app.inject({
    method: 'PUT', url: '/api/admin/image/digest', headers: adminCookie,
    payload: { digest: 'not-a-digest' },
  })
  assert.equal(bad.statusCode, 400)
  const missing = await app.inject({
    method: 'PUT', url: '/api/admin/image/digest', headers: adminCookie,
    payload: { digest: 'sha256:' + 'b'.repeat(64) },
  })
  assert.equal(missing.statusCode, 400)
  assert.equal(missing.json().error.code, 'IMAGE_NOT_FOUND')
  const ok = await app.inject({
    method: 'PUT', url: '/api/admin/image/digest', headers: adminCookie,
    payload: { digest: DIGEST },
  })
  assert.equal(ok.statusCode, 200)
  assert.equal(getSetting('image_digest'), DIGEST)
  assert.ok(getDb().prepare("SELECT * FROM audit_log WHERE action='admin.image_digest'").get())
})
