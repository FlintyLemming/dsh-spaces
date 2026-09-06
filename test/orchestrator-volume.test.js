import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDocker } from '../src/orchestrator/docker.js'
import { removeVolume } from '../src/orchestrator/index.js'

const calls = []
function fakeDocker({ missing = false, fail = false } = {}) {
  return {
    getVolume(name) {
      return {
        async remove() {
          calls.push(`volume.remove:${name}`)
          if (fail) throw new Error('volume in use')
          if (missing) throw Object.assign(new Error(`no such volume: ${name}`), { statusCode: 404 })
        },
      }
    },
  }
}

beforeEach(() => { calls.length = 0 })

test('removeVolume removes the docker volume', async () => {
  initDocker(fakeDocker())
  await removeVolume('dshvol-team-a-shared')
  assert.deepEqual(calls, ['volume.remove:dshvol-team-a-shared'])
})

test('removeVolume is idempotent on missing volume', async () => {
  initDocker(fakeDocker({ missing: true }))
  await removeVolume('dshvol-gone-shared') // 不抛错
})

test('removeVolume propagates other docker errors', async () => {
  initDocker(fakeDocker({ fail: true }))
  await assert.rejects(() => removeVolume('dshvol-x-shared'), /volume in use/)
})
