import type { ReactNode } from 'react'

export function Card({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`rounded-lg border border-border bg-surface ${className}`}>{children}</div>
  )
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-md font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-base text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function CardBody({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <div className={`px-5 pb-5 ${className}`}>{children}</div>
}

export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg-subtle px-5 py-3 text-base text-muted">
      {children}
    </div>
  )
}
