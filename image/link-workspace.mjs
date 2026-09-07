// image/link-workspace.mjs — 把工作区包平铺链接进 /app/dsh/node_modules。
//
// 为什么需要：dsh 从源码运行（start.sh 用 tsx 跑 apps/cli/src/bin.ts），pnpm 的
// isolated 布局只把包链进各自 importer 的 node_modules，根 node_modules 里几乎没有
// 工作区包。而 loader 挂载根树插件（如 directory-picker-auto 拉起 browse 后端）时
// 是从 vendor/loader/src/config/tree.ts 直接 import 包名的——Node 沿 /app/dsh 往上
// 走找不到它们，boot 直接失败：
//   Cannot find package '@deepseek-ai/dsh-client-ui-directory-picker-browse'
// dsh 自己的 $DSH_HOME/profiles/node_modules 兜底只覆盖以 profile 目录为基准的解析，
// 救不了这条路径。软链的包按 Node 默认跟随符号链接、从真实目录解析自己的依赖，
// 所以每个包一条平铺链接即可。
//
// 构建期以 root 执行（node_modules 归 root，运行期根 fs 只读）。
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = '/app/dsh'
const skip = new Set(['node_modules', 'lib', 'dist', 'src'])
const packages = []

function walk(dir, depth) {
  if (depth > 4) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (existsSync(join(path, 'package.json'))) packages.push(path)
    walk(path, depth + 1)
  }
}
walk(root, 0)

const modules = join(root, 'node_modules')
let linked = 0
for (const dir of packages) {
  let name
  try {
    name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
  } catch {
    continue // 无法解析的 package.json 不是可解析的包
  }
  if (!name) continue
  const link = join(modules, name)
  if (existsSync(link)) continue // 已有真实安装优先，绝不覆盖
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(dir, link, 'dir')
  linked++
}
console.log(`linked ${linked} of ${packages.length} workspace packages`)
if (!existsSync(join(modules, '@deepseek-ai/dsh-client-ui-directory-picker-browse'))) {
  throw new Error('link-workspace: 根树插件包仍不可解析，构建应当失败')
}
