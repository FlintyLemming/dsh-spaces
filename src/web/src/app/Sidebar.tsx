import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { StatusDot } from '../components/ui'
import {
  IconActivity,
  IconArrowLeft,
  IconGrid,
  IconPlus,
  IconSettings,
  IconSliders,
  IconUser,
  IconUsers,
  LogoMark,
} from '../components/icons'
import { CreateSpaceDialog } from '../components/CreateSpaceDialog'
import { useAuth } from '../state/auth'
import { useSpaces } from '../state/spaces'
import { UserMenu } from './UserMenu'
import type { SpaceSummary } from '../api'

const itemBase =
  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-base transition-colors duration-100'
const itemIdle = 'text-muted hover:bg-surface-hover hover:text-fg'
const itemActive = 'bg-surface-active font-medium text-fg'

function GroupLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-4 pb-1">
      <span className="text-sm font-medium tracking-wide text-subtle">{children}</span>
      {action}
    </div>
  )
}

function SpaceItem({ space, onNavigate }: { space: SpaceSummary; onNavigate: () => void }) {
  return (
    <NavLink
      to={`/spaces/${space.slug}`}
      onClick={onNavigate}
      title={`${space.name} · ${space.slug}`}
      className={({ isActive }) => `${itemBase} ${isActive ? itemActive : itemIdle}`}
    >
      <StatusDot status={space.instanceStatus} />
      <span className="min-w-0 flex-1 truncate">{space.name}</span>
    </NavLink>
  )
}

const ADMIN_NAV = [
  { to: '/admin/users', label: '用户', icon: <IconUser /> },
  { to: '/admin/spaces', label: '空间', icon: <IconGrid /> },
  { to: '/admin/settings', label: '设置与镜像', icon: <IconSliders /> },
  { to: '/admin/usage', label: '用量与审计', icon: <IconActivity /> },
]

function AdminNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <>
      <Link
        to="/spaces"
        onClick={onNavigate}
        className={`${itemBase} ${itemIdle}`}
      >
        <IconArrowLeft className="shrink-0 text-md" />
        返回空间
      </Link>
      <GroupLabel>管理后台</GroupLabel>
      {ADMIN_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) => `${itemBase} ${isActive ? itemActive : itemIdle}`}
        >
          <span className="shrink-0 text-md">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </>
  )
}

function SpacesNav({ onNavigate }: { onNavigate: () => void }) {
  const { spaces, error, refresh } = useSpaces()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const personal = spaces?.filter((s) => s.kind === 'personal') ?? []
  const team = spaces?.filter((s) => s.kind === 'team') ?? []

  return (
    <>
      <NavLink
        to="/spaces"
        end
        onClick={onNavigate}
        className={({ isActive }) => `${itemBase} ${isActive ? itemActive : itemIdle}`}
      >
        <IconGrid className="shrink-0 text-md" />
        全部空间
      </NavLink>

      {error ? <p className="px-2 py-3 text-sm text-danger">{error}</p> : null}
      {spaces === null && !error ? (
        <div className="space-y-1.5 px-2 pt-5">
          <div className="h-3 w-2/3 rounded bg-surface-hover" />
          <div className="h-3 w-1/2 rounded bg-surface-hover" />
        </div>
      ) : null}

      {personal.length ? (
        <>
          <GroupLabel>个人</GroupLabel>
          {personal.map((s) => (
            <SpaceItem key={s.id} space={s} onNavigate={onNavigate} />
          ))}
        </>
      ) : null}

      {spaces !== null ? (
        <>
          <GroupLabel
            action={
              <button
                type="button"
                aria-label="创建团队空间"
                title="创建团队空间"
                onClick={() => setCreating(true)}
                className="grid size-5 place-items-center rounded text-md text-subtle transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <IconPlus />
              </button>
            }
          >
            团队
          </GroupLabel>
          {team.length ? (
            team.map((s) => <SpaceItem key={s.id} space={s} onNavigate={onNavigate} />)
          ) : (
            <p className="px-2 py-1 text-sm text-subtle">还没有团队空间</p>
          )}
        </>
      ) : null}

      {creating ? (
        <CreateSpaceDialog
          onClose={() => setCreating(false)}
          onCreated={async (slug) => {
            setCreating(false)
            await refresh()
            onNavigate()
            navigate(`/spaces/${slug}`)
          }}
        />
      ) : null}
    </>
  )
}

export function Sidebar({ onNavigate = () => {} }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const inAdmin = pathname.startsWith('/admin')

  return (
    <div className="flex h-full flex-col bg-bg-subtle">
      <Link
        to="/spaces"
        onClick={onNavigate}
        className="flex h-14 shrink-0 items-center gap-2 px-4 text-md font-semibold tracking-tight"
      >
        <LogoMark className="text-lg" />
        dsh-spaces
      </Link>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {inAdmin ? <AdminNav onNavigate={onNavigate} /> : <SpacesNav onNavigate={onNavigate} />}
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        {user?.role === 'admin' && !inAdmin ? (
          <Link to="/admin/users" onClick={onNavigate} className={`${itemBase} ${itemIdle} mb-1`}>
            <IconSettings className="shrink-0 text-md" />
            管理后台
          </Link>
        ) : null}
        <UserMenu />
      </div>
    </div>
  )
}
