import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../../api'

interface Settings {
  oidc_issuer: string
  oidc_client_id: string
  oidc_scope: string
  password_login_enabled: string
  default_quota_cpu: string
  default_quota_mem_mb: string
  default_quota_instances: string
  idle_stop_minutes: string
  oidc_client_secret_configured: boolean
}

interface ImageInfo {
  digest: string
  lastBuild: { digest: string | null; at: number; ok: boolean; log: string } | null
}

type TextKey = 'oidc_issuer' | 'oidc_client_id' | 'oidc_scope'
type NumberKey = 'default_quota_cpu' | 'default_quota_mem_mb' | 'default_quota_instances'
  | 'idle_stop_minutes'

export default function SettingsImagePage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [secret, setSecret] = useState('')
  const [image, setImage] = useState<ImageInfo | null>(null)
  const [digestInput, setDigestInput] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const [s, i] = await Promise.all([
      apiFetch<{ settings: Settings }>('/api/admin/settings'),
      apiFetch<ImageInfo>('/api/admin/image'),
    ])
    setSettings(s.settings)
    setImage(i)
  }
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
  }, [])

  async function run(fn: () => Promise<unknown>, done: string) {
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

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!settings) return
    await run(async () => {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          oidc_issuer: settings.oidc_issuer,
          oidc_client_id: settings.oidc_client_id,
          oidc_client_secret: secret, // 空串 = 保持不变
          oidc_scope: settings.oidc_scope,
          password_login_enabled: settings.password_login_enabled,
          default_quota_cpu: Number(settings.default_quota_cpu),
          default_quota_mem_mb: Number(settings.default_quota_mem_mb),
          default_quota_instances: Number(settings.default_quota_instances),
          idle_stop_minutes: Number(settings.idle_stop_minutes),
        }),
      })
      setSecret('')
    }, '设置已保存')
  }

  async function rebuildAll() {
    if (!confirm('按当前 digest 重建全部实例？重建期间实例会短暂不可用。')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const r = await apiFetch<{ ok: number; total: number }>(
        '/api/admin/image/rebuild-all', { method: 'POST' })
      setMessage(`重建完成：${r.ok}/${r.total} 个实例成功`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量重建失败')
    } finally {
      setBusy(false)
    }
  }

  if (error && !settings) return <p className="error-text" role="alert">加载失败：{error}</p>
  if (!settings || !image) return <p className="body">加载中…</p>

  const field = (key: TextKey | NumberKey, label: string, type = 'text') => (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={settings[key]}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.value })} />
    </label>
  )

  return (
    <section>
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      <form onSubmit={save}>
        <h3>OIDC</h3>
        {field('oidc_issuer', 'Issuer URL（必须是 https）')}
        {field('oidc_client_id', 'Client ID')}
        <label className="field">
          <span>Client Secret</span>
          <input type="password" value={secret} autoComplete="new-password"
            placeholder={settings.oidc_client_secret_configured ? '已配置，留空保持不变' : '未配置'}
            onChange={(e) => setSecret(e.target.value)} />
        </label>
        {field('oidc_scope', 'Scope')}
        <label className="row-actions">
          <input type="checkbox" checked={settings.password_login_enabled === 'true'}
            onChange={(e) => setSettings({
              ...settings,
              password_login_enabled: e.target.checked ? 'true' : 'false',
            })} />
          <span>允许密码登录（配置好 OIDC 后建议关闭）</span>
        </label>

        <h3>平台默认配额</h3>
        {field('default_quota_cpu', 'CPU（核）', 'number')}
        {field('default_quota_mem_mb', '内存（MB）', 'number')}
        {field('default_quota_instances', '实例数', 'number')}
        {field('idle_stop_minutes', '空闲休眠阈值（分钟）', 'number')}
        <button type="submit" disabled={busy}>保存设置</button>
      </form>

      <h3>dsh 镜像</h3>
      <p>当前 digest：<span className="mono">{image.digest || '未设置'}</span></p>
      <div className="image-actions">
        <button disabled={busy}
          onClick={() => void run(
            () => apiFetch('/api/admin/image/build', { method: 'POST' }), '构建完成')}>
          触发重新构建
        </button>
        <input className="mono" value={digestInput} placeholder="sha256:…"
          onChange={(e) => setDigestInput(e.target.value)} />
        <button disabled={busy || digestInput === ''}
          onClick={() => void run(() => apiFetch('/api/admin/image/digest', {
            method: 'PUT', body: JSON.stringify({ digest: digestInput }),
          }), 'digest 已切换')}>
          切换 digest
        </button>
        <button disabled={busy} onClick={() => void rebuildAll()}>批量重建实例</button>
      </div>
      {image.lastBuild && (
        <details>
          <summary>
            上次构建：{image.lastBuild.ok ? '成功' : '失败'}
            {' · '}{new Date(image.lastBuild.at).toLocaleString()}
            {image.lastBuild.digest ? <> · <span className="mono">{image.lastBuild.digest}</span></> : null}
          </summary>
          <pre className="mono build-log">{image.lastBuild.log}</pre>
        </details>
      )}
    </section>
  )
}
