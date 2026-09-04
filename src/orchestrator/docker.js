import Docker from 'dockerode'

let client = null

export function initDocker(c) {
  client = c
  return client
}

export function getDocker() {
  if (!client) throw new Error('docker client not initialized; call initDocker() first')
  return client
}

export async function verifyDockerRuntime(config) {
  if (!client) initDocker(new Docker({ socketPath: config.dockerSocketPath }))
  try {
    await client.ping()
  } catch (err) {
    throw new Error(`Docker daemon unreachable at ${config.dockerSocketPath}: ${err.message}`)
  }
}

export function isMissingContainerError(err) {
  const text = String(err?.message ?? err ?? '').toLowerCase()
  return err?.statusCode === 404
    || text.includes('no such container')
    || text.includes('no such object')
}
