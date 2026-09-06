import { useEffect, useState } from 'react'
import { apiFetch } from '../../api'

interface Usage {
  running: number
  cpuPercent: number
  memoryMb: number
  diskBytes: number
  spaces: { slug: string; running: number; memoryMb: number; volumeBytes: number }[]
}

interface AuditEntry {
  id: number
  actor_id: number | null
  actor_email: string | null
  action: string
  target_type: string
  target_id: string | null
  detail_json: string | null
  created_at: number
}

function bytes(v: number) {
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`
  return `${(v / 1024 ** 2).toFixed(1)} MB`
}

export default function UsageAuditPage() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [action, setAction] = useState('')
  const [error, setError] = useState('')

  async function loadAudit(act: string) {
    const q = act ? `?action=${encodeURIComponent(act)}` : ''
    try {
      const d = await apiFetch<{ entries: AuditEntry[] }>(`/api/admin/audit${q}`)
      setEntries(d.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : '审计日志加载失败')
    }
  }
  useEffect(() => {
    apiFetch<Usage>('/api/admin/usage')
      .then(setUsage)
      .catch((e) => setError(e instanceof Error ? e.message : '用量加载失败'))
    void loadAudit('')
  }, [])

  return (
    <section>
      {error && <p className="error-text" role="alert">{error}</p>}

      <h3>用量</h3>
      {!usage ? <p className="body">加载中…</p> : (
        <>
          <p className="admin-summary">
            运行中实例 {usage.running} · CPU {usage.cpuPercent}% ·
            {' '}内存 {usage.memoryMb} MB · 卷占用 {bytes(usage.diskBytes)}
          </p>
          <table>
            <thead>
              <tr>
                <th>空间</th><th className="num">运行中实例</th>
                <th className="num">内存 (MB)</th><th className="num">卷占用</th>
              </tr>
            </thead>
            <tbody>
              {usage.spaces.map((s) => (
                <tr key={s.slug}>
                  <td className="mono">{s.slug}</td>
                  <td className="num">{s.running}</td>
                  <td className="num">{s.memoryMb}</td>
                  <td className="num">{bytes(s.volumeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.spaces.length === 0 && <p className="body">当前没有任何实例或卷。</p>}
        </>
      )}

      <h3>审计日志</h3>
      <input className="admin-filter" value={action}
        placeholder="按动作过滤，如 admin.settings_update"
        onChange={(e) => { setAction(e.target.value); void loadAudit(e.target.value) }} />
      {!entries ? <p className="body">加载中…</p> : (
        <>
          <table>
            <thead>
              <tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>详情</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="num">{new Date(e.created_at).toLocaleString()}</td>
                  <td>{e.actor_email ?? '系统'}</td>
                  <td className="mono">{e.action}</td>
                  <td className="mono">{e.target_type}{e.target_id ? `:${e.target_id}` : ''}</td>
                  <td className="mono">{e.detail_json ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="body">没有匹配的审计记录。</p>}
        </>
      )}
    </section>
  )
}
