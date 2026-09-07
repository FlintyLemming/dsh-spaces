import { useState, type FormEvent } from 'react'
import { apiFetch, errorMessage } from '../api'
import { Alert, Button, Field, Input, Modal } from './ui'

interface Props {
  onCreated: (slug: string) => void | Promise<void>
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
      await onCreated(space.slug)
    } catch (err) {
      setError(errorMessage(err, '创建失败'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="创建团队空间"
      description="空间标识会根据名称自动生成，创建后不可更改。"
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            type="submit"
            form="create-space"
            variant="primary"
            disabled={busy || !name.trim()}
          >
            {busy ? '创建中…' : '创建'}
          </Button>
        </>
      }
    >
      <form id="create-space" onSubmit={submit} className="space-y-4">
        <Field label="名称" htmlFor="space-name">
          <Input
            id="space-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
            autoFocus
            placeholder="例如：数据平台组"
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Modal>
  )
}
