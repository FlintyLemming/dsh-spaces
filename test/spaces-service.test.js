import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import { createUser } from '../src/store/users.js'
import { listSpacesForUser, listSpaceMembers, getSpaceBySlug } from '../src/store/spaces.js'
import { listVolumesForSpace } from '../src/store/volumes.js'
import { listAudit } from '../src/store/audit.js'
import { provisionNewUser } from '../src/spaces/service.js'

beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  initDocker({
    async createVolume() { return {} },
    async createContainer(opts) {
      return { start: async () => {}, wait: async () => ({ StatusCode: 0 }) }
    },
    getVolume(name) {
      return {
        async inspect() {
          const e = new Error(`no such volume: ${name}`); e.statusCode = 404; throw e
        },
        async remove() {},
      }
    },
    async listNetworks() { return [{ Name: 'dsh-tenants' }] },
  })
})

test('provisionNewUser creates personal space, volumes, owner membership, audit', async () => {
  const uid = createUser({ email: 'new@x.com', handle: 'newbie' })
  const space = await provisionNewUser(uid)
  assert.equal(space.slug, 'p-newbie')
  assert.equal(space.kind, 'personal')
  const members = listSpaceMembers(space.id)
  assert.equal(members.length, 1)
  assert.equal(members[0].role, 'owner')
  const vols = listVolumesForSpace(space.id)
  assert.deepEqual(vols.map((v) => v.docker_name).sort(),
    ['dshvol-p-newbie-newbie', 'dshvol-p-newbie-shared'])
  const audit = listAudit({ action: 'space.create' })
  assert.equal(audit.length, 1)
  assert.equal(JSON.parse(audit[0].detail_json).kind, 'personal')
})

test('provisionNewUser is idempotent and suffixes slug conflicts', async () => {
  createUser({ email: 'taken@x.com', handle: 'taken' })
  const uid = createUser({ email: 'n@x.com', handle: 'n' })
  // 手动占位 slug p-n
  const { createSpace } = await import('../src/store/spaces.js')
  createSpace({ slug: 'p-n', name: 'x', kind: 'team', ownerId: uid })
  const space = await provisionNewUser(uid)
  assert.equal(space.slug, 'p-n-2')
  const again = await provisionNewUser(uid)
  assert.equal(again.id, space.id)
  assert.equal(listSpacesForUser(uid).filter((s) => s.kind === 'personal').length, 1)
})
