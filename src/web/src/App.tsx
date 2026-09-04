import { Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import RequireAuth from './components/RequireAuth'
import SpaceList from './pages/SpaceList'
import SpaceDetail from './pages/SpaceDetail'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><SpaceList /></RequireAuth>} />
      <Route path="/spaces/:slug" element={<RequireAuth><SpaceDetail /></RequireAuth>} />
    </Routes>
  )
}
