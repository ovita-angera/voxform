import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Mic, Play, Pause } from 'lucide-react'
import { api } from '@/lib/api/client'
import { Badge, Skeleton, Empty } from '@/components/ui'
import { cn } from '@/lib/utils/cn'

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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Strip origin from absolute localhost URLs so Vite proxy handles them
function audioSrc(url: string | null | undefined): string | null {
  if (!url) return null
  return url.replace(/^https?:\/\/localhost:\d+/, '')
}

function sessionBadgeColor(status: string): 'green' | 'amber' | 'red' | 'warm' {
  if (status === 'COMPLETED') return 'green'
  if (status === 'IN_PROGRESS') return 'amber'
  return 'red'
}

// ── Compact cell renderers ─────────────────────────────────────────────────────
function CellValue({ r, q }: { r: ResponseRow | undefined; q: Question }) {
  if (!r) return <span className="text-dim">—</span>

  if (AUDIO_TYPES.has(r.type)) {
    const src = audioSrc(r.audio_wav_url || r.audio_url)
    return (
      <div className="flex items-center gap-1.5">
        <Mic size={11} className="text-violet shrink-0" />
        <span className="font-mono text-[11px] text-dim">
          {r.audio_duration_sec != null ? fmt(r.audio_duration_sec) : src ? '…' : 'pending'}
        </span>
      </div>
    )
  }

  if (!r.text_value) return <span className="text-dim">—</span>

  if (r.type === 'STAR_RATING') {
    const n = Number(r.text_value) || 0
    const opts = (q as unknown as { options?: { max?: number } }).options
    const max = opts?.max ?? 5
    return <span className="font-mono text-[12px] text-ink">{n}/{max} ★</span>
  }
  if (r.type === 'YES_NO') {
    return (
      <span className={cn(
        'text-[12px] font-medium',
        r.text_value === 'yes' ? 'text-emerald-600' : 'text-red-500',
      )}>
        {r.text_value === 'yes' ? 'Yes' : 'No'}
      </span>
    )
  }
  if (r.type === 'MULTIPLE_CHOICE') {
    try {
      const arr = JSON.parse(r.text_value)
      if (Array.isArray(arr)) return <span className="text-[12px] text-dim">{arr.length} selected</span>
    } catch { /* fall through */ }
  }
  // Truncate long text for table cell
  const text = r.text_value
  return (
    <span className="text-[12px] text-ink" title={text.length > 40 ? text : undefined}>
      {text.length > 40 ? text.slice(0, 38) + '…' : text}
    </span>
  )
}

// ── Mini audio player ─────────────────────────────────────────────────────────
function MiniAudioPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false)
  const [el, setEl] = useState<HTMLAudioElement | null>(null)

  function toggle() {
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        className="w-7 h-7 rounded-full border border-warm flex items-center justify-center text-dim hover:border-violet hover:text-violet transition-all shrink-0"
      >
        {playing ? <Pause size={11} /> : <Play size={11} />}
      </button>
      <audio
        ref={setEl}
        src={src}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <div className="flex-1 h-1.5 bg-warm rounded-full min-w-[60px]" />
    </div>
  )
}

// ── Expanded session detail ────────────────────────────────────────────────────
function SessionDetail({
  session, responses, questions,
  onApprove, onReject, isPending,
}: {
  session: Session
  responses: ResponseRow[]
  questions: Question[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  isPending: boolean
}) {
  const answerMap = Object.fromEntries(responses.map(r => [r.question_id, r]))

  return (
    <div className="px-5 py-5 bg-warm/5 border-t border-warm">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[11px] font-mono text-dim uppercase tracking-widest">
          {fmtDate(session.created_at)}
        </span>
        {session.respondent_ref && (
          <span className="text-[11px] font-mono text-dim">· {session.respondent_ref}</span>
        )}
        <Badge color={sessionBadgeColor(session.status)}>
          {session.status.replace(/_/g, ' ')}
        </Badge>
      </div>

      <div className="space-y-5">
        {questions.map((q, idx) => {
          const r = answerMap[q.id]
          if (!r) return (
            <div key={q.id} className="flex gap-4 items-start">
              <span className="text-[10px] font-mono text-dim w-5 mt-0.5 shrink-0 text-right">
                {idx + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] text-dim mb-1">{q.title}</p>
                <p className="text-[13px] text-dim italic">No response</p>
              </div>
            </div>
          )

          const isAudio = AUDIO_TYPES.has(r.type)
          const src = isAudio ? audioSrc(r.audio_wav_url || r.audio_url) : null
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
            <div key={q.id} className="flex gap-4 items-start">
              <span className="text-[10px] font-mono text-dim w-5 mt-0.5 shrink-0 text-right">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p className="text-[12px] text-dim leading-snug">{q.title}</p>
                  <Badge color={
                    r.status === 'APPROVED' ? 'green' :
                    r.status === 'REJECTED' ? 'red' :
                    r.status === 'PROCESSING' ? 'amber' : 'warm'
                  }>
                    {r.status}
                  </Badge>
                </div>

                {isAudio ? (
                  <div className="space-y-2.5">
                    {src
                      ? <MiniAudioPlayer src={src} />
                      : <p className="text-[12px] font-mono text-dim">Audio pending processing…</p>
                    }
                    {r.audio_duration_sec != null && (
                      <p className="text-[11px] font-mono text-dim">
                        Duration: {fmt(r.audio_duration_sec)}
                        {qcTier && qcData?.avgDbfs != null && (
                          <span className={cn('ml-3', qcColor)}>
                            Signal: {qcTier} ({Math.round(qcData.avgDbfs)} dBFS)
                          </span>
                        )}
                      </p>
                    )}
                    {r.transcript && (
                      <div className="pl-3 border-l-2 border-warm">
                        <p className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Transcript</p>
                        <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">
                          {(() => {
                            try {
                              const t = JSON.parse(r.transcript)
                              return t.text ?? r.transcript
                            } catch { return r.transcript }
                          })()}
                        </p>
                      </div>
                    )}
                    {r.extracted_value && (
                      <div className="pl-3 border-l-2 border-violet/40">
                        <p className="text-[10px] font-mono text-violet uppercase tracking-widest mb-1">Extracted</p>
                        <p className="text-[13px] text-ink">
                          {(() => {
                            try {
                              const e = JSON.parse(r.extracted_value!)
                              return e.answer ?? r.extracted_value
                            } catch { return r.extracted_value }
                          })()}
                        </p>
                        {r.confidence_score != null && (
                          <p className="text-[11px] font-mono text-dim mt-0.5">
                            Confidence: {Math.round(r.confidence_score * 100)}%
                          </p>
                        )}
                      </div>
                    )}
                    {r.status === 'SUBMITTED' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onApprove(r.id)}
                          disabled={isPending}
                          className="px-3 py-1 rounded-lg text-[12px] font-mono border border-warm hover:border-emerald-400 hover:text-emerald-600 text-dim transition-all disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => onReject(r.id)}
                          disabled={isPending}
                          className="px-3 py-1 rounded-lg text-[12px] font-mono border border-warm hover:border-red-400 hover:text-red-500 text-dim transition-all disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ) : r.type === 'STAR_RATING' ? (
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i} className={cn('text-[18px] leading-none', i < Number(r.text_value || 0) ? 'text-amber-400' : 'text-warm')}>★</span>
                    ))}
                    <span className="ml-2 font-mono text-[12px] text-dim">{r.text_value}/5</span>
                  </div>
                ) : r.type === 'MULTIPLE_CHOICE' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      try {
                        const arr = JSON.parse(r.text_value ?? '[]')
                        return Array.isArray(arr)
                          ? arr.map((v: string) => (
                              <span key={v} className="text-[12px] border border-warm rounded-full px-2.5 py-0.5 text-dim">{v}</span>
                            ))
                          : <p className="text-[13px] text-ink">{r.text_value}</p>
                      } catch { return <p className="text-[13px] text-ink">{r.text_value}</p> }
                    })()}
                  </div>
                ) : r.type === 'YES_NO' ? (
                  <span className={cn(
                    'inline-flex items-center px-3 py-1 rounded-full text-[12px] font-medium border',
                    r.text_value === 'yes'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-red-50 text-red-600 border-red-200',
                  )}>
                    {r.text_value === 'yes' ? 'Yes' : 'No'}
                  </span>
                ) : (
                  <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">
                    {r.text_value}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function ResponsesPage() {
  const qc = useQueryClient()
  const [surveyId, setSurveyId] = useState('')
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  const { data: surveysData } = useQuery({
    queryKey: ['surveys-select'],
    queryFn: () => api.get<{ data: Survey[] }>('/surveys?pageSize=100'),
  })
  const surveys: Survey[] = (surveysData as { data: Survey[] } | null)?.data ?? []

  const { data: questions = [] } = useQuery<Question[]>({
    queryKey: ['questions', surveyId],
    queryFn: () => api.get<Question[]>(`/surveys/${surveyId}/questions`),
    enabled: !!surveyId,
  })
  const sortedQuestions = [...questions].sort((a, b) => a.order_index - b.order_index)
  const qMap = Object.fromEntries(questions.map(q => [q.id, q]))

  const { data: sessionsData } = useQuery({
    queryKey: ['sessions', surveyId],
    queryFn: () => api.get<{ data: Session[] }>(`/sessions?surveyId=${surveyId}&pageSize=200`),
    enabled: !!surveyId,
  })
  const sessions: Session[] = (sessionsData as { data: Session[] } | null)?.data ?? []

  const { data: respData, isLoading } = useQuery({
    queryKey: ['responses', surveyId],
    queryFn: () => api.get<{ data: ResponseRow[] }>(`/responses?surveyId=${surveyId}&pageSize=500`),
    enabled: !!surveyId,
  })
  const responses: ResponseRow[] = (respData as { data: ResponseRow[] } | null)?.data ?? []

  // Group responses by session
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

  const audioCount = responses.filter(r => AUDIO_TYPES.has(r.type)).length
  const completedCount = sessions.filter(s => s.status === 'COMPLETED').length

  // Max 6 question columns in table to avoid overflow; show "more" otherwise
  const TABLE_Q_LIMIT = 6
  const tableQuestions = sortedQuestions.slice(0, TABLE_Q_LIMIT)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-[30px] tracking-tight text-ink">Responses</h1>
          {surveyId && sessions.length > 0 && (
            <p className="text-[13px] text-dim font-mono mt-0.5">
              {sessions.length} respondents · {completedCount} completed
              {audioCount > 0 && ` · ${audioCount} audio responses`}
            </p>
          )}
        </div>
        <select
          title="Select survey"
          className="h-9 pl-3 pr-8 rounded-lg border border-warm bg-paper text-[13px] text-ink focus:outline-none focus:border-violet transition-colors shrink-0"
          value={surveyId}
          onChange={e => { setSurveyId(e.target.value); setOpenSessionId(null) }}
        >
          <option value="">Select a survey…</option>
          {surveys.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>

      {!surveyId ? (
        <Empty icon="◎" title="Select a survey" sub="Choose a survey above to view its responses" />
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
        </div>
      ) : sessions.length === 0 ? (
        <Empty icon="◎" title="No responses yet" sub="Responses will appear here once the survey is submitted" />
      ) : (
        <div className="rounded-2xl border border-warm overflow-hidden shadow-sm">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-warm/30 border-b border-warm">
                  <th className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest w-10">#</th>
                  <th className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest">Status</th>
                  {tableQuestions.map(q => (
                    <th key={q.id} className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest max-w-[140px]">
                      <span className="block truncate" title={q.title}>{q.title}</span>
                    </th>
                  ))}
                  {sortedQuestions.length > TABLE_Q_LIMIT && (
                    <th className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest">
                      +{sortedQuestions.length - TABLE_Q_LIMIT} more
                    </th>
                  )}
                  <th className="w-8" aria-label="Expand" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((sess, idx) => {
                  const sessResponses = bySession[sess.id] ?? []
                  const answerMap = Object.fromEntries(sessResponses.map(r => [r.question_id, r]))
                  const isOpen = openSessionId === sess.id
                  const audioN = sessResponses.filter(r => AUDIO_TYPES.has(r.type)).length

                  return (
                    <>
                      <tr
                        key={sess.id}
                        onClick={() => setOpenSessionId(isOpen ? null : sess.id)}
                        className={cn(
                          'cursor-pointer border-b border-warm transition-colors',
                          isOpen ? 'bg-violet/5' : 'hover:bg-warm/30',
                        )}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[12px] text-dim">{idx + 1}</span>
                            {audioN > 0 && (
                              <Mic size={10} className="text-violet opacity-70" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-[12px] text-dim font-mono">{fmtDate(sess.created_at)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={sessionBadgeColor(sess.status)}>
                            {sess.status.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        {tableQuestions.map(q => (
                          <td key={q.id} className="px-4 py-3 max-w-[140px]">
                            <CellValue r={answerMap[q.id]} q={q} />
                          </td>
                        ))}
                        {sortedQuestions.length > TABLE_Q_LIMIT && (
                          <td className="px-4 py-3 text-[11px] font-mono text-dim">
                            {sessResponses.length}/{sortedQuestions.length}
                          </td>
                        )}
                        <td className="px-3 py-3 text-dim">
                          {isOpen
                            ? <ChevronUp size={14} />
                            : <ChevronDown size={14} />}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr key={`${sess.id}-detail`} className="border-b border-warm">
                          <td colSpan={4 + tableQuestions.length + (sortedQuestions.length > TABLE_Q_LIMIT ? 1 : 0)} className="p-0">
                            <SessionDetail
                              session={sess}
                              responses={sessResponses}
                              questions={sortedQuestions}

                              onApprove={approveMut.mutate}
                              onReject={rejectMut.mutate}
                              isPending={approveMut.isPending || rejectMut.isPending}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
