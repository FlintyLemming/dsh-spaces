import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, statusText, type Instance } from '../api'
import { StatusDot } from '../components/ui'
import { IconArrowLeft, IconExternal, IconRefresh } from '../components/icons'
import { useAuth } from '../state/auth'

export default function InstanceView() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { user, loading } = useAuth()
  const [inst, setInst] = useState<Instance | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!slug) return
    let stop = false
    const poll = async () => {
      try {
        const data = await apiFetch<{ instance: Instance | null }>(
          `/api/spaces/${slug}/instance`,
        )
        if (!stop) setInst(data.instance)
      } catch {
        /* 状态行静默失败，iframe 本身是主证据 */
      }
    }
    void poll()
    const t = setInterval(poll, 5000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [slug])

  if (loading || !user) return null
  const src = `/s/${slug}/${user.handle}/`

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-bg-subtle px-3">
        <Link
          to={`/spaces/${slug}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-base text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <IconArrowLeft className="text-md" />
          <span className="max-w-40 truncate">{slug}</span>
        </Link>

        <span className="h-4 w-px bg-border" />

        <span className="flex min-w-0 items-center gap-2 text-sm text-subtle">
          <StatusDot status={inst?.status} />
          <span className="shrink-0">{statusText(inst?.status)}</span>
          <span className="hidden truncate font-mono sm:inline">{src}</span>
        </span>

        <span className="flex-1" />

        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          title="重新加载"
          aria-label="重新加载"
          className="grid size-7 place-items-center rounded-md text-md text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <IconRefresh />
        </button>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          title="在新标签页打开"
          aria-label="在新标签页打开"
          className="grid size-7 place-items-center rounded-md text-md text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <IconExternal />
        </a>
      </header>

      <iframe
        key={reloadKey}
        title="dsh instance"
        src={src}
        className="min-h-0 w-full flex-1 border-0"
      />
    </div>
  )
}
