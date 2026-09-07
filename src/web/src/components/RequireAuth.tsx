import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { Spinner } from './ui'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="grid h-dvh place-items-center text-lg text-subtle" role="status">
        <Spinner />
      </div>
    )
  }
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?return_to=${returnTo}`} replace />
  }
  return <>{children}</>
}
