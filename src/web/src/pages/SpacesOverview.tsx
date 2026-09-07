import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, EmptyState, LoadingBlock, StatusBadge } from '../components/ui'
import { IconChevronRight, IconInbox, IconPlus } from '../components/icons'
import { CreateSpaceDialog } from '../components/CreateSpaceDialog'
import { PageBody, PageHeader } from '../app/PageHeader'
import { useSpaces } from '../state/spaces'
import type { SpaceSummary } from '../api'

function SpaceCard({ space }: { space: SpaceSummary }) {
  return (
    <Link
      to={`/spaces/${space.slug}`}
      className="group flex flex-col justify-between rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-md font-medium tracking-tight">{space.name}</p>
          <p className="mt-0.5 truncate font-mono text-sm text-subtle">{space.slug}</p>
        </div>
        <IconChevronRight className="mt-1 shrink-0 text-md text-subtle transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <StatusBadge status={space.instanceStatus} />
        <span className="text-sm text-subtle">
          {space.memberRole === 'owner' ? '所有者' : '成员'}
        </span>
      </div>
    </Link>
  )
}

function Section({ title, spaces }: { title: string; spaces: SpaceSummary[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium tracking-wide text-subtle">
        {title} · {spaces.length}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spaces.map((s) => (
          <SpaceCard key={s.id} space={s} />
        ))}
      </div>
    </section>
  )
}

export default function SpacesOverview() {
  const { spaces, error, refresh } = useSpaces()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const personal = spaces?.filter((s) => s.kind === 'personal') ?? []
  const team = spaces?.filter((s) => s.kind === 'team') ?? []

  return (
    <>
      <PageHeader
        title="空间"
        description="每个空间里都有一份属于你的 dsh 实例，可随时启动、停止或重建。"
        actions={
          <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)}>
            创建团队空间
          </Button>
        }
      />
      <PageBody className="space-y-8">
        {error ? <Alert>{error}</Alert> : null}
        {spaces === null && !error ? <LoadingBlock /> : null}
        {personal.length ? <Section title="个人" spaces={personal} /> : null}
        {spaces !== null ? (
          team.length ? (
            <Section title="团队" spaces={team} />
          ) : (
            <section>
              <h2 className="mb-3 text-sm font-medium tracking-wide text-subtle">团队 · 0</h2>
              <EmptyState
                icon={<IconInbox />}
                title="还没有加入任何团队空间"
                description="创建一个团队空间，把同事按邮箱加进来，每人都会拿到独立实例与一份共享目录。"
                action={
                  <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)}>
                    创建团队空间
                  </Button>
                }
              />
            </section>
          )
        ) : null}
      </PageBody>

      {creating ? (
        <CreateSpaceDialog
          onClose={() => setCreating(false)}
          onCreated={async (slug) => {
            setCreating(false)
            await refresh()
            navigate(`/spaces/${slug}`)
          }}
        />
      ) : null}
    </>
  )
}
