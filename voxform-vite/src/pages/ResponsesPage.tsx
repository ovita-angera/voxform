import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Badge, Skeleton, Empty } from '@/components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Survey { id: string; title: string }
interface Question { id: string; type: string; title: string; order_index: number }
interface Session {
  id: string; status: string; created_at: string
  completed_at?: string; respondent_ref?: string
}
interface ResponseRow {
  id: string; session_id: string; question_id: string; type: string; status: string
  text_value?: string | null; audio_url?: string | null; audio_wav_url?: string | null
  audio_duration_sec?: number | null; qc_result?: string | null; transcript?: string | null
  extracted_value?: string | null; confidence_score?: number | null; created_at: string
}

const AUDIO_TYPES = new Set(['VOICE_RESPONSE', 'AUDIO_CAPTURE', 'AUDIO_QUESTION'])

function fmt(secs: number) {
  return `${Math.floor(secs / 60)}:${String(Math.round(secs) % 60).padStart(2, '0')}`
}

function sessionBadge(status: string): 'green' | 'amber' | 'red' | 'warm' {
  if (status === 'COMPLETED') return 'green'
  if (status === 'IN_PROGRESS') return 'amber'
  return 'red'
}

function responseBadge(status: string): 'green' | 'red' | 'amber' | 'warm' {
  if (status === 'APPROVED') return 'green'
  if (status === 'REJECTED') return 'red'
  if (status === 'PROCESSING' || status === 'QC_PENDING') return 'amber'
  return 'warm'
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function ResponsesPage() {
  const qc = useQueryClient()
  const [surveyId, setSurveyId] = useState('')
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  const { data: surveysData } = useQuery({
    queryKey: ['surveys-select'],
    queryFn: () => api.get<{ data: Survey[] }>('/surveys?pageSize=100'),
  })
  const surveys: Survey[] = (surveysData as any)?.data ?? []

  const { data: questions = [] } = useQuery<Question[]>({
    queryKey: ['questions', surveyId],
    queryFn: () => api.get<Question[]>(`/surveys/${surveyId}/questions`),
    enabled: !!surveyId,
  })
  const qMap = Object.fromEntries(questions.map(q => [q.id, q]))

  const { data: sessionsData } = useQuery({
    queryKey: ['sessions', surveyId],
    queryFn: () => api.get<{ data: Session[] }>(`/sessions?surveyId=${surveyId}&pageSize=200`),
    enabled: !!surveyId,
  })
  const sessions: Session[] = (sessionsData as any)?.data ?? []
  const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]))

  const { data: respData, isLoading } = useQuery({
    queryKey: ['responses', surveyId],
    queryFn: () => api.get<{ data: ResponseRow[] }>(`/responses?surveyId=${surveyId}&pageSize=200`),
    enabled: !!surveyId,
  })
  const responses: ResponseRow[] = (respData as any)?.data ?? []

  // Group by session, sort within each session by question order
  const sessionIds = [...new Set(responses.map(r => r.session_id))]
  const bySession: Record<string, ResponseRow[]> = {}
  for (const r of responses) {
    if (!bySession[r.session_id]) bySession[r.session_id] = []
    bySession[r.session_id].push(r)
  }
  for (const sid of Object.keys(bySession)) {
    bySession[sid].sort((a, b) =>
      (qMap[a.question_id]?.order_index ?? 999) - (qMap[b.question_id]?.order_index ?? 999)
    )
  }

  const approveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/responses/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['responses', surveyId] }),
  })
  const rejectMut = useMutation({
    mutationFn: (id: string) => api.patch(`/responses/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['responses', surveyId] }),
  })

  function toggleAll() {
    if (expandedSessions.size === sessionIds.length) {
      setExpandedSessions(new Set())
    } else {
      setExpandedSessions(new Set(sessionIds))
    }
  }

  function toggleSession(id: string) {
    setExpandedSessions(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const audioCount = responses.filter(r => AUDIO_TYPES.has(r.type)).length

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="font-serif text-[32px] tracking-tight text-ink">Responses</h1>
          {surveyId && responses.length > 0 && (
            <p className="text-[13px] text-dim font-mono mt-0.5">
              {responses.length} responses · {sessionIds.length} sessions
              {audioCount > 0 && ` · ${audioCount} audio`}
            </p>
          )}
        </div>
        <select
          title="Select survey"
          className="h-9 pl-3 pr-8 rounded-lg border border-warm bg-paper text-[13px] text-ink font-mono focus:outline-none focus:border-ink transition-colors shrink-0"
          value={surveyId}
          onChange={e => { setSurveyId(e.target.value); setExpandedSessions(new Set()) }}
        >
          <option value="">Select survey…</option>
          {surveys.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>

      {!surveyId ? (
        <Empty icon="◎" title="Select a survey" sub="Choose a survey above to review its responses" />
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : sessionIds.length === 0 ? (
        <Empty icon="◎" title="No responses yet" sub="Responses will appear here once surveys are submitted" />
      ) : (
        <>
          <div className="flex justify-end mb-3">
            <button
              type="button"
              onClick={toggleAll}
              className="font-mono text-[11px] text-dim hover:text-ink transition-colors"
            >
              {expandedSessions.size === sessionIds.length ? '− Collapse all' : '+ Expand all'}
            </button>
          </div>

          <div className="space-y-3">
            {sessionIds.map((sid, idx) => {
              const sess = sessionMap[sid]
              const sessResponses = bySession[sid] ?? []
              const isOpen = expandedSessions.has(sid)
              const sessAudioCount = sessResponses.filter(r => AUDIO_TYPES.has(r.type)).length
              const isPending = approveMut.isPending || rejectMut.isPending

              return (
                <div key={sid} className="rounded-2xl border border-warm/70 overflow-hidden shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleSession(sid)}
                    className="w-full flex items-center justify-between px-5 py-4 bg-paper hover:bg-warm/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-[12px] text-dim">
                        #{String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="font-sans text-[14px] font-medium text-ink">Session</span>
                      {sess?.respondent_ref && (
                        <span className="font-mono text-[12px] text-dim">· {sess.respondent_ref}</span>
                      )}
                      {sessAudioCount > 0 && (
                        <Badge color="violet">{sessAudioCount} audio</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {sess && (
                        <Badge color={sessionBadge(sess.status)}>
                          {sess.status.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      <span className="font-mono text-[11px] text-ghost">
                        {sess ? new Date(sess.created_at).toLocaleDateString() : ''}
                      </span>
                      <span className="font-mono text-[13px] text-dim w-4 text-center">
                        {isOpen ? '−' : '+'}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-warm divide-y divide-warm">
                      {sessResponses.map(r => {
                        const q = qMap[r.question_id]
                        return (
                          <div key={r.id} className="px-5 py-5 bg-paper">
                            <div className="flex items-start justify-between gap-4 mb-3">
                              <div className="min-w-0">
                                <p className="font-mono text-[10px] text-dim tracking-widest uppercase mb-1">
                                  {r.type.replace(/_/g, ' ')}
                                </p>
                                <p className="text-[14px] text-ink font-medium">
                                  {q?.title ?? <span className="text-ghost italic">Unknown question</span>}
                                </p>
                              </div>
                              <Badge color={responseBadge(r.status)}>{r.status}</Badge>
                            </div>

                            <ResponseValue r={r} />

                            {AUDIO_TYPES.has(r.type) && r.status === 'SUBMITTED' && (
                              <div className="flex gap-2 mt-4">
                                <button
                                  type="button"
                                  onClick={() => approveMut.mutate(r.id)}
                                  disabled={isPending}
                                  className="px-4 py-1.5 rounded-lg text-[12px] font-mono border border-warm hover:border-emerald-400 hover:text-emerald-600 text-dim transition-all disabled:opacity-40"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => rejectMut.mutate(r.id)}
                                  disabled={isPending}
                                  className="px-4 py-1.5 rounded-lg text-[12px] font-mono border border-warm hover:border-red-400 hover:text-red-500 text-dim transition-all disabled:opacity-40"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Response value renderer ───────────────────────────────────────────────────
function ResponseValue({ r }: { r: ResponseRow }) {
  const audioUrl = r.audio_wav_url || r.audio_url

  if (AUDIO_TYPES.has(r.type)) {
    let qcData: { avgDbfs?: number } | null = null
    if (r.qc_result) {
      try { qcData = typeof r.qc_result === 'string' ? JSON.parse(r.qc_result) : r.qc_result }
      catch { /* ignore */ }
    }
    const qcTier = qcData?.avgDbfs != null
      ? qcData.avgDbfs > -18 ? 'good' : qcData.avgDbfs > -30 ? 'marginal' : 'poor'
      : null
    const qcColor = qcTier === 'good' ? 'text-emerald-600' : qcTier === 'marginal' ? 'text-amber-600' : 'text-red-500'

    return (
      <div className="space-y-3">
        {audioUrl
          ? <audio controls src={audioUrl} className="w-full h-9" />
          : <p className="font-mono text-[12px] text-ghost">Audio pending…</p>
        }
        {r.audio_duration_sec != null && (
          <p className="font-mono text-[11px] text-dim">Duration: {fmt(r.audio_duration_sec)}</p>
        )}
        {qcTier && qcData?.avgDbfs != null && (
          <p className={`font-mono text-[11px] ${qcColor}`}>
            Signal: {qcTier} · avg {Math.round(qcData.avgDbfs)} dBFS
          </p>
        )}
        {r.transcript && (
          <div className="border-l-2 border-warm pl-3">
            <p className="font-mono text-[10px] text-dim tracking-widest uppercase mb-1.5">Transcript</p>
            <p className="text-[13px] text-ink leading-relaxed">{r.transcript}</p>
          </div>
        )}
        {r.extracted_value && (
          <div className="border-l-2 border-violet/40 pl-3">
            <p className="font-mono text-[10px] text-violet tracking-widest uppercase mb-1.5">Extracted</p>
            <p className="text-[13px] text-ink">{r.extracted_value}</p>
            {r.confidence_score != null && (
              <p className="font-mono text-[11px] text-dim mt-0.5">
                Confidence: {Math.round(r.confidence_score * 100)}%
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  if (!r.text_value) {
    return <p className="text-[13px] text-ghost italic">No response</p>
  }

  if (r.type === 'STAR_RATING') {
    const n = Number(r.text_value) || 0
    return (
      <div className="flex gap-0.5 items-center">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={`text-[22px] leading-none ${i < n ? 'text-ink' : 'text-warm'}`}>★</span>
        ))}
        <span className="ml-2 font-mono text-[12px] text-dim">{n}/5</span>
      </div>
    )
  }

  if (r.type === 'LOCATION') {
    try {
      const loc = JSON.parse(r.text_value)
      return (
        <p className="font-mono text-[13px] text-ink">
          {loc.lat?.toFixed(6)}, {loc.lng?.toFixed(6)}
          {loc.accuracy != null && <span className="text-dim ml-2">±{Math.round(loc.accuracy)}m</span>}
        </p>
      )
    } catch { /* fall through */ }
  }

  if (r.type === 'MULTIPLE_CHOICE') {
    try {
      const arr = JSON.parse(r.text_value)
      if (Array.isArray(arr)) {
        return (
          <div className="flex flex-wrap gap-1.5">
            {arr.map((v: string) => (
              <span key={v} className="font-mono text-[12px] border border-warm px-2 py-0.5 text-dim">{v}</span>
            ))}
          </div>
        )
      }
    } catch { /* fall through */ }
  }

  return <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">{r.text_value}</p>
}
