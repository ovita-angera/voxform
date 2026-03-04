import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/hooks/useAuth'
import { api } from '@/lib/api/client'
import { StatusDot, Skeleton, Btn, Empty } from '@/components/ui'

export function DashboardPage() {
  const { user } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['surveys', 'recent'],
    queryFn: () => api.get<{ data: unknown[] }>('/surveys?pageSize=5'),
  })
  const surveys = (data as { data: { id: string; title: string; status: string; responseCount?: number }[] } | null)?.data ?? []

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <p className="text-[13px] text-dim font-mono">{greeting}</p>
          <h1 className="font-serif text-[32px] tracking-tight text-ink mt-0.5">{user?.name?.split(' ')[0]}</h1>
        </div>
        <Link to="/surveys/new"><Btn size="sm">+ New survey</Btn></Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-px bg-warm border border-warm mb-8">
        {[
          { label: 'Surveys', value: surveys.length, sub: 'total' },
          { label: 'Plan', value: user?.org?.plan ?? '—', sub: 'current tier' },
          { label: 'Workspace', value: user?.org?.name ?? '—', sub: 'organisation', sm: true },
        ].map(({ label, value, sub, sm }) => (
          <div key={label} className="bg-paper px-6 py-5">
            <p className="text-[11px] font-mono text-dim uppercase tracking-widest mb-2">{label}</p>
            <p className={`font-serif text-ink leading-none ${sm ? 'text-[20px]' : 'text-[28px]'}`}>{value}</p>
            <p className="text-[11px] text-ghost mt-1 font-mono">{sub}</p>
          </div>
        ))}
      </div>

      {/* Recent surveys */}
      <div className="border border-warm">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-warm">
          <p className="text-[12px] font-mono text-dim uppercase tracking-widest">Recent surveys</p>
          <Link to="/surveys" className="text-[12px] font-mono text-dim hover:text-ink">All surveys →</Link>
        </div>

        {isLoading ? (
          <div className="divide-y divide-warm">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-5 py-4 flex items-center gap-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-16 ml-auto" />
              </div>
            ))}
          </div>
        ) : surveys.length === 0 ? (
          <Empty icon="◧" title="No surveys yet" sub="Create your first survey to get started"
            action={<Link to="/surveys/new"><Btn size="sm">Create survey</Btn></Link>} />
        ) : (
          <div className="divide-y divide-warm">
            {surveys.map(s => (
              <Link key={s.id} to={`/surveys/${s.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-warm/40 transition-colors group">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-ink font-medium group-hover:underline truncate">{s.title}</p>
                  <p className="text-[12px] text-dim font-mono mt-0.5">{s.responseCount ?? 0} responses</p>
                </div>
                <StatusDot status={s.status} />
                <span className="text-ghost text-[12px]">›</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
