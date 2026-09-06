import { useState, type FormEvent } from 'react'
import { apiFetch } from '../api'

interface Props {
  onCreated: (slug: string) => void
  onClose: () => void
}

export function CreateSpaceDialog({ onCreated, onClose }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { space } = await apiFetch<{ space: { slug: string } }>('/api/spaces', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      onCreated(space.slug)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
      setBusy(false)
    }
  }

  return (
    <form className="dialog" onSubmit={submit}>
      <h2 className="heading">创建团队空间</h2>
      <label className="field">
        <span>名称</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          required
          autoFocus
        />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={onClose} disabled={busy}>取消</button>
        <button type="submit" disabled={busy || !name.trim()}>创建</button>
      </div>
    </form>
  )
}
