import type { InputHTMLAttributes, ReactNode } from 'react'

export const inputClass =
  'h-8 w-full rounded-md border border-border bg-surface px-2.5 text-base text-fg ' +
  'placeholder:text-subtle transition-colors ' +
  'hover:border-border-strong focus:border-fg focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${inputClass} ${className}`} />
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm text-subtle">{hint}</p> : null}
    </div>
  )
}
