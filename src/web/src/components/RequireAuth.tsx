import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { apiFetch, type Me } from '../api'

let cachedUser: Me | null | undefined

export function useMe(): { user: Me | null; loading: boolean; refresh: () => void } {
  const [user, setUser] = useState<Me | null>(cachedUser ?? null)
  const [loading, setLoading] = useState(cachedUser === undefined)
  const refresh = () => {
    setLoading(true)
    apiFetch<{ user: Me }>('/api/auth/me')
      .then((r) => { cachedUser = r.user; setUser(r.user) })
      .catch(() => { cachedUser = null; setUser(null) })
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])
  return { user, loading, refresh }
}

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useMe()
  const location = useLocation()
  if (loading) return <main className="page"><p className="body">加载中…</p></main>
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?return_to=${returnTo}`} replace />
  }
  return <>{children}</>
}
