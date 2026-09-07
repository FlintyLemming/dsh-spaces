import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import RequireAuth from './components/RequireAuth'
import { AuthProvider } from './state/auth'
import { SpacesProvider } from './state/spaces'
import { AppShell } from './app/AppShell'
import SpacesOverview from './pages/SpacesOverview'
import SpaceLayout from './pages/SpaceLayout'
import SpaceOverviewTab from './pages/SpaceOverviewTab'
import SpaceMembersTab from './pages/SpaceMembersTab'
import SpaceSettingsTab from './pages/SpaceSettingsTab'
import InstanceView from './pages/InstanceView'
import AdminLayout from './pages/admin/AdminLayout'
import UsersPage from './pages/admin/UsersPage'
import SpacesPage from './pages/admin/SpacesPage'
import SpaceDetailPage from './pages/admin/SpaceDetailPage'
import SettingsImagePage from './pages/admin/SettingsImagePage'
import UsageAuditPage from './pages/admin/UsageAuditPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* 实例视图要把整屏让给 iframe，所以走在应用外壳之外。 */}
        <Route
          path="/spaces/:slug/instance"
          element={
            <RequireAuth>
              <InstanceView />
            </RequireAuth>
          }
        />

        <Route
          element={
            <RequireAuth>
              <SpacesProvider>
                <AppShell />
              </SpacesProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/spaces" replace />} />
          <Route path="/spaces" element={<SpacesOverview />} />
          <Route path="/spaces/:slug" element={<SpaceLayout />}>
            <Route index element={<SpaceOverviewTab />} />
            <Route path="members" element={<SpaceMembersTab />} />
            <Route path="settings" element={<SpaceSettingsTab />} />
          </Route>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="spaces" element={<SpacesPage />} />
            <Route path="spaces/:slug" element={<SpaceDetailPage />} />
            <Route path="settings" element={<SettingsImagePage />} />
            <Route path="usage" element={<UsageAuditPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/spaces" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
