export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // content-type 只在真有 body 时才发：无 body 的 POST/DELETE 带上它，
  // 服务端会把空 body 当成畸形 JSON 而拒绝。
  const hasBody = init?.body !== undefined && init?.body !== null
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string } } | null = null
    try {
      body = await res.json()
    } catch {
      // 非 JSON 错误体
    }
    throw new ApiRequestError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `请求失败（${res.status}）`,
    )
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export function errorMessage(err: unknown, fallback = '操作失败'): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

export interface Me {
  id: number
  email: string
  handle: string
  displayName: string
  role: 'admin' | 'user'
}

export type SpaceKind = 'personal' | 'team'
export type MemberRole = 'owner' | 'member'
export type InstanceStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface SpaceSummary {
  id: number
  slug: string
  name: string
  kind: SpaceKind
  memberRole: MemberRole
  instanceStatus: InstanceStatus | null
}

export interface Member {
  userId: number
  email: string
  handle: string
  displayName: string
  role: string
}

export interface Instance {
  id: number
  status: InstanceStatus
  error: string | null
  imageDigest: string | null
}

export interface SpaceDetail {
  space: { id: number; slug: string; name: string; kind: SpaceKind; memberRole: MemberRole }
  members: Member[]
  instance: Instance | null
}

export const STATUS_TEXT: Record<InstanceStatus, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  error: '异常',
}

export function statusText(status: InstanceStatus | null | undefined): string {
  return status ? STATUS_TEXT[status] : '未创建'
}
