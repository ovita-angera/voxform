import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Btn, StatusDot, Empty, Skeleton } from '@/components/ui'

const STATUSES = ['ALL', 'ACTIVE', 'DRAFT', 'PAUSED', 'CLOSED']

interface Survey {
  id: string; title: string; slug: string; status: string; responseCount?: number
}

export function SurveysPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')

  const { data, isLoading } = useQuery({
    queryKey: ['surveys', search, status],
    queryFn: () => api.get<{ data: Survey[] }>(`/surveys?search=${search}&status=${status === 'ALL' ? '' : status}&pageSize=50`),
  })
  const surveys = (data as { data: Survey[] } | null)?.data ?? []

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/surveys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-[32px] tracking-tight text-ink">Surveys</h1>
          <p className="text-[13px] text-dim font-mono mt-0.5">{surveys.length} total</p>
        </div>
        <Link to="/surveys/new"><Btn size="sm">+ New survey</Btn></Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          className="flex-1 h-9 px-4 border border-warm bg-paper text-[13px] text-ink placeholder:text-ghost focus:outline-none focus:border-ink font-mono transition-colors"
          placeholder="Search surveys…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex border border-warm overflow-x-auto shrink-0">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 h-9 text-[11px] font-mono uppercase tracking-wide transition-colors border-r border-warm last:border-r-0
                ${status === s ? 'bg-ink text-paper' : 'bg-paper text-dim hover:text-ink'}`}>
              {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-warm overflow-x-auto">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-px bg-warm border-b border-warm">
          {['Survey', 'Status', 'Responses', ''].map(h => (
            <div key={h} className="bg-paper px-4 py-2.5 text-[11px] font-mono text-dim uppercase tracking-widest">{h}</div>
          ))}
        </div>

        {isLoading ? (
          <div className="divide-y divide-warm">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-4 bg-paper">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : surveys.length === 0 ? (
          <div className="bg-paper">
            <Empty icon="◧" title="No surveys found"
              sub={search ? `No results for "${search}"` : 'Create your first survey'}
              action={!search ? <Link to="/surveys/new"><Btn size="sm">Create survey</Btn></Link> : undefined}
            />
          </div>
        ) : (
          <div className="divide-y divide-warm">
            {surveys.map(s => (
              <div key={s.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3.5 bg-paper hover:bg-warm/30 transition-colors">
                <div className="min-w-0">
                  <Link to={`/surveys/${s.id}`} className="text-[14px] text-ink font-medium hover:underline truncate block">{s.title}</Link>
                  <p className="text-[11px] font-mono text-dim mt-0.5">{s.slug}</p>
                </div>
                <StatusDot status={s.status} />
                <span className="text-[13px] font-mono text-dim text-right">{s.responseCount ?? 0}</span>
                <div className="flex gap-1.5">
                  <Link to={`/surveys/${s.id}`}><Btn variant="outline" size="sm">Edit</Btn></Link>
                  <button onClick={() => { if (confirm('Delete this survey?')) del.mutate(s.id) }}
                    className="h-8 px-3 text-[13px] text-dim hover:text-red-500 font-sans border border-warm hover:border-red-200 transition-colors">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
