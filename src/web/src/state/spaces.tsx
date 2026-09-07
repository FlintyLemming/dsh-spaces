import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch, errorMessage, type SpaceSummary } from '../api'

interface SpacesValue {
  spaces: SpaceSummary[] | null
  error: string
  refresh: () => Promise<void>
}

const SpacesContext = createContext<SpacesValue | null>(null)

/**
 * 侧边栏和总览页共用同一份空间列表：创建/删除/实例状态变化后调 refresh()，
 * 两处一起更新，不需要各自轮询。
 */
export function SpacesProvider({ children }: { children: ReactNode }) {
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch<{ spaces: SpaceSummary[] }>('/api/spaces')
      setSpaces(r.spaces)
      setError('')
    } catch (err) {
      setError(errorMessage(err, '加载空间列表失败'))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo(() => ({ spaces, error, refresh }), [spaces, error, refresh])
  return <SpacesContext.Provider value={value}>{children}</SpacesContext.Provider>
}

export function useSpaces(): SpacesValue {
  const ctx = useContext(SpacesContext)
  if (!ctx) throw new Error('useSpaces 必须在 SpacesProvider 内使用')
  return ctx
}
