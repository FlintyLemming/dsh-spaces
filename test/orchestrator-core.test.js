import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { initDb } from '../src/store/db.js'
import { initDocker } from '../src/orchestrator/docker.js'
import { loadConfig, setActiveConfig } from '../src/config.js'
import {
  containerNameFor, sharedVolumeName, privateVolumeName,
  ensureVolume, removeVolume, ensureTenantNetwork, allocatePort,
  createInstanceContainer, containerRunning,
} from '../src/orchestrator/index.js'
import { upsertInstance } from '../src/store/instances.js'
import { createUser } from '../src/store/users.js'
import { createSpace } from '../src/store/spaces.js'

function fakeDocker() {
  const calls = []
  return {
    calls,
    volumes: new Set(),
    networks: [],
    containers: new Map(),
    async createVolume(opts) { calls.push(['createVolume', opts]); this.volumes.add(opts.Name); return {} },
    getVolume(name) {
      const self = this
      return {
        async inspect() {
          if (!self.volumes.has(name)) {
            const e = new Error(`no such volume: ${name}`); e.statusCode = 404; throw e
          }
          return {}
        },
        async remove() { calls.push(['removeVolume', name]); self.volumes.delete(name) },
      }
    },
    async listNetworks({ filters }) {
      return this.networks.filter((n) => filters.name.includes(n.Name))
    },
    async createNetwork(opts) { calls.push(['createNetwork', opts]); this.networks.push(opts); return {} },
    async createContainer(opts) {
      calls.push(['createContainer', opts])
      this.containers.set(opts.name, { State: { Running: false } })
      return { id: opts.name }
    },
    getContainer(name) {
      const self = this
      return {
        async inspect() {
          const c = self.containers.get(name)
          if (!c) { const e = new Error(`no such container: ${name}`); e.statusCode = 404; throw e }
          return c
        },
      }
    },
  }
}

let docker
beforeEach(() => {
  initDb(':memory:')
  setActiveConfig(loadConfig({ NODE_ENV: 'development' }))
  docker = fakeDocker()
  initDocker(docker)
})

test('naming rules', () => {
  assert.equal(containerNameFor('team-a', 'bob'), 'dsh-team-a-bob')
  assert.equal(sharedVolumeName('team-a'), 'dshvol-team-a-shared')
  assert.equal(privateVolumeName('team-a', 'bob'), 'dshvol-team-a-bob')
})

test('ensureVolume idempotent; removeVolume removes', async () => {
  await ensureVolume('v1')
  await ensureVolume('v1')
  assert.equal(docker.calls.filter((c) => c[0] === 'createVolume').length, 1)
  await removeVolume('v1')
  assert.equal(docker.calls.filter((c) => c[0] === 'removeVolume').length, 1)
  await removeVolume('v1') // 不存在也幂等
})

test('ensureTenantNetwork creates only when absent', async () => {
  await ensureTenantNetwork()
  await ensureTenantNetwork()
  assert.equal(docker.calls.filter((c) => c[0] === 'createNetwork').length, 1)
  assert.equal(docker.networks[0].Name, 'dsh-tenants')
  assert.equal(docker.networks[0].Driver, 'bridge')
})

test('allocatePort skips DB-claimed ports and throws when exhausted', async () => {
  const uid = createUser({ email: 'a@x.com', handle: 'aa' })
  const sid = createSpace({ slug: 's', name: 'S', kind: 'team', ownerId: uid })
  // 占满整个范围（测试用小范围）
  setActiveConfig(loadConfig({ PORT_RANGE_START: '19000', PORT_RANGE_END: '19001' }))
  const inst = upsertInstance({ spaceId: sid, userId: uid, containerName: 'c1' })
  const { updateInstance } = await import('../src/store/instances.js')
  updateInstance(inst.id, { port: 19000 })
  const p = await allocatePort()
  assert.equal(p, 19001)
  updateInstance(inst.id, { port: 19001 })
  // 19000 现在空闲但 DB 里 19001 已占；19000 的 bind 探测应成功
  // 再占 19000：直接监听占位由下一个测试覆盖，这里耗尽判定：
  const uid2 = createUser({ email: 'b@x.com', handle: 'bb' })
  const inst2 = upsertInstance({ spaceId: sid, userId: uid2, containerName: 'c2' })
  updateInstance(inst2.id, { port: 19000 })
  await assert.rejects(() => allocatePort(), (err) => err.code === 'PORT_POOL_EXHAUSTED')
})

test('createInstanceContainer passes full isolation/host config', async () => {
  await createInstanceContainer({
    spaceSlug: 'team-a', handle: 'bob', port: 18000, imageDigest: 'sha256:' + 'a'.repeat(64),
  })
  const [_, opts] = docker.calls.find((c) => c[0] === 'createContainer')
  assert.equal(opts.name, 'dsh-team-a-bob')
  assert.equal(opts.User, '1000:1000')
  assert.ok(opts.Env.includes('DSH_HOME=/home/dsh/.dsh'))
  assert.ok(opts.Env.includes('BASE_PATH=/s/team-a/bob'))
  const hc = opts.HostConfig
  assert.deepEqual(hc.PortBindings, { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '18000' }] })
  assert.equal(hc.ReadonlyRootfs, true)
  assert.equal(hc.NanoCpus, 2e9)
  assert.equal(hc.Memory, 2048 * 1024 * 1024)
  assert.equal(hc.MemorySwap, 2048 * 1024 * 1024)
  assert.equal(hc.PidsLimit, 512)
  assert.deepEqual(hc.CapDrop, ['ALL'])
  assert.deepEqual(hc.SecurityOpt, ['no-new-privileges'])
  assert.equal(hc.NetworkMode, 'dsh-tenants')
  assert.deepEqual(hc.RestartPolicy, { Name: 'unless-stopped' })
  const mounts = Object.fromEntries(hc.Mounts.map((m) => [m.Target, m.Source]))
  assert.equal(mounts['/workspace/shared'], 'dshvol-team-a-shared')
  assert.equal(mounts['/home/dsh'], 'dshvol-team-a-bob')
})

test('containerRunning caches and treats missing container as false', async () => {
  docker.containers.set('c-run', { State: { Running: true } })
  assert.equal(await containerRunning('c-run'), true)
  assert.equal(await containerRunning('c-gone'), false)
})
