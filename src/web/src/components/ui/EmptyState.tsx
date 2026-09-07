import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-2xl text-subtle">{icon}</div> : null}
      <p className="text-md font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-80 text-base text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
