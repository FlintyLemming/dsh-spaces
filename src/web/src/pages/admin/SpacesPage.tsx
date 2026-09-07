import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, errorMessage } from '../../api'
import {
  Alert,
  Badge,
  EmptyState,
  LoadingBlock,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
} from '../../components/ui'
import { IconGrid } from '../../components/icons'
import { PageBody, PageHeader } from '../../app/PageHeader'

interface AdminSpace {
  id: number
  slug: string
  name: string
  kind: 'personal' | 'team'
  member_count: number
  instance_count: number
  running_count: number
}

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<AdminSpace[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    apiFetch<{ spaces: AdminSpace[] }>('/api/admin/spaces')
      .then((d) => setSpaces(d.spaces))
      .catch((e) => setError(errorMessage(e, '加载失败')))
  }, [])

  return (
    <>
      <PageHeader wide title="空间" description="平台上的全部空间，含每人的个人空间。" />
      <PageBody wide className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        {!spaces ? (
          <LoadingBlock />
        ) : spaces.length === 0 ? (
          <EmptyState icon={<IconGrid />} title="还没有任何空间" />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>标识</Th>
                  <Th>名称</Th>
                  <Th>类型</Th>
                  <Th align="right">成员</Th>
                  <Th align="right">实例</Th>
                  <Th align="right">运行中</Th>
                </tr>
              </thead>
              <tbody>
                {spaces.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link
                        to={`/admin/spaces/${s.slug}`}
                        className="font-mono font-medium underline-offset-3 hover:underline"
                      >
                        {s.slug}
                      </Link>
                    </Td>
                    <Td>{s.name}</Td>
                    <Td>
                      <Badge tone={s.kind === 'team' ? 'accent' : 'neutral'}>
                        {s.kind === 'personal' ? '个人' : '团队'}
                      </Badge>
                    </Td>
                    <Td align="right">{s.member_count}</Td>
                    <Td align="right">{s.instance_count}</Td>
                    <Td align="right">{s.running_count}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </PageBody>
    </>
  )
}
