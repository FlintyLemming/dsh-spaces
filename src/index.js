import { join } from 'node:path'
import { loadConfig, validateConfig, setActiveConfig } from './config.js'
import { initDb } from './store/db.js'
import { buildServer } from './server.js'
import { verifyDockerRuntime, getDocker } from './orchestrator/docker.js'
import { verifyTenantFirewall } from './orchestrator/firewall-check.js'
import { ensureTenantNetwork, reconcile, startIdleSweep } from './orchestrator/index.js'
import { ensureAdmin } from './auth/bootstrap.js'

const config = loadConfig()
validateConfig(config)
setActiveConfig(config)
initDb(join(config.dataDir, 'dsh-spaces.db'))
ensureAdmin(config)
await verifyDockerRuntime(config)
await ensureTenantNetwork()
// 防火墙校验必须在租户网络存在之后：探针要跑在该网络里。
await verifyTenantFirewall(getDocker(), config)
await reconcile()
startIdleSweep()

const app = await buildServer({ config })
await app.listen({ port: config.port, host: config.host })
app.log.info(`dsh-spaces listening on ${config.host}:${config.port}`)

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0))
  })
}
