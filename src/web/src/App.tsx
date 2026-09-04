import { Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import RequireAuth from './components/RequireAuth'

function Home() {
  return (
    <main className="page">
      <h1 className="title">dsh-spaces</h1>
      <p className="body">平台骨架已就绪。</p>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
    </Routes>
  )
}
