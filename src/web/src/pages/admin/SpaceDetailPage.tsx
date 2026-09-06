import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { apiFetch } from '../../api'

interface Detail {
  space: {
    id: number; slug: string; name: string; kind: 'personal' | 'team'
    quota_cpu: number | null; quota_mem_mb: number | null; quota_instances: number | null
  }
  members: { user_id: number; email: string; handle: string; role: string; status: string }[]
  instances: {
    id: number; user_id: number; handle: string; container_name: string
    status: string; last_active_at: number | null
  }[]
  volumes: { id: number; kind: 'shared' | 'private'; docker_name: string }[]
}

const STATUS_TEXT: Record<string, string> = {
  stopped: '已停止', starting: '启动中', running: '运行中', error: '异常',
}

export default function SpaceDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [quota, setQuota] = useState({ quotaCpu: '', quotaMemMb: '', quotaInstances: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const d = await apiFetch<Detail>(`/api/admin/spaces/${slug}`)
    setDetail(d)
    setQuota({
      quotaCpu: d.space.quota_cpu?.toString() ?? '',
      quotaMemMb: d.space.quota_mem_mb?.toString() ?? '',
      quotaInstances: d.space.quota_instances?.toString() ?? '',
    })
  }
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
  }, [slug])

  async function run(fn: () => Promise<unknown>, done = '') {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await fn()
      await load()
      setMessage(done)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  async function saveQuota(e: FormEvent) {
    e.preventDefault()
    await run(() => apiFetch(`/api/admin/spaces/${slug}/quota`, {
      method: 'PUT',
      body: JSON.stringify({
        quotaCpu: quota.quotaCpu === '' ? null : Number(quota.quotaCpu),
        quotaMemMb: quota.quotaMemMb === '' ? null : Number(quota.quotaMemMb),
        quotaInstances: quota.quotaInstances === '' ? null : Number(quota.quotaInstances),
      }),
    }), '配额已保存')
  }

  async function deleteSpace() {
    if (!confirm(`删除空间 ${slug}？全部实例与卷将被销毁，且不可恢复。`)) return
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/admin/spaces/${slug}`, { method: 'DELETE' })
      navigate('/admin/spaces')
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
      setBusy(false)
    }
  }

  if (error && !detail) return <p className="error-text" role="alert">加载失败：{error}</p>
  if (!detail) return <p className="body">加载中…</p>
  const { space, members, instances, volumes } = detail

  return (
    <section>
      <p className="body"><Link to="/admin/spaces">← 返回空间列表</Link></p>
      <h2 className="heading">{space.name} <span className="mono">{space.slug}</span></h2>
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      <h3>成员</h3>
      <table>
        <thead><tr><th>邮箱</th><th>用户名</th><th>角色</th><th>状态</th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.user_id}>
              <td>{m.email}</td>
              <td className="mono">{m.handle}</td>
              <td>{m.role === 'owner' ? '所有者' : '成员'}</td>
              <td>{m.status === 'active' ? '正常' : '已禁用'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>实例</h3>
      <table>
        <thead><tr><th>成员</th><th>容器</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {instances.map((i) => (
            <tr key={i.id}>
              <td className="mono">{i.handle}</td>
              <td className="mono">{i.container_name}</td>
              <td>{STATUS_TEXT[i.status] ?? i.status}</td>
              <td>
                <span className="row-actions">
                  <button disabled={busy || i.status !== 'running'}
                    onClick={() => void run(() => apiFetch(
                      `/api/admin/spaces/${slug}/instances/${i.user_id}/stop`, { method: 'POST' }),
                      '实例已停止')}>停止</button>
                  <button disabled={busy}
                    onClick={() => {
                      if (!confirm(`删除 ${i.container_name}？卷数据保留。`)) return
                      void run(() => apiFetch(
                        `/api/admin/spaces/${slug}/instances/${i.user_id}`, { method: 'DELETE' }),
                        '实例已删除')
                    }}>删除</button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {instances.length === 0 && <p className="body">该空间还没有实例。</p>}

      <h3>配额覆盖</h3>
      <p className="body">留空表示沿用平台默认配额。</p>
      <form className="quota-form" onSubmit={saveQuota}>
        <label className="field">
          <span>CPU（核）</span>
          <input value={quota.quotaCpu} inputMode="decimal"
            onChange={(e) => setQuota({ ...quota, quotaCpu: e.target.value })} />
        </label>
        <label className="field">
          <span>内存（MB）</span>
          <input value={quota.quotaMemMb} inputMode="numeric"
            onChange={(e) => setQuota({ ...quota, quotaMemMb: e.target.value })} />
        </label>
        <label className="field">
          <span>实例数</span>
          <input value={quota.quotaInstances} inputMode="numeric"
            onChange={(e) => setQuota({ ...quota, quotaInstances: e.target.value })} />
        </label>
        <button type="submit" disabled={busy}>保存配额</button>
      </form>

      <h3>卷</h3>
      <table>
        <thead><tr><th>类型</th><th>Docker 卷名</th></tr></thead>
        <tbody>
          {volumes.map((v) => (
            <tr key={v.id}>
              <td>{v.kind === 'shared' ? '共享' : '私有'}</td>
              <td className="mono">{v.docker_name}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {space.kind === 'team' && (
        <>
          <h3>删除空间</h3>
          <p className="body">删除后该空间的全部实例与卷都会被销毁，操作不可撤销。</p>
          <button disabled={busy} onClick={() => void deleteSpace()}>删除空间</button>
        </>
      )}
    </section>
  )
}
