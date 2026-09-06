import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../api'

interface AdminSpace {
  id: number
  slug: string
  name: string
  kind: 'personal' | 'team'
  member_count: number
  instance_count: number
  running_count: number
}

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<AdminSpace[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    apiFetch<{ spaces: AdminSpace[] }>('/api/admin/spaces')
      .then((d) => setSpaces(d.spaces))
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
  }, [])
  if (error) return <p className="error-text" role="alert">{error}</p>
  if (!spaces) return <p className="body">加载中…</p>
  return (
    <table>
      <thead>
        <tr>
          <th>标识</th><th>名称</th><th>类型</th>
          <th className="num">成员</th><th className="num">实例</th><th className="num">运行中</th>
        </tr>
      </thead>
      <tbody>
        {spaces.map((s) => (
          <tr key={s.id}>
            <td className="mono"><Link to={`/admin/spaces/${s.slug}`}>{s.slug}</Link></td>
            <td>{s.name}</td>
            <td>{s.kind === 'personal' ? '个人' : '团队'}</td>
            <td className="num">{s.member_count}</td>
            <td className="num">{s.instance_count}</td>
            <td className="num">{s.running_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
