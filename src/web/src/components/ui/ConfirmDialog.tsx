import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认',
  tone = 'danger',
  busy = false,
  onConfirm,
  onClose,
}: {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy}>
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </>
      }
    />
  )
}
