import { test } from 'vitest'
import assert from 'node:assert/strict'
import { verifyTenantFirewall } from '../src/orchestrator/firewall-check.js'

function fakeDocker({ probeExitCode, createThrows = null }) {
  const calls = []
  const container = {
    start: async () => { calls.push('start') },
    wait: async () => ({ StatusCode: probeExitCode }),
    remove: async () => { calls.push('remove') },
  }
  return {
    calls,
    createContainer: async (opts) => {
      calls.push(opts)
      if (createThrows) throw createThrows
      return container
    },
  }
}

const baseConfig = { firewallRequired: true, instanceNetwork: 'dsh-tenants' }

test('passes when the probe cannot reach the metadata endpoint (exit != 0)', async () => {
  const docker = fakeDocker({ probeExitCode: 1 })
  assert.equal(await verifyTenantFirewall(docker, baseConfig), true)
  assert.equal(docker.calls[0].Image, 'alpine:3')
  assert.equal(docker.calls[0].HostConfig.NetworkMode, 'dsh-tenants')
  assert.equal(docker.calls[0].HostConfig.AutoRemove, true)
})

test('refuses to start when the probe connects (firewall missing)', async () => {
  const docker = fakeDocker({ probeExitCode: 0 })
  await assert.rejects(() => verifyTenantFirewall(docker, baseConfig), /firewall is NOT applied/)
})

test('probe container is force-removed even on failure', async () => {
  const docker = fakeDocker({ probeExitCode: 0 })
  await assert.rejects(() => verifyTenantFirewall(docker, baseConfig))
  assert.ok(docker.calls.includes('remove'))
})

test('skips with a warning when firewallRequired is false', async () => {
  const docker = fakeDocker({ probeExitCode: 0 })
  assert.equal(await verifyTenantFirewall(docker, { ...baseConfig, firewallRequired: false }), false)
  assert.equal(docker.calls.length, 0) // 完全不起探针
})

test('probe creation failure propagates (fail-closed)', async () => {
  const docker = fakeDocker({ probeExitCode: 0, createThrows: new Error('no such image') })
  await assert.rejects(() => verifyTenantFirewall(docker, baseConfig), /no such image/)
})
