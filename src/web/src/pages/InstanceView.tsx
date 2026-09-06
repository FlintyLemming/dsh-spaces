import { useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { useMe } from '../components/RequireAuth'

interface Instance {
  id: number
  status: 'stopped' | 'starting' | 'running' | 'error'
  error: string | null
  imageDigest: string | null
}

const STATUS_TEXT: Record<string, string> = {
  stopped: '已停止', starting: '启动中', running: '运行中', error: '异常',
}

export default function InstanceView() {
  const { slug } = useParams<{ slug: string }>()
  const { user, loading } = useMe()
  const [inst, setInst] = useState<Instance | null>(null)

  useEffect(() => {
    if (!slug) return
    let stop = false
    const poll = async () => {
      try {
        const data = await apiFetch<{ instance: Instance | null }>(`/api/spaces/${slug}/instance`)
        if (!stop) setInst(data.instance)
      } catch { /* 状态行静默失败，iframe 本身是主证据 */ }
    }
    poll()
    const t = setInterval(poll, 5000)
    return () => { stop = true; clearInterval(t) }
  }, [slug])

  if (loading || !user) return <main className="page"><p className="body">加载中…</p></main>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{
        display: 'flex', alignItems: 'baseline', gap: 16,
        padding: '8px 16px', borderBottom: '1px solid var(--border)',
      }}>
        <Link to={`/spaces/${slug}`}>← {slug}</Link>
        <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
          /s/{slug}/{user.handle}/
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          {inst ? `实例 ${STATUS_TEXT[inst.status] ?? inst.status}` : ''}
        </span>
      </header>
      <iframe
        title="dsh instance"
        src={`/s/${slug}/${user.handle}/`}
        style={{ flex: 1, border: 0, width: '100%' }}
      />
    </div>
  )
}
