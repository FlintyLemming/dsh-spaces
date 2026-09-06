import { useEffect, useState } from 'react'
import { apiFetch } from '../../api'
import { useMe } from '../../components/RequireAuth'

interface AdminUser {
  id: number
  email: string
  handle: string
  display_name: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  space_count: number
  running_instances: number
}

export default function UsersPage() {
  const { user: me } = useMe()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(q: string) {
    try {
      const data = await apiFetch<{ users: AdminUser[] }>(
        `/api/admin/users?search=${encodeURIComponent(q)}`)
      setUsers(data.users)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }
  useEffect(() => { void load('') }, [])

  async function act(id: number, action: string, body?: object) {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/admin/users/${id}/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      await load(search)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  if (!users) return <p className="body">加载中…</p>
  return (
    <section>
      <input className="admin-filter" value={search} placeholder="搜索邮箱 / 用户名 / 昵称"
        onChange={(e) => { setSearch(e.target.value); void load(e.target.value) }} />
      {error && <p className="error-text" role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>邮箱</th><th>用户名</th><th>角色</th><th>状态</th>
            <th className="num">空间数</th><th className="num">运行中实例</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td className="mono">{u.handle}</td>
              <td>{u.role === 'admin' ? '管理员' : '用户'}</td>
              <td>{u.status === 'active' ? '正常' : '已禁用'}</td>
              <td className="num">{u.space_count}</td>
              <td className="num">{u.running_instances}</td>
              <td>
                <span className="row-actions">
                  {u.status === 'active'
                    ? <button disabled={busy || u.id === me?.id}
                        onClick={() => void act(u.id, 'disable')}>禁用</button>
                    : <button disabled={busy} onClick={() => void act(u.id, 'enable')}>启用</button>}
                  <button disabled={busy || u.id === me?.id}
                    onClick={() => void act(u.id, 'role', { role: u.role === 'admin' ? 'user' : 'admin' })}>
                    {u.role === 'admin' ? '降为用户' : '设为管理员'}
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 0 && <p className="body">没有匹配的用户。</p>}
    </section>
  )
}
