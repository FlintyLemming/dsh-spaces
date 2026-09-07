import { useState } from 'react'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../components/ui'
import {
  IconChevronDown,
  IconLogout,
  IconMonitor,
  IconMoon,
  IconSun,
} from '../components/icons'
import { useAuth } from '../state/auth'
import { applyTheme, readTheme, type Theme } from '../theme'

const THEMES: { key: Theme; label: string; icon: React.ReactNode }[] = [
  { key: 'system', label: '跟随系统', icon: <IconMonitor /> },
  { key: 'light', label: '亮色', icon: <IconSun /> },
  { key: 'dark', label: '暗色', icon: <IconMoon /> },
]

export function UserMenu() {
  const { user, logout } = useAuth()
  const [theme, setTheme] = useState<Theme>(readTheme)
  if (!user) return null

  const initial = (user.displayName || user.email).trim().charAt(0).toUpperCase()

  return (
    <Menu
      side="top"
      label="账号菜单"
      className="w-full"
      trigger={(open) => (
        <div
          className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors ${
            open ? 'bg-surface-active' : 'hover:bg-surface-hover'
          }`}
        >
          <span className="grid size-6.5 shrink-0 place-items-center rounded-full bg-inverse text-sm font-semibold text-inverse-fg">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-medium">{user.displayName}</span>
            <span className="block truncate text-sm text-subtle">{user.email}</span>
          </span>
          <IconChevronDown className="shrink-0 text-md text-subtle" />
        </div>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>主题</MenuLabel>
          {THEMES.map((t) => (
            <MenuItem
              key={t.key}
              icon={t.icon}
              active={theme === t.key}
              onClick={() => {
                applyTheme(t.key)
                setTheme(t.key)
              }}
            >
              {t.label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            icon={<IconLogout />}
            tone="danger"
            onClick={() => {
              close()
              void logout()
            }}
          >
            退出登录
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
