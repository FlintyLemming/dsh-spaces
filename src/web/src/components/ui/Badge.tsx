import type { InstanceStatus } from '../../api'
import { statusText } from '../../api'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-hover text-muted border-border',
  success: 'bg-success-subtle text-success border-transparent',
  warning: 'bg-warning-subtle text-warning border-transparent',
  danger: 'bg-danger-subtle text-danger border-transparent',
  accent: 'bg-accent-subtle text-accent border-transparent',
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: Tone
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex h-5.5 items-center rounded-full border px-2 text-sm font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

const DOT_TONE: Record<string, string> = {
  running: 'bg-success',
  starting: 'bg-warning dsh-pulse',
  error: 'bg-danger',
  stopped: 'bg-subtle',
  none: 'bg-border-strong',
}

export function StatusDot({
  status,
  className = '',
}: {
  status: InstanceStatus | null | undefined
  className?: string
}) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${DOT_TONE[status ?? 'none']} ${className}`}
    />
  )
}

const STATUS_TONE: Record<string, Tone> = {
  running: 'success',
  starting: 'warning',
  error: 'danger',
  stopped: 'neutral',
  none: 'neutral',
}

export function StatusBadge({ status }: { status: InstanceStatus | null | undefined }) {
  return (
    <Badge tone={STATUS_TONE[status ?? 'none']}>
      <StatusDot status={status} className="mr-1.5" />
      {statusText(status)}
    </Badge>
  )
}
