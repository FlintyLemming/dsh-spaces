import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import RequireAuth from './components/RequireAuth'
import SpaceList from './pages/SpaceList'
import SpaceDetail from './pages/SpaceDetail'
import InstanceView from './pages/InstanceView'
import AdminLayout from './pages/admin/AdminLayout'
import UsersPage from './pages/admin/UsersPage'
import SpacesPage from './pages/admin/SpacesPage'
import SpaceDetailPage from './pages/admin/SpaceDetailPage'
import SettingsImagePage from './pages/admin/SettingsImagePage'
import UsageAuditPage from './pages/admin/UsageAuditPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><SpaceList /></RequireAuth>} />
      <Route path="/spaces/:slug" element={<RequireAuth><SpaceDetail /></RequireAuth>} />
      <Route path="/spaces/:slug/instance" element={<RequireAuth><InstanceView /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="spaces" element={<SpacesPage />} />
        <Route path="spaces/:slug" element={<SpaceDetailPage />} />
        <Route path="settings" element={<SettingsImagePage />} />
        <Route path="usage" element={<UsageAuditPage />} />
      </Route>
    </Routes>
  )
}
