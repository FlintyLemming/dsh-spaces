import { test } from 'vitest'
import assert from 'node:assert/strict'
import { collectUsage, computeCpuPercent } from '../src/admin/usage.js'

const statsFixture = {
  cpu_stats: { cpu_usage: { total_usage: 2000 }, system_cpu_usage: 10000, online_cpus: 2 },
  precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 5000 },
  memory_stats: { usage: 512 * 1024 * 1024 },
}

function fakeDocker() {
  return {
    listContainers: async () => [
      { Names: ['/dsh-team-x-alice'], Id: 'c1' },
      { Names: ['/dsh-team-x-bob'], Id: 'c2' },
      { Names: ['/dsh-p-carol-carol'], Id: 'c3' },
    ],
    getContainer: (id) => ({
      stats: async () => {
        if (id === 'c2') throw new Error('stats unavailable')
        return statsFixture
      },
    }),
    df: async () => ({
      Volumes: [
        { Name: 'dshvol-team-x-shared', UsageData: { Size: 1024 } },
        { Name: 'dshvol-team-x-alice', UsageData: { Size: 2048 } },
        { Name: 'dshvol-p-carol-carol', UsageData: { Size: 4096 } },
      ],
    }),
  }
}

test('computeCpuPercent uses the docker delta formula', () => {
  // (1000 / 5000) * 2 cores * 100 = 40%
  assert.equal(computeCpuPercent(statsFixture), 40)
})

test('computeCpuPercent is zero when the sample window has no system delta', () => {
  assert.equal(computeCpuPercent({
    cpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 5000, online_cpus: 2 },
    precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 5000 },
    memory_stats: { usage: 0 },
  }), 0)
})

test('collectUsage aggregates per space and skips failed stats', async () => {
  const usage = await collectUsage(fakeDocker())
  assert.equal(usage.running, 3)
  assert.equal(usage.memoryMb, 1024) // 2 × 512MB（c2 被跳过）
  const team = usage.spaces.find((s) => s.slug === 'team-x')
  assert.equal(team.running, 2)
  assert.equal(team.volumeBytes, 3072)
  const personal = usage.spaces.find((s) => s.slug === 'p-carol')
  assert.equal(personal.volumeBytes, 4096)
  assert.equal(usage.diskBytes, 7168)
})

test('collectUsage prefers the registered slug list over name guessing', async () => {
  // 'team-x' 与 'team-x-alice' 都是已登记 slug 时，容器名归属最长匹配。
  const docker = fakeDocker()
  const usage = await collectUsage(docker, ['team-x', 'p-carol'])
  assert.deepEqual(usage.spaces.map((s) => s.slug), ['p-carol', 'team-x'])
  assert.equal(usage.spaces.find((s) => s.slug === 'team-x').running, 2)
})

test('collectUsage counts volumes of spaces that have no running container', async () => {
  const docker = {
    listContainers: async () => [],
    getContainer: () => ({ stats: async () => statsFixture }),
    df: async () => ({
      Volumes: [
        { Name: 'dshvol-team-x-shared', UsageData: { Size: 512 } },
        { Name: 'not-ours', UsageData: { Size: 9999 } },
      ],
    }),
  }
  const usage = await collectUsage(docker, ['team-x'])
  assert.equal(usage.running, 0)
  assert.equal(usage.diskBytes, 512)
  assert.deepEqual(usage.spaces, [{ slug: 'team-x', running: 0, memoryMb: 0, volumeBytes: 512 }])
})

test('GET /api/admin/usage resolves slugs from the space table', async () => {
  const { makeAdminApp, adminCookie } = await import('./helpers.js')
  const app = await makeAdminApp({
    docker: {
      ping: async () => 'OK',
      listContainers: async () => [{ Names: ['/dsh-team-x-a-b'], Id: 'c1' }],
      getContainer: () => ({ stats: async () => statsFixture }),
      df: async () => ({ Volumes: [{ Name: 'dshvol-team-x-shared', UsageData: { Size: 2048 } }] }),
    },
  })
  const { getDb } = await import('../src/store/db.js')
  // handle 'a-b' 含连字符：只有已登记 slug 才能正确切分容器名。
  getDb().prepare("INSERT INTO spaces (slug, name, kind, owner_id, created_at) VALUES ('team-x','Team X','team',1,?)")
    .run(Date.now())
  const res = await app.inject({ method: 'GET', url: '/api/admin/usage', headers: adminCookie })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.running, 1)
  assert.equal(body.memoryMb, 512)
  assert.deepEqual(body.spaces, [{ slug: 'team-x', running: 1, memoryMb: 512, volumeBytes: 2048 }])
})
