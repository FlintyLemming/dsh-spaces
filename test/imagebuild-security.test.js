import { test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync, execSync, execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'build-image.sh')

const git = (dsh, ...args) => execFileSync('git', ['-C', dsh, ...args])
const commitAll = (dsh, msg) => {
  git(dsh, 'add', '-A')
  git(dsh, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg)
}

/**
 * 最小合法夹具：git 化的 dsh/（两个 commit）、image/（Dockerfile + start.sh +
 * 两个**对 HEAD 真实可应用**的 patch）、image/.dockerignore 白名单。
 * patch 必须是真 diff —— 空文件过不了 `git apply --check`。
 */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-imgbuild-'))
  const dsh = join(dir, 'dsh')
  const image = join(dir, 'image')
  mkdirSync(dsh)
  mkdirSync(image)
  execFileSync('git', ['init', '-q', dsh])
  // 脚本以 dsh/package.json 存在与否判断 clone 是否就位。
  writeFileSync(join(dsh, 'package.json'), '{"name":"dsh"}\n')
  writeFileSync(join(dsh, 'hello.txt'), 'hello\n')
  commitAll(dsh, 'init')
  writeFileSync(join(dsh, 'base.txt'), 'base\n')
  commitAll(dsh, 'add base')
  const commit = git(dsh, 'rev-parse', 'HEAD').toString().trim()

  // 两个 patch 都以 HEAD 为基底，各改一个文件，生成后还原工作区。
  writeFileSync(join(dsh, 'hello.txt'), 'hello patched by security\n')
  execSync(`git -C "${dsh}" diff > "${join(image, 'dsh-security.patch')}"`)
  git(dsh, 'checkout', '-q', '--', '.')
  writeFileSync(join(dsh, 'base.txt'), 'base patched\n')
  execSync(`git -C "${dsh}" diff > "${join(image, 'dsh-base-path.patch')}"`)
  git(dsh, 'checkout', '-q', '--', '.')

  writeFileSync(join(image, 'Dockerfile'), 'FROM scratch\n')
  writeFileSync(join(image, 'start.sh'), '#!/bin/bash\n')
  writeFileSync(join(image, 'link-workspace.mjs'), '// noop\n')
  writeFileSync(join(image, '.dockerignore'), [
    '*',
    '!dsh/', '!dsh/**', '!image/', '!image/Dockerfile', '!image/start.sh',
    '!image/dsh-security.patch', '!image/dsh-base-path.patch', '!image/link-workspace.mjs', '',
  ].join('\n'))
  return { dir, dsh, image, commit }
}

function run(fixture, env = {}) {
  return promisify(execFile)('bash', [SCRIPT], {
    env: {
      ...process.env,
      ROOT_DIR: fixture.dir,
      DSH_DIR: fixture.dsh,
      IMAGE_DIR: fixture.image,
      DOCKER_BUILD: 'false',
      APPROVED_DSH_COMMIT: fixture.commit,
      ...env,
    },
  })
}

async function expectFail(fixture, env, pattern) {
  await assert.rejects(
    () => run(fixture, env),
    (err) => {
      assert.match(String(err.stderr), pattern)
      return true
    },
  )
}

test('positive: clean fixture passes all checks (build skipped)', async () => {
  const f = makeFixture()
  const { stdout } = await run(f)
  assert.match(stdout, /docker build skipped/)
})

test('negative: commit drift is rejected', async () => {
  const f = makeFixture()
  await expectFail(f, { APPROVED_DSH_COMMIT: '0'.repeat(40) }, /is not approved/)
})

test('negative: dirty working tree is rejected', async () => {
  const f = makeFixture()
  writeFileSync(join(f.dsh, 'stray.txt'), 'untracked\n')
  await expectFail(f, {}, /tracked or untracked changes/)
})

test('negative: non-applicable patch is rejected', async () => {
  const f = makeFixture()
  writeFileSync(join(f.image, 'dsh-security.patch'), 'garbage that is not a patch\n')
  await expectFail(f, {}, /apply|patch/i)
})

test('negative: .dockerignore whitelist drift is rejected', async () => {
  const f = makeFixture()
  writeFileSync(join(f.image, '.dockerignore'),
    '*\n!dsh/\n!dsh/**\n!image/\n!image/Dockerfile\n!image/start.sh\n!image/dsh-security.patch\n!image/dsh-base-path.patch\n!secrets/\n')
  await expectFail(f, {}, /unexpected build-context inclusion|unexpected \.dockerignore inclusion/)
})
