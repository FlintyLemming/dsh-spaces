import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '../icons'

interface Props {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
}

export function Modal({ title, description, onClose, children, footer }: Props) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 焦点落到面板里的第一个输入控件，键盘用户不必先 Tab 穿过整页。
    panel.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className="dsh-fade-in w-full max-w-100 rounded-xl border border-border bg-surface shadow-2xl shadow-black/25"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-md font-semibold tracking-tight">{title}</h2>
            {description ? <p className="mt-1 text-base text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mt-0.5 -mr-1 rounded-md p-1 text-md text-subtle transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <IconClose />
          </button>
        </div>
        {children ? <div className="px-5 pb-4">{children}</div> : null}
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
