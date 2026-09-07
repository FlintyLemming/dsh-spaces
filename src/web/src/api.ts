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

export interface Me {
  id: number
  email: string
  handle: string
  displayName: string
  role: 'admin' | 'user'
}
