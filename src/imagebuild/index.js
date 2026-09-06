import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BUILD_TIMEOUT_MS = 20 * 60 * 1000
const LOG_TAIL_BYTES = 4096

let running = false
let runner = defaultRunner

/** 测试注入点；传 null 恢复真实构建器。 */
export function setImageBuildRunner(fn) {
  runner = fn ?? defaultRunner
}

export function buildInProgress() {
  return running
}

async function defaultRunner() {
  const { stdout, stderr } = await new Promise((resolve, reject) => {
    execFile('bash', ['scripts/build-image.sh'],
      { cwd: repoRoot, timeout: BUILD_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, out, errOut) => (err
        ? reject(Object.assign(err, { stdout: out, stderr: errOut }))
        : resolve({ stdout: out, stderr: errOut })))
  })
  const log = `${stdout}\n${stderr}`.slice(-LOG_TAIL_BYTES)
  const match = /sha256:[a-f0-9]{64}/.exec(log)
  if (!match) throw new Error('build finished but no sha256 digest found in output')
  return { digest: match[0], log }
}

/** 触发一次镜像构建；并发调用抛 BUILD_IN_PROGRESS，由路由层转 409。 */
export async function runImageBuild() {
  if (running) {
    const err = new Error('build already in progress')
    err.code = 'BUILD_IN_PROGRESS'
    throw err
  }
  running = true
  try {
    return await runner()
  } finally {
    running = false
  }
}
