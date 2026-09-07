import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** 触发器渲染函数，收到当前展开状态用于旋转箭头之类的表达。 */
  trigger: (open: boolean) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  side?: 'top' | 'bottom'
  className?: string
  label?: string
}

export function Menu({
  trigger,
  children,
  align = 'left',
  side = 'bottom',
  className = '',
  label,
}: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="block w-full text-left"
      >
        {trigger(open)}
      </button>
      {open ? (
        <div
          role="menu"
          className={`dsh-fade-in absolute z-40 min-w-56 rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/15 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({
  icon,
  onClick,
  children,
  active,
  tone = 'default',
}: {
  icon?: ReactNode
  onClick?: () => void
  children: ReactNode
  active?: boolean
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-base transition-colors hover:bg-surface-hover ${
        tone === 'danger' ? 'text-danger' : active ? 'text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      {icon ? <span className="shrink-0 text-md leading-none">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active ? <span className="text-sm text-subtle">✓</span> : null}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 py-1.5 text-sm text-subtle">{children}</div>
}
