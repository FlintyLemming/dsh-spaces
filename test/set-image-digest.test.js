import { test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('set-image-digest validates format and writes settings', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-data-'))
  const digest = 'sha256:' + 'c'.repeat(64)
  execFileSync('node', ['scripts/set-image-digest.js', digest],
    { env: { ...process.env, DATA_DIR: dataDir } })
  const out = execFileSync('node', ['scripts/set-image-digest.js'],
    { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' })
  assert.match(out, new RegExp(digest))
})

test('set-image-digest rejects non-digest input', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-data-'))
  assert.throws(() =>
    execFileSync('node', ['scripts/set-image-digest.js', 'dsh:latest'],
      { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'pipe' }))
})
