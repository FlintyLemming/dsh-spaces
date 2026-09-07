import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-inverse text-inverse-fg border border-transparent hover:opacity-88 active:opacity-80',
  secondary:
    'bg-surface text-fg border border-border hover:bg-surface-hover hover:border-border-strong',
  danger: 'bg-danger text-danger-fg border border-transparent hover:opacity-88',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-surface-hover hover:text-fg',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-sm gap-1.5 rounded-md',
  md: 'h-8 px-3 text-base gap-2 rounded-md',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,opacity] duration-100 disabled:pointer-events-none disabled:opacity-45 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {icon ? <span className="text-[1.15em] leading-none">{icon}</span> : null}
      {children}
    </button>
  )
}
