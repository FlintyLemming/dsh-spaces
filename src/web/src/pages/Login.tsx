import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, errorMessage } from '../api'
import { Alert, Button, Field, Input } from '../components/ui'
import { LogoMark } from '../components/icons'

export default function Login() {
  const [params] = useSearchParams()
  const returnTo = params.get('return_to') ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const oidcHref = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await apiFetch('/api/auth/password-login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      window.location.assign(
        returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/',
      )
    } catch (err) {
      setError(errorMessage(err, '网络错误，请稍后重试'))
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-88">
        <div className="mb-7 flex flex-col items-center text-center">
          <LogoMark className="text-2xl" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">登录 dsh-spaces</h1>
          <p className="mt-1.5 text-base text-muted">
            使用组织账号登录，或在平台尚未配置 OIDC 时使用管理员密码。
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6">
          <a href={oidcHref} className="block">
            <Button variant="primary" className="h-9! w-full text-md!">
              使用 OIDC 登录
            </Button>
          </a>

          {showPassword ? (
            <form onSubmit={submitPassword} className="mt-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-sm text-subtle">或使用密码</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Field label="邮箱" htmlFor="login-email">
                <Input
                  id="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                />
              </Field>
              <Field label="密码" htmlFor="login-password">
                <Input
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </Field>
              {error ? <Alert>{error}</Alert> : null}
              <Button type="submit" variant="secondary" disabled={busy} className="w-full">
                {busy ? '登录中…' : '密码登录'}
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowPassword(true)}
              className="mt-4 block w-full text-center text-base text-muted transition-colors hover:text-fg"
            >
              使用密码登录
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
