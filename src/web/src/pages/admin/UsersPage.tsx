import { useEffect, useState } from 'react'
import { apiFetch, errorMessage } from '../../api'
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingBlock,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
} from '../../components/ui'
import { IconSearch, IconUser } from '../../components/icons'
import { PageBody, PageHeader } from '../../app/PageHeader'
import { useAuth } from '../../state/auth'

interface AdminUser {
  id: number
  email: string
  handle: string
  display_name: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  space_count: number
  running_instances: number
}

export default function UsersPage() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(q: string) {
    try {
      const data = await apiFetch<{ users: AdminUser[] }>(
        `/api/admin/users?search=${encodeURIComponent(q)}`,
      )
      setUsers(data.users)
    } catch (e) {
      setError(errorMessage(e, '加载失败'))
    }
  }
  useEffect(() => {
    void load('')
  }, [])

  async function act(id: number, action: string, body?: object) {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/admin/users/${id}/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      await load(search)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        wide
        title="用户"
        description="平台上的全部账号。禁用后该用户无法登录，已有实例会被停止。"
        actions={
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-md text-subtle" />
            <Input
              value={search}
              placeholder="搜索邮箱 / 用户名 / 昵称"
              className="w-64 pl-8"
              onChange={(e) => {
                setSearch(e.target.value)
                void load(e.target.value)
              }}
            />
          </div>
        }
      />
      <PageBody wide className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        {!users ? (
          <LoadingBlock />
        ) : users.length === 0 ? (
          <EmptyState icon={<IconUser />} title="没有匹配的用户" />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>用户</Th>
                  <Th>用户名</Th>
                  <Th>角色</Th>
                  <Th>状态</Th>
                  <Th align="right">空间数</Th>
                  <Th align="right">运行中</Th>
                  <Th align="right">操作</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <span className="block font-medium">
                        {u.display_name}
                        {u.id === me?.id ? (
                          <span className="ml-2 text-sm font-normal text-subtle">你</span>
                        ) : null}
                      </span>
                      <span className="block text-sm text-muted">{u.email}</span>
                    </Td>
                    <Td className="font-mono text-sm text-muted">{u.handle}</Td>
                    <Td>
                      <Badge tone={u.role === 'admin' ? 'accent' : 'neutral'}>
                        {u.role === 'admin' ? '管理员' : '用户'}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={u.status === 'active' ? 'success' : 'danger'}>
                        {u.status === 'active' ? '正常' : '已禁用'}
                      </Badge>
                    </Td>
                    <Td align="right">{u.space_count}</Td>
                    <Td align="right">{u.running_instances}</Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        {u.status === 'active' ? (
                          <Button
                            size="sm"
                            disabled={busy || u.id === me?.id}
                            onClick={() => void act(u.id, 'disable')}
                          >
                            禁用
                          </Button>
                        ) : (
                          <Button size="sm" disabled={busy} onClick={() => void act(u.id, 'enable')}>
                            启用
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={busy || u.id === me?.id}
                          onClick={() =>
                            void act(u.id, 'role', {
                              role: u.role === 'admin' ? 'user' : 'admin',
                            })
                          }
                        >
                          {u.role === 'admin' ? '降为用户' : '设为管理员'}
                        </Button>
                      </div>
                    </Td>
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
