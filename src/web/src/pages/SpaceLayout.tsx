import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { apiFetch, errorMessage, type SpaceDetail } from '../api'
import { Alert, Badge, Button, LoadingBlock } from '../components/ui'
import { IconExternal } from '../components/icons'
import { PageBody, PageHeader, type Tab } from '../app/PageHeader'
import { useAuth } from '../state/auth'
import { useSpaces } from '../state/spaces'

export interface SpaceContext {
  detail: SpaceDetail
  reload: () => Promise<void>
  isOwner: boolean
  canManage: boolean
}

export function useSpaceContext(): SpaceContext {
  return useOutletContext<SpaceContext>()
}

export default function SpaceLayout() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const { refresh: refreshSpaces } = useSpaces()
  const [detail, setDetail] = useState<SpaceDetail | null>(null)
  const [error, setError] = useState('')
  const lastStatus = useRef<string | null>(null)

  const load = useCallback(async () => {
    const d = await apiFetch<SpaceDetail>(`/api/spaces/${slug}`)
    setDetail(d)
    // 实例状态一变，侧边栏的状态点也得跟着变，否则两处会说不同的话。
    const status = d.instance?.status ?? null
    if (lastStatus.current !== null && lastStatus.current !== status) void refreshSpaces()
    lastStatus.current = status
  }, [slug, refreshSpaces])

  useEffect(() => {
    setDetail(null)
    setError('')
    lastStatus.current = null
    load().catch((e) => setError(errorMessage(e, '加载失败')))
  }, [load])

  // starting 期间每 3 秒轮询，直到落到终态。
  useEffect(() => {
    if (detail?.instance?.status !== 'starting') return
    const t = setInterval(() => {
      load().catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [detail?.instance?.status, load])

  if (error) {
    return (
      <>
        <PageHeader title={slug} />
        <PageBody className="space-y-4">
          <Alert>{error}</Alert>
          <Link to="/spaces">
            <Button>返回空间列表</Button>
          </Link>
        </PageBody>
      </>
    )
  }
  if (!detail) {
    return (
      <>
        <PageHeader title={slug} />
        <PageBody>
          <LoadingBlock />
        </PageBody>
      </>
    )
  }

  const { space, members, instance } = detail
  const isOwner = members.some((m) => m.userId === user?.id && m.role === 'owner')
  const canManage = isOwner || user?.role === 'admin'
  const isTeam = space.kind === 'team'

  const tabs: Tab[] = [{ to: `/spaces/${slug}`, label: '概览', end: true }]
  if (isTeam) {
    tabs.push({ to: `/spaces/${slug}/members`, label: `成员 · ${members.length}` })
    if (canManage) tabs.push({ to: `/spaces/${slug}/settings`, label: '设置' })
  }

  return (
    <>
      <PageHeader
        title={space.name}
        meta={
          <>
            <span className="font-mono text-base text-subtle">{space.slug}</span>
            <Badge tone={isTeam ? 'accent' : 'neutral'}>{isTeam ? '团队' : '个人'}</Badge>
          </>
        }
        tabs={tabs}
        actions={
          instance?.status === 'running' ? (
            <Link to={`/spaces/${slug}/instance`}>
              <Button variant="primary" icon={<IconExternal />}>
                打开实例
              </Button>
            </Link>
          ) : null
        }
      />
      <PageBody>
        <Outlet context={{ detail, reload: load, isOwner, canManage } satisfies SpaceContext} />
      </PageBody>
    </>
  )
}
