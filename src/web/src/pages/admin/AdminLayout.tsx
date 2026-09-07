import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../state/auth'

/** 管理后台的守卫层：导航由侧边栏负责，这里只挡非管理员。 */
export default function AdminLayout() {
  const { user } = useAuth()
  if (user && user.role !== 'admin') return <Navigate to="/spaces" replace />
  return <Outlet />
}
