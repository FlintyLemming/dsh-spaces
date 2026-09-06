import { useState, type FormEvent } from 'react'
import { apiFetch } from '../api'

export interface Member {
  userId: number
  email: string
  handle: string
  displayName: string
  role: string
}

interface Props {
  slug: string
  members: Member[]
  meId: number
  onChanged: () => void
}

export function MembersPanel({ slug, members, meId, onChanged }: Props) {
  const isOwner = members.some((m) => m.userId === meId && m.role === 'owner')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/spaces/${slug}/members`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setEmail('')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  async function remove(userId: number) {
    setError('')
    setBusy(true)
    try {
      await apiFetch(`/api/spaces/${slug}/members/${userId}`, { method: 'DELETE' })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>成员</h2>
      <table>
        <thead>
          <tr>
            <th>邮箱</th><th>标识</th><th>名称</th><th>角色</th>{isOwner && <th></th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>{m.email}</td>
              <td className="mono">{m.handle}</td>
              <td>{m.displayName}</td>
              <td>{m.role === 'owner' ? '所有者' : '成员'}</td>
              {isOwner && (
                <td>
                  {m.role !== 'owner' && (
                    <button disabled={busy} onClick={() => remove(m.userId)}>移除</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {isOwner && (
        <form onSubmit={add} className="member-add">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="按邮箱添加已注册用户"
            type="email"
            required
          />
          <button type="submit" disabled={busy}>添加</button>
        </form>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  )
}
