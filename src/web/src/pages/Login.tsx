import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, ApiRequestError } from '../api'

export default function Login() {
  const [params] = useSearchParams()
  const returnTo = params.get('return_to') ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const oidcHref = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await apiFetch('/api/auth/password-login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      window.location.assign(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/')
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message)
      else setError('网络错误，请稍后重试')
    }
  }

  return (
    <main className="page" style={{ maxWidth: '40ch' }}>
      <h1 className="title">登录 dsh-spaces</h1>
      <p className="body">使用组织账号登录，或在平台尚未配置 OIDC 时使用管理员密码。</p>
      <p>
        <a href={oidcHref}><button type="button">使用 OIDC 登录</button></a>
      </p>
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '24px 0' }} />
      <form onSubmit={submitPassword}>
        <p>
          <label>邮箱<br />
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              type="email" required autoComplete="username" />
          </label>
        </p>
        <p>
          <label>密码<br />
            <input value={password} onChange={(e) => setPassword(e.target.value)}
              type="password" required autoComplete="current-password" />
          </label>
        </p>
        {error && <p style={{ color: 'var(--error)' }} role="alert">{error}</p>}
        <button type="submit">密码登录</button>
      </form>
    </main>
  )
}
