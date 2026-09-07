import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, errorMessage } from '../api'
import { Alert, Button, Card, CardBody, CardFooter, CardHeader, Field, Input, Modal } from '../components/ui'
import { useSpaces } from '../state/spaces'
import { useSpaceContext } from './SpaceLayout'

export default function SpaceSettingsTab() {
  const { detail, canManage } = useSpaceContext()
  const { refresh: refreshSpaces } = useSpaces()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { space } = detail

  if (!canManage) {
    return <Alert tone="warning">只有空间所有者或平台管理员可以修改这里的设置。</Alert>
  }

  async function doDelete() {
    setError('')
    setBusy(true)
    try {
      await apiFetch(`/api/spaces/${space.slug}`, { method: 'DELETE' })
      await refreshSpaces()
      navigate('/spaces')
    } catch (err) {
      setError(errorMessage(err, '删除失败'))
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="空间信息" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-subtle">名称</p>
            <p className="mt-0.5 text-base">{space.name}</p>
          </div>
          <div>
            <p className="text-sm text-subtle">标识</p>
            <p className="mt-0.5 font-mono text-base">{space.slug}</p>
          </div>
        </CardBody>
      </Card>

      {error ? <Alert>{error}</Alert> : null}

      <Card className="border-danger/35">
        <CardHeader
          title="删除空间"
          description="销毁全部成员实例与共享文件。此操作不可恢复。"
        />
        <CardFooter>
          <span>删除前请确认没有成员正在使用。</span>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            删除空间
          </Button>
        </CardFooter>
      </Card>

      {confirming ? (
        <Modal
          title="删除空间"
          description="这会销毁该空间下所有成员的实例与数据卷，无法撤销。"
          onClose={() => {
            setConfirming(false)
            setTyped('')
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setConfirming(false)
                  setTyped('')
                }}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                variant="danger"
                disabled={busy || typed !== space.slug}
                onClick={doDelete}
              >
                {busy ? '删除中…' : '永久删除'}
              </Button>
            </>
          }
        >
          <Field
            label={
              <>
                输入 <span className="font-mono text-fg">{space.slug}</span> 以确认
              </>
            }
            htmlFor="confirm-slug"
          >
            <Input
              id="confirm-slug"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}
