import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiRequestError } from '../api'
import { useMe } from '../components/RequireAuth'

interface Instance {
  id: number
  status: 'stopped' | 'starting' | 'running' | 'error'
  error: string | null
  imageDigest: string | null
}

interface Detail {
  space: { id: number; slug: string; name: string; kind: string; memberRole: string }
  members: { userId: number; email: string; handle: string; displayName: string; role: string }[]
  instance: Instance | null
}

const STATUS_TEXT: Record<string, string> = {
  stopped: '已停止', starting: '启动中', running: '运行中', error: '异常',
}

export default function SpaceDetail() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useMe()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => apiFetch<Detail>(`/api/spaces/${slug}`).then(setDetail)
  useEffect(() => { load().catch((e) => setError(e.message)) }, [slug])

  // starting 状态每 3 秒轮询（spec §8：动效只表达状态变化）
  useEffect(() => {
    if (detail?.instance?.status !== 'starting') return
    const t = setInterval(() => { load().catch(() => {}) }, 3000)
    return () => clearInterval(t)
  }, [detail?.instance?.status, slug])

  if (error) return <main className="page"><p role="alert">加载失败：{error}</p></main>
  if (!detail) return <main className="page"><p>加载中…</p></main>
  const { space, members, instance } = detail

  const action = async (verb: 'start' | 'stop' | 'rebuild') => {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/spaces/${slug}/instance/${verb}`, { method: 'POST' })
      await load()
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h1 className="title">{space.name}</h1>
      <p className="body mono">{space.slug}</p>

      <h2>我的实例</h2>
      <p>
        状态：{instance ? STATUS_TEXT[instance.status] : '未创建'}
        {instance?.error ? <span role="alert">（{instance.error}）</span> : null}
      </p>
      <p>
        <button disabled={busy || instance?.status === 'running' || instance?.status === 'starting'}
          onClick={() => action('start')}>启动</button>{' '}
        <button disabled={busy || !instance || instance.status !== 'running'}
          onClick={() => action('stop')}>停止</button>{' '}
        <button disabled={busy || !instance} onClick={() => action('rebuild')}>重建</button>{' '}
        {instance?.status === 'running' && user ? (
          <a href={`/s/${space.slug}/${user.handle}/`}>打开</a>
        ) : null}
      </p>

      <h2>成员</h2>
      <table>
        <thead><tr><th>邮箱</th><th>标识</th><th>角色</th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>{m.email}</td>
              <td className="mono">{m.handle}</td>
              <td>{m.role === 'owner' ? '所有者' : '成员'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
