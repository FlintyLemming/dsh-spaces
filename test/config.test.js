import { test } from 'vitest'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config.js'

test('loadConfig applies defaults', () => {
  const config = loadConfig({})
  assert.equal(config.port, 8080)
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.dockerSocketPath, '/var/run/docker.sock')
  assert.equal(config.sessionAbsoluteTtlMs, 7 * 24 * 60 * 60 * 1000)
  assert.equal(config.sessionIdleTtlMs, 24 * 60 * 60 * 1000)
  assert.equal(config.instanceCpus, 2)
  assert.equal(config.instanceMemoryMb, 2048)
  assert.equal(config.instanceUid, 1001)
  assert.equal(config.instanceGid, 1001)
})

test('loadConfig rejects invalid PORT', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT must be/)
})

test('loadConfig requires https platform origin outside development', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', PLATFORM_ORIGIN: 'http://example.com' }),
    /PLATFORM_ORIGIN/,
  )
})

test('firewallRequired defaults: false in development, true in production', () => {
  assert.equal(loadConfig({ NODE_ENV: 'development' }).firewallRequired, false)
  assert.equal(loadConfig({ NODE_ENV: 'production', PLATFORM_ORIGIN: 'https://x.com' }).firewallRequired, true)
})

test('FIREWALL_REQUIRED explicit override wins', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production', PLATFORM_ORIGIN: 'https://x.com', FIREWALL_REQUIRED: 'false' }).firewallRequired, false)
  assert.equal(loadConfig({ FIREWALL_REQUIRED: 'true' }).firewallRequired, true)
  assert.throws(() => loadConfig({ FIREWALL_REQUIRED: 'yes' }), /FIREWALL_REQUIRED must be true or false/)
})
