import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mic, AlignLeft, User, Headphones, Hash, Mail, Video,
  CalendarDays, Phone, ToggleLeft, CheckSquare, ChevronDown,
  Grid3X3, Upload, AlignJustify, Star, FileText, LayoutTemplate,
  Copy, ExternalLink, QrCode, Trash2, ChevronRight,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { Btn, Badge, StatusDot } from '@/components/ui'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shadcn/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/shadcn/dialog'
import { cn } from '@/lib/utils/cn'

// ── Question type registry ─────────────────────────────────────────────────────
const Q_CATEGORIES = [
  {
    label: 'Input',
    types: [
      { type: 'VOICE_RESPONSE',   icon: Mic,          label: 'Voice Response' },
      { type: 'SHORT_TEXT',       icon: AlignLeft,    label: 'Text Input' },
      { type: 'NAME',             icon: User,         label: 'Name' },
      { type: 'AUDIO_QUESTION',   icon: Headphones,   label: 'Audio Question' },
      { type: 'NUMERIC',          icon: Hash,         label: 'Numeric Input' },
      { type: 'EMAIL',            icon: Mail,         label: 'Email' },
      { type: 'VIDEO_CAPTURE',    icon: Video,        label: 'Video Capture' },
      { type: 'DATE',             icon: CalendarDays, label: 'Date Picker' },
      { type: 'PHONE',            icon: Phone,        label: 'Phone Number' },
      { type: 'LONG_TEXT',        icon: FileText,     label: 'Long Text' },
    ],
  },
  {
    label: 'Single choice',
    types: [
      { type: 'YES_NO',           icon: ToggleLeft,   label: 'Yes / No' },
      { type: 'DROPDOWN',         icon: ChevronDown,  label: 'Dropdown' },
      { type: 'SINGLE_CHOICE',    icon: LayoutTemplate, label: 'Radio Button' },
    ],
  },
  {
    label: 'Multiple choice & grid',
    types: [
      { type: 'MULTIPLE_CHOICE',  icon: CheckSquare,  label: 'Checkbox' },
      { type: 'MATRIX',           icon: Grid3X3,      label: 'Matrix' },
    ],
  },
  {
    label: 'Other',
    types: [
      { type: 'FILE_UPLOAD',      icon: Upload,       label: 'File upload' },
      { type: 'DESCRIPTION_SLIDE', icon: AlignJustify, label: 'Description Slide' },
      { type: 'STAR_RATING',      icon: Star,         label: 'Rating' },
    ],
  },
]

const ALL_TYPES = Q_CATEGORIES.flatMap(c => c.types)

function getTypeInfo(type: string) {
  return ALL_TYPES.find(t => t.type === type)
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Question {
  id: string; type: string; title: string; description?: string
  required: boolean; order: number; options?: Record<string, unknown>
}
interface Survey {
  id: string; title: string; description?: string; slug: string; status: string
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function SurveyBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: survey } = useQuery<Survey>({ queryKey: ['survey', id], queryFn: () => api.get<Survey>(`/surveys/${id}`) })
  const { data: qData } = useQuery<Question[]>({ queryKey: ['questions', id], queryFn: () => api.get<Question[]>(`/surveys/${id}/questions`) })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingQ, setEditingQ] = useState<Question | null>(null)
  const [surveyTitle, setSurveyTitle] = useState('')
  const [saved, setSaved] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const questions: Question[] = qData ?? []
  const selected = questions.find(q => q.id === selectedId)

  useEffect(() => { if (survey?.title) setSurveyTitle(survey.title) }, [survey])
  useEffect(() => { if (questions.length && !selectedId) setSelectedId(questions[0]?.id ?? null) }, [questions.length])
  useEffect(() => {
    if (!selected) return
    // Normalize: DB returns options as JSON string and required as 0/1
    const opts = typeof (selected.options as unknown) === 'string'
      ? (() => { try { return JSON.parse(selected.options as unknown as string) } catch { return {} } })()
      : (selected.options ?? {})
    setEditingQ({ ...selected, required: !!selected.required, options: opts })
  }, [selected?.id])

  const save = useMutation({
    mutationFn: () => api.put(`/surveys/${id}`, { title: surveyTitle }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['survey', id] }); setSaved(true); setTimeout(() => setSaved(false), 2000) },
  })
  const addQ = useMutation({
    mutationFn: (type: string) => api.post<Question>(`/surveys/${id}/questions`, { type, title: 'Untitled question', required: false }),
    onSuccess: (q: Question) => { qc.invalidateQueries({ queryKey: ['questions', id] }); setSelectedId(q.id) },
  })
  const updateQ = useMutation({
    mutationFn: (data: Question) => api.put(`/surveys/${id}/questions/${data.id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['questions', id] }),
  })
  const deleteQ = useMutation({
    mutationFn: (qid: string) => api.delete(`/surveys/${id}/questions/${qid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['questions', id] }); setSelectedId(null) },
  })
  const toggleStatus = useMutation({
    mutationFn: () => api.patch(`/surveys/${id}/status`, { status: survey?.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['survey', id] }),
  })

  const shareUrl = survey ? `${window.location.origin}/s/${survey.slug}` : ''

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="flex flex-col h-screen bg-paper">
      {/* ── Topbar ── */}
      <div className="h-12 flex items-center gap-4 px-4 border-b border-warm bg-paper shrink-0">
        <Link to="/surveys" className="text-dim hover:text-ink font-mono text-[13px] transition-colors">←</Link>
        <div className="w-px h-5 bg-warm" />
        <input
          className="flex-1 bg-transparent border-none outline-none text-[14px] font-medium text-ink placeholder:text-ghost font-sans"
          value={surveyTitle}
          onChange={e => setSurveyTitle(e.target.value)}
          onBlur={() => save.mutate()}
          placeholder="Survey title…"
        />
        <StatusDot status={survey?.status ?? 'DRAFT'} />
        <div className="flex items-center gap-2">
          {survey?.status === 'ACTIVE' && (
            <a href={shareUrl} target="_blank" rel="noopener noreferrer">
              <Btn variant="outline" size="sm">
                <ExternalLink size={13} className="mr-1.5" />Preview
              </Btn>
            </a>
          )}
          <Btn variant="outline" size="sm" onClick={() => toggleStatus.mutate()}>
            {survey?.status === 'ACTIVE' ? 'Pause' : 'Publish'}
          </Btn>
          <Btn size="sm" onClick={() => save.mutate()}>
            {saved ? '✓ Saved' : 'Save'}
          </Btn>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="create" className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="shrink-0 px-4">
          <TabsTrigger value="create">Create</TabsTrigger>
          <TabsTrigger value="share">Share</TabsTrigger>
          <TabsTrigger value="responses">Responses</TabsTrigger>
        </TabsList>

        {/* ── CREATE TAB ── */}
        <TabsContent value="create" className="flex flex-1 overflow-hidden">
          {/* Questions list */}
          <aside className="w-[200px] shrink-0 border-r border-warm flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-warm">
              <span className="text-[11px] font-mono text-dim uppercase tracking-widest">Questions</span>
              <span className="text-[11px] font-mono bg-warm px-1.5">{questions.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5">
              {questions.map((q, i) => {
                const info = getTypeInfo(q.type)
                const Icon = info?.icon
                return (
                  <button key={q.id} onClick={() => setSelectedId(q.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors',
                      selectedId === q.id ? 'bg-ink text-paper' : 'text-dim hover:bg-warm hover:text-ink',
                    )}>
                    <span className="text-[10px] font-mono w-4 shrink-0 text-right opacity-50">
                      {q.type === 'DESCRIPTION_SLIDE' ? '—' : i + 1}
                    </span>
                    {Icon && <Icon size={11} className="shrink-0 opacity-70" />}
                    <span className="text-[12px] truncate flex-1">{q.title}</span>
                    {!!q.required && <span className={cn('w-1 h-1 rounded-full shrink-0', selectedId === q.id ? 'bg-paper' : 'bg-violet')} />}
                  </button>
                )
              })}
            </div>
            <div className="p-2 border-t border-warm">
              <button onClick={() => setPaletteOpen(true)}
                className="w-full py-2 border border-dashed border-warm text-[12px] font-mono text-dim hover:text-ink hover:border-ink transition-colors">
                + Add
              </button>
            </div>
          </aside>

          {/* Canvas */}
          <div className="flex-1 overflow-auto bg-warm/10 flex items-start justify-center py-10 px-6">
            {selected && editingQ ? (
              <div className="w-full max-w-[620px] bg-paper border border-warm shadow-sm">
                <div className="flex items-center gap-3 px-5 py-3 border-b border-warm">
                  {(() => {
                    const info = getTypeInfo(selected.type)
                    const Icon = info?.icon
                    return (
                      <span className="text-[11px] font-mono text-dim border border-warm px-2 py-0.5 flex items-center gap-1.5">
                        {Icon && <Icon size={11} />}{info?.label ?? selected.type}
                      </span>
                    )
                  })()}
                  <div className="ml-auto flex gap-2">
                    <Btn size="sm" variant="outline" onClick={() => updateQ.mutate(editingQ)}>Apply</Btn>
                    <button
                      onClick={() => { if (confirm('Delete this question?')) deleteQ.mutate(selected.id) }}
                      className="h-8 w-8 flex items-center justify-center text-dim hover:text-red-500 border border-warm hover:border-red-200 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="px-8 py-10">
                  <h2 className="font-serif text-[22px] tracking-tight text-ink mb-2 leading-snug">
                    {editingQ.title || 'Untitled question'}
                    {!!editingQ.required && <span className="text-violet ml-1 text-[16px]">*</span>}
                  </h2>
                  {editingQ.description && <p className="text-[13px] text-dim mb-5 leading-relaxed">{editingQ.description}</p>}
                  <QuestionPreview q={editingQ} />
                </div>
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="font-serif text-[20px] text-ghost">Select a question to edit</p>
                <p className="text-[12px] font-mono text-ghost mt-2">or add your first one</p>
                <button onClick={() => setPaletteOpen(true)}
                  className="mt-5 text-[12px] font-mono text-dim hover:text-ink border border-warm px-4 py-2 transition-colors">
                  + Add question
                </button>
              </div>
            )}
          </div>

          {/* Properties panel */}
          {editingQ && (
            <aside className="w-[240px] shrink-0 border-l border-warm overflow-y-auto">
              <div className="px-4 py-2.5 border-b border-warm">
                <span className="text-[11px] font-mono text-dim uppercase tracking-widest">Properties</span>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Question</label>
                  <textarea
                    className="w-full px-3 py-2 border border-warm text-[13px] text-ink font-sans bg-paper focus:outline-none focus:border-ink transition-colors resize-none"
                    rows={3}
                    value={editingQ.title}
                    onChange={e => setEditingQ(q => q ? { ...q, title: e.target.value } : q)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Helper text</label>
                  <input
                    className="w-full px-3 py-2 border border-warm text-[13px] text-ink font-sans bg-paper focus:outline-none focus:border-ink transition-colors"
                    value={editingQ.description ?? ''}
                    onChange={e => setEditingQ(q => q ? { ...q, description: e.target.value } : q)}
                    placeholder="Optional…"
                  />
                </div>

                {/* Type-specific settings */}
                <TypeSettings q={editingQ} setQ={setEditingQ} />

                <div className="flex items-center justify-between pt-1">
                  <label className="text-[11px] font-mono text-dim uppercase tracking-widest">Required</label>
                  <button
                    type="button"
                    title={editingQ.required ? 'Mark as optional' : 'Mark as required'}
                    onClick={() => {
                      const updated = { ...editingQ, required: !editingQ.required }
                      setEditingQ(updated)
                      updateQ.mutate(updated)
                    }}
                    className={cn('w-11 h-6 rounded-full border-2 transition-all relative shrink-0 cursor-pointer', editingQ.required ? 'bg-violet border-violet' : 'bg-warm border-ghost/60')}>
                    <span className={cn('absolute top-[3px] w-[18px] h-[18px] rounded-full shadow-sm transition-all duration-200', editingQ.required ? 'right-[3px] bg-white' : 'left-[3px] bg-ghost')} />
                  </button>
                </div>
              </div>
            </aside>
          )}
        </TabsContent>

        {/* ── SHARE TAB ── */}
        <TabsContent value="share" className="overflow-auto">
          <div className="max-w-lg mx-auto px-8 py-10 space-y-6">
            <div>
              <h2 className="font-serif text-[24px] tracking-tight text-ink mb-1">Share survey</h2>
              <p className="text-[13px] text-dim">Distribute your survey via link, QR code, or embed.</p>
            </div>

            <div className="border border-warm">
              <div className="px-4 py-3 border-b border-warm">
                <p className="text-[11px] font-mono text-dim uppercase tracking-widest">Status</p>
              </div>
              <div className="px-4 py-4 flex items-center justify-between">
                <StatusDot status={survey?.status ?? 'DRAFT'} />
                <Btn variant="outline" size="sm" onClick={() => toggleStatus.mutate()}>
                  {survey?.status === 'ACTIVE' ? 'Pause collection' : 'Start collecting'}
                </Btn>
              </div>
            </div>

            {survey?.status === 'ACTIVE' ? (
              <>
                <div className="border border-warm">
                  <div className="px-4 py-3 border-b border-warm">
                    <p className="text-[11px] font-mono text-dim uppercase tracking-widest">Survey link</p>
                  </div>
                  <div className="px-4 py-4 space-y-3">
                    <div className="flex items-center gap-2 px-3 py-2 bg-warm/40 border border-warm">
                      <span className="flex-1 text-[12px] font-mono text-dim truncate">{shareUrl}</span>
                      <button onClick={copyLink}
                        className="shrink-0 text-dim hover:text-ink transition-colors p-1">
                        <Copy size={13} />
                      </button>
                    </div>
                    {copied && <p className="text-[11px] font-mono text-emerald-600">Copied to clipboard</p>}
                    <div className="flex gap-2">
                      <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                        <Btn variant="outline" size="sm" className="w-full">
                          <ExternalLink size={13} className="mr-1.5" />Open survey
                        </Btn>
                      </a>
                    </div>
                  </div>
                </div>

                <div className="border border-warm">
                  <div className="px-4 py-3 border-b border-warm">
                    <p className="text-[11px] font-mono text-dim uppercase tracking-widest">QR Code</p>
                  </div>
                  <div className="px-4 py-6 flex flex-col items-center gap-3">
                    <div className="w-28 h-28 border border-warm flex items-center justify-center bg-warm/20">
                      <QrCode size={48} className="text-dim opacity-40" />
                    </div>
                    <p className="text-[11px] font-mono text-ghost text-center">QR code generation available in Pro plan</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="border border-warm/60 px-5 py-6 text-center">
                <p className="font-serif text-[18px] text-ghost mb-1">Survey is not active</p>
                <p className="text-[13px] text-dim">Publish the survey first to access sharing options.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── RESPONSES TAB ── */}
        <TabsContent value="responses" className="overflow-auto">
          <SurveyResponses surveyId={id ?? ''} surveySlug={survey?.slug ?? ''} />
        </TabsContent>
      </Tabs>

      {/* ── Question palette dialog ── */}
      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="w-[560px] max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Add question</DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-5">
            {Q_CATEGORIES.map(cat => (
              <div key={cat.label}>
                <p className="text-[10px] font-mono text-violet uppercase tracking-widest mb-2 px-1">{cat.label}</p>
                <div className="grid grid-cols-3 gap-1">
                  {cat.types.map(t => {
                    const Icon = t.icon
                    return (
                      <button key={t.type}
                        type="button"
                        onClick={() => { addQ.mutate(t.type); setPaletteOpen(false) }}
                        className="flex items-center gap-2.5 px-3 py-2.5 border border-warm hover:bg-violet/10 hover:border-violet text-left transition-colors group">
                        <Icon size={14} className="text-violet shrink-0" />
                        <span className="text-[12px] text-dim group-hover:text-ink">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Type-specific properties ───────────────────────────────────────────────────
function TypeSettings({ q, setQ }: { q: Question; setQ: React.Dispatch<React.SetStateAction<Question | null>> }) {
  const setOpts = (patch: Record<string, unknown>) =>
    setQ(prev => {
      if (!prev) return prev
      const cur: Record<string, unknown> = typeof (prev.options as unknown) === 'string'
        ? (() => { try { return JSON.parse(prev.options as unknown as string) } catch { return {} } })()
        : (prev.options as Record<string, unknown> ?? {})
      return { ...prev, options: { ...cur, ...patch } }
    })

  if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE' || q.type === 'DROPDOWN') {
    const choices = (q.options?.choices as { id: string; label: string }[]) ?? [
      { id: '1', label: 'Option A' },
      { id: '2', label: 'Option B' },
    ]
    return (
      <div>
        <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Choices</label>
        <div className="space-y-1.5">
          {choices.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2">
              <input
                className="flex-1 px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
                value={c.label}
                onChange={e => {
                  const updated = choices.map((x, j) => j === i ? { ...x, label: e.target.value } : x)
                  setOpts({ choices: updated })
                }}
              />
              <button onClick={() => setOpts({ choices: choices.filter((_, j) => j !== i) })}
                className="text-ghost hover:text-red-400 transition-colors">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setOpts({ choices: [...choices, { id: Date.now().toString(), label: `Option ${choices.length + 1}` }] })}
            className="text-[11px] font-mono text-dim hover:text-ink transition-colors mt-1">
            + Add choice
          </button>
        </div>
      </div>
    )
  }

  if (q.type === 'STAR_RATING') {
    const max = (q.options?.max as number) ?? 5
    return (
      <div>
        <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Max stars</label>
        <div className="flex border border-warm">
          {[3, 5, 7, 10].map(n => (
            <button key={n} onClick={() => setOpts({ max: n })}
              className={cn('flex-1 py-1.5 text-[12px] font-mono transition-colors border-r border-warm last:border-r-0',
                max === n ? 'bg-ink text-paper' : 'text-dim hover:text-ink')}>
              {n}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (q.type === 'LIKERT') {
    const opts = q.options as { min?: number; max?: number; minLabel?: string; maxLabel?: string } | undefined
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Scale</label>
          <div className="flex gap-2 items-center text-[12px] font-mono text-dim">
            <input type="number" className="w-14 px-2 py-1.5 border border-warm text-[12px] font-mono text-center bg-paper focus:outline-none focus:border-ink"
              value={opts?.min ?? 1} min={1} max={5}
              onChange={e => setOpts({ min: Number(e.target.value) })} />
            <span>to</span>
            <input type="number" className="w-14 px-2 py-1.5 border border-warm text-[12px] font-mono text-center bg-paper focus:outline-none focus:border-ink"
              value={opts?.max ?? 5} min={2} max={10}
              onChange={e => setOpts({ max: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Labels</label>
          <div className="space-y-1.5">
            <input className="w-full px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
              placeholder="Low label" value={opts?.minLabel ?? ''} onChange={e => setOpts({ minLabel: e.target.value })} />
            <input className="w-full px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
              placeholder="High label" value={opts?.maxLabel ?? ''} onChange={e => setOpts({ maxLabel: e.target.value })} />
          </div>
        </div>
      </div>
    )
  }

  if (q.type === 'YES_NO') {
    const opts = q.options as { yesLabel?: string; noLabel?: string } | undefined
    return (
      <div className="space-y-2">
        <label className="block text-[11px] font-mono text-dim uppercase tracking-widest">Button labels</label>
        <input className="w-full px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
          placeholder="Yes" value={opts?.yesLabel ?? ''} onChange={e => setOpts({ yesLabel: e.target.value })} />
        <input className="w-full px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
          placeholder="No" value={opts?.noLabel ?? ''} onChange={e => setOpts({ noLabel: e.target.value })} />
      </div>
    )
  }

  if (q.type === 'NUMERIC') {
    const opts = q.options as { min?: number; max?: number; unit?: string } | undefined
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Range</label>
          <div className="flex gap-2 items-center text-[12px] font-mono text-dim">
            <input type="number" className="w-20 px-2 py-1.5 border border-warm text-[12px] font-mono bg-paper focus:outline-none focus:border-ink"
              placeholder="Min" value={opts?.min ?? ''} onChange={e => setOpts({ min: Number(e.target.value) })} />
            <span>–</span>
            <input type="number" className="w-20 px-2 py-1.5 border border-warm text-[12px] font-mono bg-paper focus:outline-none focus:border-ink"
              placeholder="Max" value={opts?.max ?? ''} onChange={e => setOpts({ max: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Unit</label>
          <input className="w-full px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
            placeholder="e.g. kg, km, $" value={opts?.unit ?? ''} onChange={e => setOpts({ unit: e.target.value })} />
        </div>
      </div>
    )
  }

  if (q.type === 'VOICE_RESPONSE' || q.type === 'AUDIO_CAPTURE' || q.type === 'AUDIO_QUESTION') {
    const opts = q.options as { minDurationSec?: number; maxDurationSec?: number } | undefined
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Min duration (sec)</label>
          <input type="number" className="w-full px-3 py-2 border border-warm text-[13px] font-mono bg-paper focus:outline-none focus:border-ink"
            value={opts?.minDurationSec ?? 15} min={5}
            onChange={e => setOpts({ minDurationSec: Number(e.target.value) })} />
        </div>
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Max duration (sec)</label>
          <input type="number" className="w-full px-3 py-2 border border-warm text-[13px] font-mono bg-paper focus:outline-none focus:border-ink"
            value={opts?.maxDurationSec ?? 300} min={30}
            onChange={e => setOpts({ maxDurationSec: Number(e.target.value) })} />
        </div>
        <div className="border border-warm/50 px-3 py-2.5 bg-warm/20 space-y-1">
          <p className="text-[10px] font-mono text-dim uppercase tracking-widest mb-2">Quality thresholds</p>
          {[
            ['SNR', '> 15 dB', 'Good signal-to-noise ratio'],
            ['dBFS', '> −18 dBFS', 'Acceptable recording level'],
            ['Freq', '> 300 Hz', 'Minimum frequency response'],
          ].map(([key, val, desc]) => (
            <div key={key} className="flex items-start gap-2">
              <span className="font-mono text-[10px] text-violet w-8 shrink-0 mt-0.5">{key}</span>
              <div>
                <span className="font-mono text-[11px] text-ink">{val}</span>
                <p className="text-[10px] text-ghost">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (q.type === 'MATRIX') {
    const opts = q.options as { rows?: string[]; columns?: string[] } | undefined
    const rows = opts?.rows ?? ['Row 1', 'Row 2']
    const cols = opts?.columns ?? ['Column 1', 'Column 2', 'Column 3']
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Rows</label>
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input className="flex-1 px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
                  value={r} onChange={e => { const updated = [...rows]; updated[i] = e.target.value; setOpts({ rows: updated }) }} />
                <button onClick={() => setOpts({ rows: rows.filter((_, j) => j !== i) })} className="text-ghost hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
              </div>
            ))}
            <button onClick={() => setOpts({ rows: [...rows, `Row ${rows.length + 1}`] })}
              className="text-[11px] font-mono text-dim hover:text-ink transition-colors">+ Add row</button>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Columns</label>
          <div className="space-y-1.5">
            {cols.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input className="flex-1 px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
                  value={c} onChange={e => { const updated = [...cols]; updated[i] = e.target.value; setOpts({ columns: updated }) }} />
                <button onClick={() => setOpts({ columns: cols.filter((_, j) => j !== i) })} className="text-ghost hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
              </div>
            ))}
            <button onClick={() => setOpts({ columns: [...cols, `Column ${cols.length + 1}`] })}
              className="text-[11px] font-mono text-dim hover:text-ink transition-colors">+ Add column</button>
          </div>
        </div>
      </div>
    )
  }

  if (q.type === 'FILE_UPLOAD') {
    const opts = q.options as { accept?: string; maxMB?: number } | undefined
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Accepted types</label>
          <input className="w-full px-2.5 py-1.5 border border-warm text-[12px] font-sans bg-paper focus:outline-none focus:border-ink"
            placeholder="e.g. .pdf,.docx,image/*" value={opts?.accept ?? ''} onChange={e => setOpts({ accept: e.target.value })} />
        </div>
        <div>
          <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Max size (MB)</label>
          <input type="number" className="w-full px-2.5 py-1.5 border border-warm text-[12px] font-mono bg-paper focus:outline-none focus:border-ink"
            value={opts?.maxMB ?? 10} min={1} max={100} onChange={e => setOpts({ maxMB: Number(e.target.value) })} />
        </div>
      </div>
    )
  }

  return null
}

// ── Canvas question preview ───────────────────────────────────────────────────
function QuestionPreview({ q }: { q: Question }) {
  if (q.type === 'DESCRIPTION_SLIDE') return (
    <div className="flex items-center gap-4 my-2">
      <hr className="flex-1 border-warm" />
      <span className="text-[11px] font-mono text-ghost uppercase tracking-widest">{q.title}</span>
      <hr className="flex-1 border-warm" />
    </div>
  )
  if (q.type === 'VOICE_RESPONSE' || q.type === 'AUDIO_CAPTURE' || q.type === 'AUDIO_QUESTION') return (
    <div className="flex flex-col items-center gap-4 py-8 border border-warm">
      <div className="w-14 h-14 border border-warm flex items-center justify-center text-dim"><Mic size={24} /></div>
      <div className="flex gap-2 flex-wrap justify-center">
        {['WAV 16kHz', `Min ${(q.options as { minDurationSec?: number })?.minDurationSec ?? 15}s`, 'QC enabled'].map(b => (
          <span key={b} className="text-[10px] font-mono border border-warm px-2 py-1 text-dim">{b}</span>
        ))}
      </div>
      <p className="text-[12px] font-mono text-ghost">Tap to record</p>
    </div>
  )
  if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE' || q.type === 'DROPDOWN') {
    const choices = (q.options as { choices?: { id: string; label: string }[] })?.choices ?? [
      { id: '1', label: 'Option A' },
      { id: '2', label: 'Option B' },
    ]
    const isCheck = q.type === 'MULTIPLE_CHOICE'
    const isDrop = q.type === 'DROPDOWN'
    if (isDrop) return (
      <div className="flex items-center justify-between h-11 border border-warm px-4 text-[14px] text-dim">
        <span>Select an option…</span>
        <ChevronDown size={14} className="text-ghost" />
      </div>
    )
    return (
      <div className="space-y-2">
        {choices.map(c => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3 border border-warm hover:border-ink transition-colors cursor-pointer">
            <div className={cn('w-4 h-4 border border-ghost shrink-0', isCheck ? '' : 'rounded-full')} />
            <span className="text-[14px] text-ink">{c.label}</span>
          </div>
        ))}
      </div>
    )
  }
  if (q.type === 'YES_NO') {
    const opts = q.options as { yesLabel?: string; noLabel?: string } | undefined
    return (
      <div className="flex gap-3">
        <div className="flex-1 py-4 border border-warm text-center text-[15px] text-dim">{opts?.yesLabel ?? 'Yes'}</div>
        <div className="flex-1 py-4 border border-warm text-center text-[15px] text-dim">{opts?.noLabel ?? 'No'}</div>
      </div>
    )
  }
  if (q.type === 'LIKERT') {
    const opts = q.options as { min?: number; max?: number; minLabel?: string; maxLabel?: string } ?? {}
    const pts = Array.from({ length: (opts.max ?? 5) - (opts.min ?? 1) + 1 }, (_, i) => i + (opts.min ?? 1))
    return (
      <div>
        <div className="flex gap-1.5 mb-2">
          {pts.map(v => (
            <div key={v} className="flex-1 h-11 border border-warm flex items-center justify-center font-mono text-[13px] text-dim hover:border-ink cursor-pointer">{v}</div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] font-mono text-ghost">
          <span>{opts.minLabel}</span><span>{opts.maxLabel}</span>
        </div>
      </div>
    )
  }
  if (q.type === 'STAR_RATING') {
    const max = (q.options as { max?: number })?.max ?? 5
    return (
      <div className="flex gap-1.5">
        {Array.from({ length: max }, (_, i) => (
          <Star key={i} size={22} className={i < 3 ? 'text-ink fill-ink' : 'text-warm fill-warm'} />
        ))}
      </div>
    )
  }
  if (q.type === 'MATRIX') {
    const opts = q.options as { rows?: string[]; columns?: string[] } | undefined
    const rows = opts?.rows ?? ['Row 1', 'Row 2']
    const cols = opts?.columns ?? ['Col 1', 'Col 2', 'Col 3']
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="border border-warm px-3 py-2 text-left text-dim font-mono font-normal" />
              {cols.map(c => <th key={c} className="border border-warm px-3 py-2 text-dim font-mono font-normal">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r}>
                <td className="border border-warm px-3 py-2 text-dim font-mono">{r}</td>
                {cols.map(c => (
                  <td key={c} className="border border-warm px-3 py-2 text-center">
                    <div className="w-4 h-4 rounded-full border border-ghost mx-auto" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (q.type === 'FILE_UPLOAD') {
    const opts = q.options as { accept?: string; maxMB?: number } | undefined
    return (
      <div className="border-2 border-dashed border-warm p-8 flex flex-col items-center gap-2">
        <Upload size={24} className="text-dim opacity-40" />
        <p className="text-[13px] text-dim">Drag & drop or click to upload</p>
        <p className="text-[11px] font-mono text-ghost">{opts?.accept ?? 'Any file'} · Max {opts?.maxMB ?? 10}MB</p>
      </div>
    )
  }
  if (q.type === 'NAME') return (
    <div className="flex gap-3">
      <div className="flex-1 h-11 border border-warm flex items-center px-4 text-ghost text-[13px] font-mono">First name</div>
      <div className="flex-1 h-11 border border-warm flex items-center px-4 text-ghost text-[13px] font-mono">Last name</div>
    </div>
  )
  if (q.type === 'NUMERIC') {
    const unit = (q.options as { unit?: string })?.unit
    return (
      <div className="flex items-center h-11 border border-warm">
        <input className="flex-1 h-full px-4 bg-transparent text-ghost text-[13px] font-mono outline-none" placeholder="0" readOnly />
        {unit && <span className="px-3 h-full flex items-center border-l border-warm text-[12px] font-mono text-dim">{unit}</span>}
      </div>
    )
  }
  if (q.type === 'VIDEO_CAPTURE') return (
    <div className="flex flex-col items-center gap-3 py-8 border border-warm">
      <div className="w-14 h-14 border border-warm flex items-center justify-center text-dim"><Video size={24} /></div>
      <p className="text-[12px] font-mono text-ghost">Tap to record video</p>
    </div>
  )
  return <div className="h-11 border border-warm flex items-center px-4 text-ghost text-[13px] font-mono">{q.type.replace(/_/g, ' ').toLowerCase()}</div>
}

// ── Inline responses panel ─────────────────────────────────────────────────────
function SurveyResponses({ surveyId, surveySlug: _slug }: { surveyId: string; surveySlug: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['survey-responses', surveyId],
    queryFn: () => api.get<{ data: { id: string; status: string; createdAt: string }[] }>(`/responses?surveyId=${surveyId}&pageSize=50`),
  })
  const responses = (data as { data: { id: string; status: string; createdAt: string }[] } | null)?.data ?? []

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif text-[24px] tracking-tight text-ink">Responses</h2>
          <p className="text-[13px] text-dim font-mono mt-0.5">{responses.length} total</p>
        </div>
        <Link to="/responses">
          <Btn variant="outline" size="sm">
            View all <ChevronRight size={13} className="ml-1" />
          </Btn>
        </Link>
      </div>

      {isLoading ? (
        <div className="border border-warm divide-y divide-warm">
          {[1, 2, 3].map(i => (
            <div key={i} className="px-4 py-3.5 flex items-center gap-3">
              <div className="h-3 w-32 bg-warm animate-pulse" />
              <div className="h-3 w-16 bg-warm animate-pulse ml-auto" />
            </div>
          ))}
        </div>
      ) : responses.length === 0 ? (
        <div className="border border-warm px-5 py-12 text-center">
          <p className="font-serif text-[18px] text-ghost">No responses yet</p>
          <p className="text-[13px] text-dim mt-1">Responses appear here once the survey is submitted.</p>
        </div>
      ) : (
        <div className="border border-warm divide-y divide-warm">
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5 bg-warm/30">
            {['Session ID', 'Status', 'Date'].map(h => (
              <span key={h} className="text-[11px] font-mono text-dim uppercase tracking-widest">{h}</span>
            ))}
          </div>
          {responses.map(r => (
            <div key={r.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 hover:bg-warm/20 transition-colors">
              <span className="text-[12px] font-mono text-dim">{r.id.slice(0, 20)}…</span>
              <Badge color={r.status === 'COMPLETE' ? 'green' : 'warm'}>{r.status}</Badge>
              <span className="text-[11px] font-mono text-ghost">{new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
