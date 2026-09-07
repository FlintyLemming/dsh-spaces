import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

const container = 'mx-auto w-full px-5 sm:px-8'

export interface Tab {
  to: string
  label: string
  end?: boolean
}

/**
 * 页面顶部：标题行 + 可选标签页。分隔线通铺整个主区宽度，
 * 内容跟随正文一起在中间列内对齐。
 */
export function PageHeader({
  title,
  meta,
  description,
  actions,
  tabs,
  wide = false,
}: {
  title: ReactNode
  meta?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  tabs?: Tab[]
  wide?: boolean
}) {
  const max = wide ? 'max-w-6xl' : 'max-w-5xl'
  return (
    <header className="border-b border-border bg-bg">
      <div className={`${container} ${max} pt-7 ${tabs ? '' : 'pb-6'}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              {meta}
            </div>
            {description ? (
              <p className="mt-1.5 max-w-160 text-base text-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>

        {tabs ? (
          <nav className="mt-5 -mb-px flex gap-5 overflow-x-auto">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `border-b-2 pb-2.5 text-base whitespace-nowrap transition-colors ${
                    isActive
                      ? 'border-fg font-medium text-fg'
                      : 'border-transparent text-muted hover:border-border-strong hover:text-fg'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </div>
    </header>
  )
}

export function PageBody({
  children,
  wide = false,
  className = '',
}: {
  children: ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <div className={`${container} ${wide ? 'max-w-6xl' : 'max-w-5xl'} py-7 ${className}`}>
      {children}
    </div>
  )
}
