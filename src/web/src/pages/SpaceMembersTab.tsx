import { useState, type FormEvent } from 'react'
import { apiFetch, errorMessage } from '../api'
import {
  Alert,
  Badge,
  Button,
  Input,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
} from '../components/ui'
import { IconPlus } from '../components/icons'
import { useAuth } from '../state/auth'
import { useSpaceContext } from './SpaceLayout'

export default function SpaceMembersTab() {
  const { detail, reload, isOwner } = useSpaceContext()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { space, members } = detail

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/spaces/${space.slug}/members`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setEmail('')
      await reload()
    } catch (err) {
      setError(errorMessage(err, '添加失败'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(userId: number) {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/spaces/${space.slug}/members/${userId}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      setError(errorMessage(err, '移除失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {isOwner ? (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="按邮箱添加已注册用户"
            type="email"
            required
            className="max-w-80"
          />
          <Button type="submit" variant="primary" icon={<IconPlus />} disabled={busy || !email}>
            添加成员
          </Button>
        </form>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>成员</Th>
              <Th>标识</Th>
              <Th>角色</Th>
              {isOwner ? <Th align="right" /> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <Tr key={m.userId}>
                <Td>
                  <span className="block font-medium">
                    {m.displayName}
                    {m.userId === user?.id ? (
                      <span className="ml-2 text-sm font-normal text-subtle">你</span>
                    ) : null}
                  </span>
                  <span className="block text-sm text-muted">{m.email}</span>
                </Td>
                <Td className="font-mono text-sm text-muted">{m.handle}</Td>
                <Td>
                  <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>
                    {m.role === 'owner' ? '所有者' : '成员'}
                  </Badge>
                </Td>
                {isOwner ? (
                  <Td align="right">
                    {m.role !== 'owner' ? (
                      <Button size="sm" disabled={busy} onClick={() => remove(m.userId)}>
                        移除
                      </Button>
                    ) : null}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  )
}
