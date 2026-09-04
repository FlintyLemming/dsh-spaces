import { test } from 'vitest'
import assert from 'node:assert/strict'
import { initDocker, getDocker, verifyDockerRuntime, isMissingContainerError }
  from '../src/orchestrator/docker.js'

test('getDocker throws before init', () => {
  assert.throws(() => getDocker(), /not initialized/)
})

test('verifyDockerRuntime succeeds when ping resolves', async () => {
  initDocker({ ping: async () => 'OK' })
  await verifyDockerRuntime({})
})

test('verifyDockerRuntime throws a clear error when docker is unreachable', async () => {
  initDocker({ ping: async () => { throw new Error('connect ENOENT /var/run/docker.sock') } })
  await assert.rejects(() => verifyDockerRuntime({}), /Docker daemon unreachable/)
})

test('isMissingContainerError recognizes dockerode 404s', () => {
  assert.equal(isMissingContainerError({ statusCode: 404, message: 'no such container' }), true)
  assert.equal(isMissingContainerError(new Error('no such container: dsh-x-y')), true)
  assert.equal(isMissingContainerError(new Error('boom')), false)
})
