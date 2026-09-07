import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { apiFetch, errorMessage, statusText, type InstanceStatus } from '../../api'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  LoadingBlock,
  StatusDot,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
} from '../../components/ui'
import { IconArrowLeft } from '../../components/icons'
import { PageBody, PageHeader } from '../../app/PageHeader'

interface Detail {
  space: {
    id: number
    slug: string
    name: string
    kind: 'personal' | 'team'
    quota_cpu: number | null
    quota_mem_mb: number | null
    quota_instances: number | null
  }
  members: { user_id: number; email: string; handle: string; role: string; status: string }[]
  instances: {
    id: number
    user_id: number
    handle: string
    container_name: string
    status: InstanceStatus
    last_active_at: number | null
  }[]
  volumes: { id: number; kind: 'shared' | 'private'; docker_name: string }[]
}

type Pending = { kind: 'space' } | { kind: 'instance'; userId: number; container: string }

export default function SpaceDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [quota, setQuota] = useState({ quotaCpu: '', quotaMemMb: '', quotaInstances: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  async function load() {
    const d = await apiFetch<Detail>(`/api/admin/spaces/${slug}`)
    setDetail(d)
    setQuota({
      quotaCpu: d.space.quota_cpu?.toString() ?? '',
      quotaMemMb: d.space.quota_mem_mb?.toString() ?? '',
      quotaInstances: d.space.quota_instances?.toString() ?? '',
    })
  }
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e, '加载失败')))
  }, [slug])

  async function run(fn: () => Promise<unknown>, done = '') {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await fn()
      await load()
      setMessage(done)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveQuota(e: FormEvent) {
    e.preventDefault()
    await run(
      () =>
        apiFetch(`/api/admin/spaces/${slug}/quota`, {
          method: 'PUT',
          body: JSON.stringify({
            quotaCpu: quota.quotaCpu === '' ? null : Number(quota.quotaCpu),
            quotaMemMb: quota.quotaMemMb === '' ? null : Number(quota.quotaMemMb),
            quotaInstances: quota.quotaInstances === '' ? null : Number(quota.quotaInstances),
          }),
        }),
      '配额已保存',
    )
  }

  async function deleteSpace() {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/admin/spaces/${slug}`, { method: 'DELETE' })
      navigate('/admin/spaces')
    } catch (e) {
      setError(errorMessage(e, '删除失败'))
      setBusy(false)
      setPending(null)
    }
  }

  if (error && !detail) {
    return (
      <>
        <PageHeader wide title={slug ?? '空间'} />
        <PageBody wide>
          <Alert>{error}</Alert>
        </PageBody>
      </>
    )
  }
  if (!detail) {
    return (
      <>
        <PageHeader wide title={slug ?? '空间'} />
        <PageBody wide>
          <LoadingBlock />
        </PageBody>
      </>
    )
  }
  const { space, members, instances, volumes } = detail

  return (
    <>
      <PageHeader
        wide
        title={space.name}
        meta={
          <>
            <span className="font-mono text-base text-subtle">{space.slug}</span>
            <Badge tone={space.kind === 'team' ? 'accent' : 'neutral'}>
              {space.kind === 'team' ? '团队' : '个人'}
            </Badge>
          </>
        }
        actions={
          <Link to="/admin/spaces">
            <Button icon={<IconArrowLeft />}>返回列表</Button>
          </Link>
        }
      />
      <PageBody wide className="space-y-5">
        {error ? <Alert>{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}

        <Card>
          <CardHeader title={`成员 · ${members.length}`} />
          <CardBody className="px-0! pb-0!">
            <Table>
              <thead>
                <tr>
                  <Th>邮箱</Th>
                  <Th>用户名</Th>
                  <Th>角色</Th>
                  <Th>状态</Th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <Tr key={m.user_id}>
                    <Td>{m.email}</Td>
                    <Td className="font-mono text-sm text-muted">{m.handle}</Td>
                    <Td>{m.role === 'owner' ? '所有者' : '成员'}</Td>
                    <Td>
                      <Badge tone={m.status === 'active' ? 'success' : 'danger'}>
                        {m.status === 'active' ? '正常' : '已禁用'}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`实例 · ${instances.length}`} description="删除实例会保留数据卷。" />
          {instances.length === 0 ? (
            <CardBody className="text-base text-muted">该空间还没有实例。</CardBody>
          ) : (
            <CardBody className="px-0! pb-0!">
              <Table>
                <thead>
                  <tr>
                    <Th>成员</Th>
                    <Th>容器</Th>
                    <Th>状态</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((i) => (
                    <Tr key={i.id}>
                      <Td className="font-mono text-sm">{i.handle}</Td>
                      <Td className="font-mono text-sm text-muted">{i.container_name}</Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <StatusDot status={i.status} />
                          {statusText(i.status)}
                        </span>
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={busy || i.status !== 'running'}
                            onClick={() =>
                              void run(
                                () =>
                                  apiFetch(
                                    `/api/admin/spaces/${slug}/instances/${i.user_id}/stop`,
                                    { method: 'POST' },
                                  ),
                                '实例已停止',
                              )
                            }
                          >
                            停止
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              setPending({
                                kind: 'instance',
                                userId: i.user_id,
                                container: i.container_name,
                              })
                            }
                          >
                            删除
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="配额覆盖" description="留空表示沿用平台默认配额。" />
          <CardBody>
            <form className="flex flex-wrap items-end gap-4" onSubmit={saveQuota}>
              <Field label="CPU（核）" htmlFor="q-cpu">
                <Input
                  id="q-cpu"
                  className="w-28"
                  value={quota.quotaCpu}
                  inputMode="decimal"
                  onChange={(e) => setQuota({ ...quota, quotaCpu: e.target.value })}
                />
              </Field>
              <Field label="内存（MB）" htmlFor="q-mem">
                <Input
                  id="q-mem"
                  className="w-28"
                  value={quota.quotaMemMb}
                  inputMode="numeric"
                  onChange={(e) => setQuota({ ...quota, quotaMemMb: e.target.value })}
                />
              </Field>
              <Field label="实例数" htmlFor="q-inst">
                <Input
                  id="q-inst"
                  className="w-28"
                  value={quota.quotaInstances}
                  inputMode="numeric"
                  onChange={(e) => setQuota({ ...quota, quotaInstances: e.target.value })}
                />
              </Field>
              <Button type="submit" variant="primary" disabled={busy}>
                保存配额
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`卷 · ${volumes.length}`} />
          <CardBody className="px-0! pb-0!">
            <Table>
              <thead>
                <tr>
                  <Th>类型</Th>
                  <Th>Docker 卷名</Th>
                </tr>
              </thead>
              <tbody>
                {volumes.map((v) => (
                  <Tr key={v.id}>
                    <Td>{v.kind === 'shared' ? '共享' : '私有'}</Td>
                    <Td className="font-mono text-sm text-muted">{v.docker_name}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>

        {space.kind === 'team' ? (
          <Card className="border-danger/35">
            <CardHeader
              title="删除空间"
              description="该空间的全部实例与卷都会被销毁，操作不可撤销。"
            />
            <CardFooter>
              <span>删除前请确认没有成员正在使用。</span>
              <Button variant="danger" disabled={busy} onClick={() => setPending({ kind: 'space' })}>
                删除空间
              </Button>
            </CardFooter>
          </Card>
        ) : null}
      </PageBody>

      {pending?.kind === 'space' ? (
        <ConfirmDialog
          title={`删除空间 ${space.slug}？`}
          description="全部实例与卷将被销毁，且不可恢复。"
          confirmLabel="永久删除"
          busy={busy}
          onClose={() => setPending(null)}
          onConfirm={() => void deleteSpace()}
        />
      ) : null}
      {pending?.kind === 'instance' ? (
        <ConfirmDialog
          title="删除实例？"
          description={`${pending.container} 将被删除，卷数据保留。`}
          confirmLabel="删除实例"
          busy={busy}
          onClose={() => setPending(null)}
          onConfirm={() => {
            const userId = pending.userId
            setPending(null)
            void run(
              () =>
                apiFetch(`/api/admin/spaces/${slug}/instances/${userId}`, { method: 'DELETE' }),
              '实例已删除',
            )
          }}
        />
      ) : null}
    </>
  )
}
