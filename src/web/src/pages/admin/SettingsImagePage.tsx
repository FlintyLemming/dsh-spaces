import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch, errorMessage } from '../../api'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  LoadingBlock,
} from '../../components/ui'
import { IconRefresh } from '../../components/icons'
import { PageBody, PageHeader } from '../../app/PageHeader'

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
const NUMBER_KEYS = [
  'default_quota_cpu',
  'default_quota_mem_mb',
  'default_quota_instances',
  'idle_stop_minutes',
] as const
type NumberKey = (typeof NUMBER_KEYS)[number]

export default function SettingsImagePage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [secret, setSecret] = useState('')
  const [image, setImage] = useState<ImageInfo | null>(null)
  const [digestInput, setDigestInput] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRebuild, setConfirmRebuild] = useState(false)

  async function load() {
    const [s, i] = await Promise.all([
      apiFetch<{ settings: Settings }>('/api/admin/settings'),
      apiFetch<ImageInfo>('/api/admin/image'),
    ])
    setSettings(s.settings)
    setImage(i)
  }
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e, '加载失败')))
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
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!settings) return
    // 服务端要求配额为正数、scope 非空，且所有字段都是可选的。全新安装时这些
    // 设置项还没写过，读回来是空串——把空值原样提交会让整个表单 400，所以留空
    // 的字段直接不提交，语义就是「沿用内置默认」。
    const body: Record<string, string | number> = {
      oidc_issuer: settings.oidc_issuer,
      oidc_client_id: settings.oidc_client_id,
      oidc_client_secret: secret, // 空串 = 保持不变
      password_login_enabled: settings.password_login_enabled || 'false',
    }
    if (settings.oidc_scope.trim() !== '') body.oidc_scope = settings.oidc_scope
    for (const key of NUMBER_KEYS) {
      const n = Number(settings[key])
      if (settings[key].trim() !== '' && Number.isFinite(n) && n > 0) body[key] = n
    }
    await run(async () => {
      await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) })
      setSecret('')
    }, '设置已保存')
  }

  async function rebuildAll() {
    setConfirmRebuild(false)
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const r = await apiFetch<{ ok: number; total: number }>('/api/admin/image/rebuild-all', {
        method: 'POST',
      })
      setMessage(`重建完成：${r.ok}/${r.total} 个实例成功`)
    } catch (e) {
      setError(errorMessage(e, '批量重建失败'))
    } finally {
      setBusy(false)
    }
  }

  if (error && !settings) {
    return (
      <>
        <PageHeader wide title="设置与镜像" />
        <PageBody wide>
          <Alert>{error}</Alert>
        </PageBody>
      </>
    )
  }
  if (!settings || !image) {
    return (
      <>
        <PageHeader wide title="设置与镜像" />
        <PageBody wide>
          <LoadingBlock />
        </PageBody>
      </>
    )
  }

  const textField = (key: TextKey | NumberKey, label: string, type = 'text') => (
    <Field label={label} htmlFor={`set-${key}`}>
      <Input
        id={`set-${key}`}
        type={type}
        value={settings[key]}
        placeholder={type === 'number' ? '沿用内置默认' : undefined}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
      />
    </Field>
  )

  return (
    <>
      <PageHeader wide title="设置与镜像" description="平台级配置：身份源、默认配额与 dsh 镜像。" />
      <PageBody wide className="space-y-5">
        {error ? <Alert>{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}

        <form onSubmit={save} className="space-y-5">
          <Card>
            <CardHeader title="OIDC" description="留空则平台仅接受密码登录。" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              {textField('oidc_issuer', 'Issuer URL（必须是 https）')}
              {textField('oidc_client_id', 'Client ID')}
              <Field label="Client Secret" htmlFor="set-secret">
                <Input
                  id="set-secret"
                  type="password"
                  value={secret}
                  autoComplete="new-password"
                  placeholder={
                    settings.oidc_client_secret_configured ? '已配置，留空保持不变' : '未配置'
                  }
                  onChange={(e) => setSecret(e.target.value)}
                />
              </Field>
              {textField('oidc_scope', 'Scope')}
              <label className="flex items-start gap-2.5 sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-1 size-3.5 accent-[var(--inverse-bg)]"
                  checked={settings.password_login_enabled === 'true'}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      password_login_enabled: e.target.checked ? 'true' : 'false',
                    })
                  }
                />
                <span className="text-base">
                  允许密码登录
                  <span className="block text-sm text-subtle">配置好 OIDC 后建议关闭。</span>
                </span>
              </label>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="平台默认配额" description="空间可单独覆盖这些值。" />
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {textField('default_quota_cpu', 'CPU（核）', 'number')}
              {textField('default_quota_mem_mb', '内存（MB）', 'number')}
              {textField('default_quota_instances', '实例数', 'number')}
              {textField('idle_stop_minutes', '空闲休眠（分钟）', 'number')}
            </CardBody>
            <CardFooter>
              <span>保存后立即生效，已运行的实例在下次重建时应用。</span>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? '保存中…' : '保存设置'}
              </Button>
            </CardFooter>
          </Card>
        </form>

        <Card>
          <CardHeader
            title="dsh 镜像"
            action={
              image.digest ? (
                <Badge tone="neutral">
                  <span className="font-mono">{image.digest.slice(0, 19)}</span>
                </Badge>
              ) : (
                <Badge tone="warning">未设置</Badge>
              )
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <Button
                icon={<IconRefresh />}
                disabled={busy}
                onClick={() =>
                  void run(() => apiFetch('/api/admin/image/build', { method: 'POST' }), '构建完成')
                }
              >
                触发重新构建
              </Button>
              <Button disabled={busy} onClick={() => setConfirmRebuild(true)}>
                批量重建实例
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Field label="切换到指定 digest" htmlFor="digest-input">
                <Input
                  id="digest-input"
                  className="w-full font-mono sm:w-120"
                  value={digestInput}
                  placeholder="sha256:…"
                  onChange={(e) => setDigestInput(e.target.value)}
                />
              </Field>
              <Button
                disabled={busy || digestInput === ''}
                onClick={() =>
                  void run(
                    () =>
                      apiFetch('/api/admin/image/digest', {
                        method: 'PUT',
                        body: JSON.stringify({ digest: digestInput }),
                      }),
                    'digest 已切换',
                  )
                }
              >
                切换
              </Button>
            </div>

            {image.lastBuild ? (
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-base text-muted">
                  上次构建：
                  <span className={image.lastBuild.ok ? 'text-success' : 'text-danger'}>
                    {image.lastBuild.ok ? '成功' : '失败'}
                  </span>
                  {' · '}
                  {new Date(image.lastBuild.at).toLocaleString()}
                  {image.lastBuild.digest ? (
                    <span className="font-mono"> · {image.lastBuild.digest.slice(0, 19)}</span>
                  ) : null}
                </summary>
                <pre className="max-h-60 overflow-auto border-t border-border px-3 py-2 font-mono text-sm whitespace-pre-wrap text-muted">
                  {image.lastBuild.log}
                </pre>
              </details>
            ) : null}
          </CardBody>
        </Card>
      </PageBody>

      {confirmRebuild ? (
        <ConfirmDialog
          title="按当前 digest 重建全部实例？"
          description="重建期间实例会短暂不可用，数据卷保留。"
          confirmLabel="开始重建"
          tone="primary"
          busy={busy}
          onClose={() => setConfirmRebuild(false)}
          onConfirm={() => void rebuildAll()}
        />
      ) : null}
    </>
  )
}
