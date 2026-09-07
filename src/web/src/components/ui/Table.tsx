import type { ReactNode } from 'react'

/** 表格统一外观：外层卡片负责圆角与裁切，横向溢出在卡片内滚动。 */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse text-base">{children}</table>
}

export function Th({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <th
      scope="col"
      className={`border-b border-border bg-bg-subtle px-4 py-2.5 text-sm font-medium whitespace-nowrap text-muted ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <td
      className={`border-b border-border px-4 py-2.5 align-middle ${align === 'right' ? 'text-right tabular-nums' : ''} ${className}`}
    >
      {children}
    </td>
  )
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="transition-colors last:[&>td]:border-b-0 hover:bg-surface-hover">{children}</tr>
}
