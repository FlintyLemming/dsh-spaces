import { join } from 'node:path'
import { loadConfig, validateConfig, setActiveConfig } from './config.js'
import { initDb } from './store/db.js'
import { buildServer } from './server.js'
import { verifyDockerRuntime } from './orchestrator/docker.js'

const config = loadConfig()
validateConfig(config)
setActiveConfig(config)
initDb(join(config.dataDir, 'dsh-spaces.db'))
await verifyDockerRuntime(config)

const app = await buildServer({ config })
await app.listen({ port: config.port, host: config.host })
app.log.info(`dsh-spaces listening on ${config.host}:${config.port}`)

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0))
  })
}
