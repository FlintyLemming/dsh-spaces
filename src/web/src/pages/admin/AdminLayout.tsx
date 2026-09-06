import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useMe } from '../../components/RequireAuth'

const TABS = [
  ['users', '用户'],
  ['spaces', '空间'],
  ['settings', '设置与镜像'],
  ['usage', '用量与审计'],
] as const

export default function AdminLayout() {
  const { user, loading } = useMe()
  if (loading) return <main className="page"><p className="body">加载中…</p></main>
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return (
    <main className="page admin-page">
      <h1 className="title">管理后台</h1>
      <nav className="admin-tabs">
        {TABS.map(([key, label]) => (
          <NavLink key={key} to={`/admin/${key}`} className="admin-tab">{label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </main>
  )
}
