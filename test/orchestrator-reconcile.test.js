import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { setSetting } from '../src/store/settings.js'
import { createUser } from '../src/store/users.js'
import { createSpace } from '../src/store/spaces.js'
import {
  upsertInstance, updateInstance, getInstanceById,
} from '../src/store/instances.js'
import { reconcile, sweepIdleInstances } from '../src/orchestrator/index.js'

let docker, uid, sid
beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  uid = createUser({ email: 'a@x.com', handle: 'aa' })
  sid = createSpace({ slug: 'p-aa', name: 'P', kind: 'personal', ownerId: uid })
  docker = {
    containers: [], // { Names: ['/dsh-p-aa-aa'], State: 'running'|'exited' }
    async listContainers() { return this.containers },
    getContainer(name) {
      const self = this
      return {
        async inspect() {
          const c = self.containers.find((x) => x.Names[0] === `/${name}`)
          if (!c) { const e = new Error(`no such container: ${name}`); e.statusCode = 404; throw e }
          return { State: { Running: c.State === 'running' } }
        },
        async stop() {
          const c = self.containers.find((x) => x.Names[0] === `/${name}`)
          if (c) c.State = 'exited'
        },
      }
    },
  }
  initDocker(docker)
})

test('reconcile marks vanished running/starting containers as error', async () => {
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  updateInstance(inst.id, { status: 'running' })
  await reconcile()
  assert.equal(getInstanceById(inst.id).status, 'error')
  assert.match(getInstanceById(inst.id).error, /disappeared|missing/i)
})

test('reconcile adopts actually-running containers', async () => {
  docker.containers.push({ Names: ['/dsh-p-aa-aa'], State: 'running' })
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  await reconcile()
  assert.equal(getInstanceById(inst.id).status, 'running')
})

test('sweepIdleInstances stops instances idle beyond threshold', async () => {
  setSetting('idle_stop_minutes', '60')
  docker.containers.push({ Names: ['/dsh-p-aa-aa'], State: 'running' })
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'dsh-p-aa-aa' })
  const now = Date.now()
  updateInstance(inst.id, { status: 'running', last_active_at: now - 61 * 60 * 1000 })
  await sweepIdleInstances(now)
  assert.equal(getInstanceById(inst.id).status, 'stopped')
  // 活跃实例不动
  updateInstance(inst.id, { status: 'running', last_active_at: now })
  await sweepIdleInstances(now)
  assert.equal(getInstanceById(inst.id).status, 'running')
})
