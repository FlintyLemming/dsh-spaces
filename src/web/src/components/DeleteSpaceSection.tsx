import { useState } from 'react'
import { apiFetch } from '../api'

interface Props {
  slug: string
  kind: string
  isOwnerOrAdmin: boolean
  onDeleted: () => void
}

export function DeleteSpaceSection({ slug, kind, isOwnerOrAdmin, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (kind !== 'team' || !isOwnerOrAdmin) return null

  async function doDelete() {
    setError('')
    setBusy(true)
    try {
      await apiFetch(`/api/spaces/${slug}`, { method: 'DELETE' })
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>危险操作</h2>
      <p className="body">删除空间将销毁全部成员实例与共享文件，不可恢复。</p>
      {!confirming ? (
        <button onClick={() => setConfirming(true)}>删除空间</button>
      ) : (
        <div className="row-actions">
          <button disabled={busy} onClick={doDelete}>确认删除 {slug}</button>
          <button disabled={busy} onClick={() => setConfirming(false)}>取消</button>
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  )
}
