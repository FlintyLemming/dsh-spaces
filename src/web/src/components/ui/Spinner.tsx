export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      aria-hidden="true"
      className={`dsh-spin ${className}`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LoadingBlock({ label = '加载中' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-base text-muted" role="status">
      <Spinner className="text-md" />
      {label}…
    </div>
  )
}
