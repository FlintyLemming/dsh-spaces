import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { IconMenu } from '../components/icons'
import { LogoMark } from '../components/icons'

export function AppShell() {
  const [drawer, setDrawer] = useState(false)
  const { pathname } = useLocation()

  // 抽屉不跨页面存活：路由一变就收起，否则移动端点完导航还盖着内容。
  useEffect(() => setDrawer(false), [pathname])

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-62 shrink-0 border-r border-border md:block">
        <Sidebar />
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/45"
            onClick={() => setDrawer(false)}
            aria-hidden="true"
          />
          <div className="dsh-fade-in absolute inset-y-0 left-0 w-70 border-r border-border shadow-2xl">
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
          <button
            type="button"
            aria-label="打开导航"
            onClick={() => setDrawer(true)}
            className="grid size-8 place-items-center rounded-md text-lg text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <IconMenu />
          </button>
          <span className="flex items-center gap-2 text-md font-semibold tracking-tight">
            <LogoMark />
            dsh-spaces
          </span>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
