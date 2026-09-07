import { useEffect, useState } from 'react'
import { apiFetch, errorMessage } from '../../api'
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  LoadingBlock,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
} from '../../components/ui'
import { IconInbox, IconSearch } from '../../components/icons'
import { PageBody, PageHeader } from '../../app/PageHeader'

interface Usage {
  running: number
  cpuPercent: number
  memoryMb: number
  diskBytes: number
  spaces: { slug: string; running: number; memoryMb: number; volumeBytes: number }[]
}

interface AuditEntry {
  id: number
  actor_id: number | null
  actor_email: string | null
  action: string
  target_type: string
  target_id: string | null
  detail_json: string | null
  created_at: number
}

function bytes(v: number) {
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`
  return `${(v / 1024 ** 2).toFixed(1)} MB`
}

/** 指标块：标签在上、数值在下。大数字用比例字形，表格里的数字才对齐。 */
function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3.5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl leading-none font-semibold tracking-tight">
        {value}
        {unit ? <span className="ml-1 text-base font-normal text-subtle">{unit}</span> : null}
      </p>
    </div>
  )
}

export default function UsageAuditPage() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [action, setAction] = useState('')
  const [error, setError] = useState('')

  async function loadAudit(act: string) {
    const q = act ? `?action=${encodeURIComponent(act)}` : ''
    try {
      const d = await apiFetch<{ entries: AuditEntry[] }>(`/api/admin/audit${q}`)
      setEntries(d.entries)
    } catch (e) {
      setError(errorMessage(e, '审计日志加载失败'))
    }
  }
  useEffect(() => {
    apiFetch<Usage>('/api/admin/usage')
      .then(setUsage)
      .catch((e) => setError(errorMessage(e, '用量加载失败')))
    void loadAudit('')
  }, [])

  return (
    <>
      <PageHeader wide title="用量与审计" description="平台当前资源占用，以及全部管理动作的留痕。" />
      <PageBody wide className="space-y-6">
        {error ? <Alert>{error}</Alert> : null}

        {!usage ? (
          <LoadingBlock />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="运行中实例" value={String(usage.running)} />
              <Stat label="CPU 占用" value={String(usage.cpuPercent)} unit="%" />
              <Stat label="内存占用" value={String(usage.memoryMb)} unit="MB" />
              <Stat label="卷占用" value={bytes(usage.diskBytes)} />
            </div>

            {usage.spaces.length === 0 ? (
              <EmptyState icon={<IconInbox />} title="当前没有任何实例或卷" />
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>空间</Th>
                      <Th align="right">运行中实例</Th>
                      <Th align="right">内存 (MB)</Th>
                      <Th align="right">卷占用</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.spaces.map((s) => (
                      <Tr key={s.slug}>
                        <Td className="font-mono text-sm">{s.slug}</Td>
                        <Td align="right">{s.running}</Td>
                        <Td align="right">{s.memoryMb}</Td>
                        <Td align="right">{bytes(s.volumeBytes)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </>
        )}

        <Card>
          <CardHeader
            title="审计日志"
            action={
              <div className="relative">
                <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-md text-subtle" />
                <Input
                  value={action}
                  placeholder="按动作过滤，如 admin.settings_update"
                  className="w-72 pl-8"
                  onChange={(e) => {
                    setAction(e.target.value)
                    void loadAudit(e.target.value)
                  }}
                />
              </div>
            }
          />
          <CardBody className="px-0! pb-0!">
            {!entries ? (
              <div className="px-5">
                <LoadingBlock />
              </div>
            ) : entries.length === 0 ? (
              <p className="px-5 pb-5 text-base text-muted">没有匹配的审计记录。</p>
            ) : (
              <div className="max-h-160 overflow-auto">
                <Table>
                  <thead className="sticky top-0">
                    <tr>
                      <Th>时间</Th>
                      <Th>操作者</Th>
                      <Th>动作</Th>
                      <Th>对象</Th>
                      <Th>详情</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <Tr key={e.id}>
                        <Td className="text-sm whitespace-nowrap tabular-nums text-muted">
                          {new Date(e.created_at).toLocaleString()}
                        </Td>
                        <Td className="whitespace-nowrap">{e.actor_email ?? '系统'}</Td>
                        <Td className="font-mono text-sm">{e.action}</Td>
                        <Td className="font-mono text-sm text-muted whitespace-nowrap">
                          {e.target_type}
                          {e.target_id ? `:${e.target_id}` : ''}
                        </Td>
                        <Td className="max-w-80 truncate font-mono text-sm text-subtle">
                          {e.detail_json ?? ''}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>
      </PageBody>
    </>
  )
}
