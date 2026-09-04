// 用法：node scripts/set-image-digest.js <sha256:digest>   写入 settings.image_digest
//       node scripts/set-image-digest.js                  打印当前值
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'
import { initDb } from '../src/store/db.js'
import { getSetting, setSetting } from '../src/store/settings.js'

const config = loadConfig()
initDb(join(config.dataDir, 'dsh-spaces.db'))
const arg = process.argv[2]
if (!arg) {
  console.log(getSetting('image_digest') || '(unset)')
  process.exit(0)
}
if (!/^sha256:[a-f0-9]{64}$/.test(arg)) {
  console.error('error: digest must match sha256:<64 lowercase hex>')
  process.exit(1)
}
setSetting('image_digest', arg)
console.log(`image_digest=${arg}`)
