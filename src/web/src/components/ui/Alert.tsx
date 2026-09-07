import type { ReactNode } from 'react'
import { IconAlert, IconCheck } from '../icons'

const TONES = {
  error: {
    box: 'border-danger/35 bg-danger-subtle text-danger',
    icon: <IconAlert />,
  },
  success: {
    box: 'border-success/35 bg-success-subtle text-success',
    icon: <IconCheck />,
  },
  warning: {
    box: 'border-warning/35 bg-warning-subtle text-warning',
    icon: <IconAlert />,
  },
} as const

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: keyof typeof TONES
  children: ReactNode
}) {
  const t = TONES[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-base ${t.box}`}
    >
      <span className="mt-0.5 shrink-0 text-md leading-none">{t.icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}
