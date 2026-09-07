import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, errorMessage, statusText } from '../api'
import { Alert, Button, Card, CardBody, CardFooter, CardHeader, StatusDot } from '../components/ui'
import { IconExternal, IconPlay, IconRefresh, IconStop } from '../components/icons'
import { useAuth } from '../state/auth'
import { useSpaces } from '../state/spaces'
import { useSpaceContext } from './SpaceLayout'

const HINT: Record<string, string> = {
  running: '实例正在运行，可以直接打开。',
  starting: '实例正在冷启动，就绪后状态会自动更新。',
  stopped: '实例已停止，数据卷保留。启动后回到上次的工作目录。',
  error: '实例异常。重建会保留数据卷，只重建容器。',
  none: '还没有实例。首次启动会拉起容器并创建数据卷。',
}

export default function SpaceOverviewTab() {
  const { detail, reload } = useSpaceContext()
  const { user } = useAuth()
  const { refresh: refreshSpaces } = useSpaces()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const { space, instance } = detail
  const status = instance?.status ?? null

  async function act(verb: 'start' | 'stop' | 'rebuild') {
    setBusy(verb)
    setError('')
    try {
      await apiFetch(`/api/spaces/${space.slug}/instance/${verb}`, { method: 'POST' })
      await reload()
      await refreshSpaces()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy('')
    }
  }

  const running = status === 'running'
  const starting = status === 'starting'

  return (
    <div className="space-y-5">
      {error ? <Alert>{error}</Alert> : null}

      <Card>
        <CardHeader
          title="我的实例"
          description={HINT[status ?? 'none']}
          action={
            <span className="flex items-center gap-2 text-md font-medium">
              <StatusDot status={status} />
              {statusText(status)}
            </span>
          }
        />
        <CardBody>
          {instance?.error ? <Alert>{instance.error}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<IconPlay />}
              disabled={!!busy || running || starting}
              onClick={() => act('start')}
            >
              {busy === 'start' ? '启动中…' : '启动'}
            </Button>
            <Button
              icon={<IconStop />}
              disabled={!!busy || !running}
              onClick={() => act('stop')}
            >
              {busy === 'stop' ? '停止中…' : '停止'}
            </Button>
            <Button
              icon={<IconRefresh />}
              disabled={!!busy || !instance}
              onClick={() => act('rebuild')}
            >
              {busy === 'rebuild' ? '重建中…' : '重建'}
            </Button>
            {running ? (
              <Link to={`/spaces/${space.slug}/instance`}>
                <Button variant="secondary" icon={<IconExternal />}>
                  打开
                </Button>
              </Link>
            ) : null}
          </div>
        </CardBody>
        <CardFooter>
          <span className="font-mono text-sm">
            /s/{space.slug}/{user?.handle}/
          </span>
          {instance?.imageDigest ? (
            <span
              className="truncate font-mono text-sm"
              title={instance.imageDigest}
            >
              镜像 {instance.imageDigest.slice(0, 19)}
            </span>
          ) : null}
        </CardFooter>
      </Card>
    </div>
  )
}
