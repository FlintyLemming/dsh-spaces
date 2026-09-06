import { getSpaceBySlug, getSpaceMember } from '../store/spaces.js'
import { getUserByHandle } from '../store/users.js'
import { getInstance } from '../store/instances.js'

const GATEWAY_PATH_RE = /^\/s\/([a-z0-9-]+)\/([a-z0-9-]+)(\/.*)?$/

export function parseGatewayPath(url) {
  const qIndex = url.indexOf('?')
  const pathname = qIndex === -1 ? url : url.slice(0, qIndex)
  const query = qIndex === -1 ? '' : url.slice(qIndex)
  const m = GATEWAY_PATH_RE.exec(pathname)
  if (!m) return null
  return {
    slug: m[1],
    handle: m[2],
    rest: m[3] ?? '/',
    // 无 rest 且路径不以 / 结尾：相对资源 URL 会解析到错误层级，需要补斜杠。
    bareRoot: m[3] === undefined && !pathname.endsWith('/'),
    query,
  }
}

export function mayAccessInstance(user, instance, membership) {
  if (!user || user.status !== 'active') return false
  if (user.role === 'admin') return true
  return membership != null && instance.user_id === user.id
}

export function resolveGatewayTarget(slug, handle) {
  const space = getSpaceBySlug(slug)
  if (!space) return null
  const targetUser = getUserByHandle(handle)
  if (!targetUser) return null
  const instance = getInstance(space.id, targetUser.id)
  if (!instance) return null
  return { space, targetUser, instance }
}

// getSpaceMember 在本文件不直接用，但访问判定方需要它；re-export 以便网关单点导入。
export { getSpaceMember }
