import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api'
import { CreateSpaceDialog } from '../components/CreateSpaceDialog'
import { useMe } from '../components/RequireAuth'

interface SpaceRow {
  id: number
  slug: string
  name: string
  kind: 'personal' | 'team'
  memberRole: 'owner' | 'member'
  instanceStatus: string | null
}

const STATUS_TEXT: Record<string, string> = {
  stopped: '已停止', starting: '启动中', running: '运行中', error: '异常',
}

export default function SpaceList() {
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const { user } = useMe()
  useEffect(() => {
    apiFetch<{ spaces: SpaceRow[] }>('/api/spaces')
      .then((r) => setSpaces(r.spaces))
      .catch((e) => setError(e.message))
  }, [])
  if (error) return <main className="page"><p role="alert">加载失败：{error}</p></main>
  if (!spaces) return <main className="page"><p>加载中…</p></main>
  const personal = spaces.filter((s) => s.kind === 'personal')
  const team = spaces.filter((s) => s.kind === 'team')
  const renderTable = (rows: SpaceRow[]) => (
    <table>
      <thead>
        <tr><th>名称</th><th>标识</th><th>角色</th><th>我的实例</th></tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td><Link to={`/spaces/${s.slug}`}>{s.name}</Link></td>
            <td className="mono">{s.slug}</td>
            <td>{s.memberRole === 'owner' ? '所有者' : '成员'}</td>
            <td>{s.instanceStatus ? STATUS_TEXT[s.instanceStatus] : '未创建'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  return (
    <main className="page">
      <div className="section-head">
        <h1 className="title">空间</h1>
        {user?.role === 'admin' && <Link to="/admin/users">管理后台</Link>}
      </div>
      <h2>个人空间</h2>
      {renderTable(personal)}
      <div className="section-head">
        <h2>团队空间</h2>
        <button onClick={() => setCreating(true)}>创建团队空间</button>
      </div>
      {creating && (
        <CreateSpaceDialog
          onCreated={(slug) => { setCreating(false); navigate(`/spaces/${slug}`) }}
          onClose={() => setCreating(false)}
        />
      )}
      {team.length ? renderTable(team) : <p className="body">还没有加入任何团队空间。</p>}
    </main>
  )
}
