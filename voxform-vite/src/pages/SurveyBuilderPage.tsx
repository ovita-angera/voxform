import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mic, AlignLeft, User, Headphones, Hash, Mail, Video,
  CalendarDays, Phone, ToggleLeft, CheckSquare, ChevronDown,
  Grid3X3, Upload, AlignJustify, Star, FileText, LayoutTemplate,
  Copy, ExternalLink, QrCode, Trash2, ChevronRight, Plus,
  Check, Loader2, Search, X, ChevronLeft, ChevronUp, Play, Pause, List,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { StatusDot } from '@/components/ui'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shadcn/tabs'
import { cn } from '@/lib/utils/cn'

// ── Question type registry ─────────────────────────────────────────────────────
const Q_CATEGORIES = [
  {
    label: 'Input',
    iconColor: 'text-violet bg-violet/10',
    types: [
      { type: 'VOICE_RESPONSE',    icon: Mic,            label: 'Voice Response',    desc: 'Audio recording from respondent' },
      { type: 'SHORT_TEXT',        icon: AlignLeft,      label: 'Short Text',        desc: 'Single line text answer' },
      { type: 'NAME',              icon: User,           label: 'Name',              desc: 'First and last name fields' },
      { type: 'AUDIO_QUESTION',    icon: Headphones,     label: 'Audio Question',    desc: 'Play audio, then respond' },
      { type: 'NUMERIC',           icon: Hash,           label: 'Number',            desc: 'Numerical value with optional range' },
      { type: 'EMAIL',             icon: Mail,           label: 'Email',             desc: 'Email address with validation' },
      { type: 'VIDEO_CAPTURE',     icon: Video,          label: 'Video Capture',     desc: 'Record a video response' },
      { type: 'DATE',              icon: CalendarDays,   label: 'Date',              desc: 'Date picker input' },
      { type: 'PHONE',             icon: Phone,          label: 'Phone',             desc: 'Phone number with formatting' },
      { type: 'LONG_TEXT',         icon: FileText,       label: 'Long Text',         desc: 'Multi-line paragraph answer' },
    ],
  },
  {
    label: 'Single Choice',
    iconColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40',
    types: [
      { type: 'YES_NO',            icon: ToggleLeft,     label: 'Yes / No',          desc: 'Simple binary choice' },
      { type: 'DROPDOWN',          icon: ChevronDown,    label: 'Dropdown',          desc: 'Select one from a list' },
      { type: 'SINGLE_CHOICE',     icon: LayoutTemplate, label: 'Radio Buttons',     desc: 'Choose exactly one option' },
    ],
  },
  {
    label: 'Multiple Choice',
    iconColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
    types: [
      { type: 'MULTIPLE_CHOICE',   icon: CheckSquare,    label: 'Checkboxes',        desc: 'Select all that apply' },
      { type: 'MATRIX',            icon: Grid3X3,        label: 'Matrix Grid',       desc: 'Rate multiple items in a grid' },
    ],
  },
  {
    label: 'Display & Other',
    iconColor: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
    types: [
      { type: 'STAR_RATING',       icon: Star,           label: 'Star Rating',       desc: 'Rate something with stars' },
      { type: 'FILE_UPLOAD',       icon: Upload,         label: 'File Upload',       desc: 'Accept file submissions' },
      { type: 'DESCRIPTION_SLIDE', icon: AlignJustify,   label: 'Description Slide', desc: 'Add an informational section' },
    ],
  },
]

const ALL_TYPES = Q_CATEGORIES.flatMap(c => c.types.map(t => ({ ...t, iconColor: c.iconColor })))

function getTypeInfo(type: string) {
  return ALL_TYPES.find(t => t.type === type)
}

function parseOptions(opts: unknown): Record<string, unknown> {
  if (typeof opts === 'string') {
    try { return JSON.parse(opts) } catch { return {} }
  }
  return (opts as Record<string, unknown>) ?? {}
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Question {
  id: string; type: string; title: string; description?: string
  required: boolean; order: number; options?: Record<string, unknown>
}
interface Survey {
  id: string; title: string; description?: string; slug: string; status: string
}
type SaveState = 'idle' | 'saving' | 'saved'

// ── Main page ─────────────────────────────────────────────────────────────────
export function SurveyBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: survey } = useQuery<Survey>({
    queryKey: ['survey', id],
    queryFn: () => api.get<Survey>(`/surveys/${id}`),
  })
  const { data: qData } = useQuery<Question[]>({
    queryKey: ['questions', id],
    queryFn: () => api.get<Question[]>(`/surveys/${id}/questions`),
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingQ, setEditingQ] = useState<Question | null>(null)
  const [surveyTitle, setSurveyTitle] = useState('')
  const [pickingType, setPickingType] = useState(false)
  const [typeSearch, setTypeSearch] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [copied, setCopied] = useState(false)
  const [showList, setShowList] = useState(false)

  const qSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const questions: Question[] = qData ?? []
  const selected = questions.find(q => q.id === selectedId)
  const selectedIdx = questions.findIndex(q => q.id === selectedId)

  useEffect(() => { if (survey?.title) setSurveyTitle(survey.title) }, [survey])
  useEffect(() => {
    if (questions.length && !selectedId && !pickingType) {
      setSelectedId(questions[0]?.id ?? null)
    }
  }, [questions.length]) // eslint-disable-line
  useEffect(() => {
    if (!selected) return
    setEditingQ({ ...selected, required: !!selected.required, options: parseOptions(selected.options) })
  }, [selected?.id]) // eslint-disable-line

  // ── Mutations ────────────────────────────────────────────────────────────────
  const saveTitle = useMutation({
    mutationFn: () => api.put(`/surveys/${id}`, { title: surveyTitle }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['survey', id] }),
  })
  const addQ = useMutation({
    mutationFn: (type: string) => api.post<Question>(`/surveys/${id}/questions`, {
      type, title: 'Untitled question', required: false,
    }),
    onSuccess: (q: Question) => {
      qc.invalidateQueries({ queryKey: ['questions', id] })
      setSelectedId(q.id)
      setPickingType(false)
      setTypeSearch('')
    },
  })
  const updateQ = useMutation({
    mutationFn: (data: Question) => api.put(`/surveys/${id}/questions/${data.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questions', id] })
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    },
  })
  const deleteQ = useMutation({
    mutationFn: (qid: string) => api.delete(`/surveys/${id}/questions/${qid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questions', id] })
      setSelectedId(null)
      setEditingQ(null)
    },
  })
  const toggleStatus = useMutation({
    mutationFn: () => api.patch(`/surveys/${id}/status`, {
      status: survey?.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['survey', id] }),
  })

  // ── Auto-save helpers ────────────────────────────────────────────────────────
  const scheduleQSave = useCallback((data: Question) => {
    clearTimeout(qSaveTimer.current)
    setSaveState('saving')
    qSaveTimer.current = setTimeout(() => updateQ.mutate(data), 800)
  }, [updateQ]) // eslint-disable-line

  const setQAndSave = useCallback<React.Dispatch<React.SetStateAction<Question | null>>>(
    (updater) => {
      setEditingQ(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        if (next) scheduleQSave(next)
        return next
      })
    },
    [scheduleQSave],
  )

  function handleTitleChange(val: string) {
    setSurveyTitle(val)
    clearTimeout(titleSaveTimer.current)
    titleSaveTimer.current = setTimeout(() => saveTitle.mutate(), 1000)
  }

  function toggleRequired() {
    if (!editingQ) return
    const updated = { ...editingQ, required: !editingQ.required }
    setEditingQ(updated)
    updateQ.mutate(updated)
  }

  function handleDeleteQ() {
    if (!selectedId) return
    if (confirm('Delete this question?')) deleteQ.mutate(selectedId)
  }

  const shareUrl = survey ? `${window.location.origin}/s/${survey.slug}` : ''
  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const filteredCategories = typeSearch.trim()
    ? Q_CATEGORIES.map(c => ({
        ...c,
        types: c.types.filter(t =>
          t.label.toLowerCase().includes(typeSearch.toLowerCase()) ||
          t.desc.toLowerCase().includes(typeSearch.toLowerCase())
        ),
      })).filter(c => c.types.length > 0)
    : Q_CATEGORIES

  return (
    <div className="flex flex-col h-screen bg-paper">
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div className="h-14 flex items-center gap-3 px-4 border-b border-warm bg-paper shrink-0">
        <Link
          to="/surveys"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-dim hover:text-ink hover:bg-warm transition-all"
        >
          <ChevronLeft size={16} />
        </Link>
        <button
          type="button"
          onClick={() => setShowList(s => !s)}
          title="Toggle questions"
          className={cn(
            'md:hidden flex items-center justify-center w-8 h-8 rounded-lg transition-all',
            showList ? 'bg-violet/10 text-violet' : 'text-dim hover:text-ink hover:bg-warm',
          )}
        >
          <List size={15} />
        </button>
        <div className="w-px h-5 bg-warm" />
        <input
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[14px] font-medium text-ink placeholder:text-ghost font-sans"
          value={surveyTitle}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder="Survey title…"
        />
        {/* Auto-save indicator */}
        <div className="flex items-center gap-1 shrink-0 min-w-[64px] justify-end">
          {saveState === 'saving' && (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-dim">
              <Loader2 size={10} className="animate-spin" />Saving
            </span>
          )}
          {saveState === 'saved' && (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-600">
              <Check size={10} />Saved
            </span>
          )}
        </div>
        <StatusDot status={survey?.status ?? 'DRAFT'} />
        <div className="flex items-center gap-2 shrink-0">
          {survey?.status === 'ACTIVE' && (
            <a href={shareUrl} target="_blank" rel="noopener noreferrer">
              <button className="h-8 px-3 text-[13px] font-medium text-dim hover:text-ink border border-warm hover:border-ink rounded-lg transition-all inline-flex items-center gap-1.5">
                <ExternalLink size={13} />Preview
              </button>
            </a>
          )}
          <button
            onClick={() => toggleStatus.mutate()}
            className={cn(
              'h-8 px-4 text-[13px] font-medium rounded-lg transition-all',
              survey?.status === 'ACTIVE'
                ? 'bg-warm text-dim hover:bg-warm/80 border border-warm'
                : 'bg-violet text-white hover:opacity-90',
            )}
          >
            {survey?.status === 'ACTIVE' ? 'Pause' : 'Publish'}
          </button>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="create" className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="shrink-0 px-4">
          <TabsTrigger value="create">Create</TabsTrigger>
          <TabsTrigger value="share">Share</TabsTrigger>
          <TabsTrigger value="responses">Responses</TabsTrigger>
        </TabsList>

        {/* ── CREATE TAB ─────────────────────────────────────────────────────── */}
        <TabsContent value="create" className="flex flex-1 overflow-hidden m-0">

          {/* ── Left: Question list ────────────────────────────────────────── */}
          <aside className={cn(
            'shrink-0 border-r border-warm flex-col overflow-hidden bg-paper w-[220px]',
            showList ? 'flex' : 'hidden md:flex',
          )}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-warm">
              <span className="text-[11px] font-mono text-dim uppercase tracking-widest">Questions</span>
              <span className="text-[10px] font-mono bg-warm/80 text-dim px-1.5 py-0.5 rounded">
                {questions.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
              {questions.length === 0 && !pickingType && (
                <p className="text-[11px] font-mono text-dim text-center py-8 px-3">
                  No questions yet
                </p>
              )}
              {questions.map((q, i) => {
                const info = getTypeInfo(q.type)
                const Icon = info?.icon
                const isActive = selectedId === q.id && !pickingType
                return (
                  <button
                    key={q.id}
                    onClick={() => { setSelectedId(q.id); setPickingType(false) }}
                    className={cn(
                      'group w-full flex items-center gap-2 px-2 py-2.5 text-left rounded-lg transition-all relative',
                      isActive
                        ? 'bg-violet/10 text-ink'
                        : 'text-dim hover:bg-warm/60 hover:text-ink',
                    )}
                  >
                    {/* Active accent bar */}
                    <span className={cn(
                      'absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-all',
                      isActive ? 'bg-violet' : 'bg-transparent',
                    )} />
                    <span className="text-[10px] font-mono w-4 text-right opacity-40 shrink-0">
                      {q.type === 'DESCRIPTION_SLIDE' ? '—' : i + 1}
                    </span>
                    {Icon && (
                      <Icon size={12} className={cn('shrink-0', isActive ? 'text-violet' : 'text-dim')} />
                    )}
                    <span className={cn('text-[12px] truncate flex-1 leading-tight', isActive && 'font-medium')}>
                      {q.title}
                    </span>
                    {!!q.required && (
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', isActive ? 'bg-violet' : 'bg-violet/40')} />
                    )}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (confirm('Delete this question?')) deleteQ.mutate(q.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-dim hover:text-red-500 shrink-0"
                    >
                      <Trash2 size={11} />
                    </button>
                  </button>
                )
              })}

              {/* Add question — inline at end of list */}
              <button
                onClick={() => { setPickingType(true); setSelectedId(null) }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-2.5 text-left rounded-lg transition-all mt-1',
                  pickingType
                    ? 'bg-violet/15 text-violet'
                    : 'text-dim hover:bg-violet/5 hover:text-violet',
                )}
              >
                <span className={cn(
                  'w-[3px] h-5 rounded-r-full shrink-0',
                  pickingType ? 'bg-violet' : 'bg-transparent',
                )} />
                <Plus size={12} className="shrink-0 ml-4" />
                <span className="text-[12px] font-medium">Add question</span>
              </button>
            </div>
          </aside>

          {/* ── Canvas ─────────────────────────────────────────────────────── */}
          <div className={cn('flex-1 overflow-auto bg-warm/10', showList && 'hidden md:block')}>
            {pickingType ? (
              /* ── Type picker view ─────────────────────────────────────── */
              <div className="max-w-[800px] mx-auto px-6 py-8">
                <div className="flex items-center gap-3 mb-6">
                  {selectedId && (
                    <button
                      onClick={() => setPickingType(false)}
                      className="flex items-center justify-center w-8 h-8 rounded-lg text-dim hover:text-ink hover:bg-warm transition-all"
                    >
                      <ChevronLeft size={16} />
                    </button>
                  )}
                  <div>
                    <h2 className="font-serif text-[24px] text-ink">Add a question</h2>
                    <p className="text-[13px] text-dim mt-0.5">Choose the format that best fits your question</p>
                  </div>
                </div>

                {/* Search */}
                <div className="relative mb-7">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                  <input
                    className="w-full h-10 pl-9 pr-9 bg-paper border border-warm rounded-xl text-[13px] text-ink placeholder:text-ghost focus:outline-none focus:border-violet transition-colors"
                    placeholder="Search question types…"
                    value={typeSearch}
                    onChange={e => setTypeSearch(e.target.value)}
                    autoFocus
                  />
                  {typeSearch && (
                    <button
                      onClick={() => setTypeSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-ink transition-colors"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Categories + tiles */}
                <div className="space-y-7">
                  {filteredCategories.map(cat => (
                    <div key={cat.label}>
                      <div className="flex items-center gap-3 mb-3">
                        <span className={cn(
                          'text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full font-medium',
                          cat.iconColor,
                        )}>
                          {cat.label}
                        </span>
                        <div className="flex-1 h-px bg-warm" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {cat.types.map(t => {
                          const Icon = t.icon
                          return (
                            <button
                              key={t.type}
                              onClick={() => addQ.mutate(t.type)}
                              disabled={addQ.isPending}
                              className="group flex items-start gap-3 p-3.5 bg-paper border border-warm rounded-xl hover:border-violet hover:shadow-sm hover:bg-violet/5 transition-all text-left disabled:opacity-50"
                            >
                              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5', cat.iconColor)}>
                                <Icon size={15} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-ink group-hover:text-violet transition-colors leading-tight">
                                  {t.label}
                                </p>
                                <p className="text-[11px] text-dim mt-0.5 leading-tight">{t.desc}</p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  {filteredCategories.length === 0 && (
                    <div className="text-center py-16">
                      <p className="text-[14px] text-dim">No types match "{typeSearch}"</p>
                      <button onClick={() => setTypeSearch('')} className="text-[12px] font-mono text-dim hover:text-ink mt-2 underline underline-offset-2 transition-colors">
                        Clear search
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : selected && editingQ ? (
              /* ── Inline question editor ───────────────────────────────── */
              <div className="max-w-[680px] mx-auto px-6 py-10">
                <div className="bg-paper rounded-2xl border border-warm shadow-sm overflow-hidden">
                  {/* Card header */}
                  <div className="flex items-center gap-3 px-5 py-3 border-b border-warm bg-warm/20">
                    {(() => {
                      const info = getTypeInfo(selected.type)
                      const Icon = info?.icon
                      return (
                        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono', info?.iconColor ?? 'bg-violet/10 text-violet')}>
                          {Icon && <Icon size={11} />}{info?.label ?? selected.type}
                        </span>
                      )
                    })()}
                    <div className="ml-auto flex items-center gap-2">
                      {saveState === 'saving' && (
                        <span className="flex items-center gap-1.5 text-[11px] font-mono text-dim">
                          <Loader2 size={10} className="animate-spin" />Saving
                        </span>
                      )}
                      {saveState === 'saved' && (
                        <span className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-600">
                          <Check size={10} />Saved
                        </span>
                      )}
                      <button
                        onClick={handleDeleteQ}
                        className="h-7 w-7 flex items-center justify-center rounded-lg text-dim hover:text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Inline editing */}
                  <div className="px-7 pt-7 pb-8">
                    <input
                      className="w-full bg-transparent border-none outline-none text-[22px] font-serif text-ink placeholder:text-ghost/50 leading-snug block mb-2"
                      value={editingQ.title}
                      onChange={e => setQAndSave(q => q ? { ...q, title: e.target.value } : q)}
                      placeholder="Type your question here…"
                    />
                    {!!editingQ.required && (
                      <span className="inline-block text-violet text-[16px] font-serif -mt-1 mb-1">*</span>
                    )}
                    <input
                      className="w-full bg-transparent border-none outline-none text-[14px] text-dim placeholder:text-ghost/40 block mb-8"
                      value={editingQ.description ?? ''}
                      onChange={e => setQAndSave(q => q ? { ...q, description: e.target.value } : q)}
                      placeholder="Add a description or helper text (optional)…"
                    />
                    <QuestionPreview q={editingQ} />
                  </div>
                </div>

                {/* Prev / Next navigation */}
                <div className="flex items-center justify-between mt-4 px-1">
                  <button
                    onClick={() => selectedIdx > 0 && setSelectedId(questions[selectedIdx - 1].id)}
                    disabled={selectedIdx <= 0}
                    className="text-[12px] font-mono text-dim hover:text-ink disabled:opacity-25 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <ChevronLeft size={13} /> Prev
                  </button>
                  <span className="text-[11px] font-mono text-dim">
                    {selectedIdx + 1} / {questions.length}
                  </span>
                  <button
                    onClick={() => selectedIdx < questions.length - 1 && setSelectedId(questions[selectedIdx + 1].id)}
                    disabled={selectedIdx >= questions.length - 1}
                    className="text-[12px] font-mono text-dim hover:text-ink disabled:opacity-25 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    Next <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            ) : (
              /* ── Empty state ──────────────────────────────────────────── */
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-sm px-6">
                  <div className="w-16 h-16 rounded-2xl bg-violet/10 flex items-center justify-center mx-auto mb-5">
                    <Plus size={28} className="text-violet" />
                  </div>
                  <h3 className="font-serif text-[22px] text-ink mb-2">Build your survey</h3>
                  <p className="text-[13px] text-dim leading-relaxed mb-6">
                    Start adding questions. Choose from 16 types — from voice recordings to star ratings.
                  </p>
                  <button
                    onClick={() => setPickingType(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet text-white rounded-xl text-[14px] font-medium hover:opacity-90 transition-all shadow-sm"
                  >
                    <Plus size={16} /> Add first question
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Properties panel ───────────────────────────────────── */}
          {editingQ && !pickingType && (
            <aside className="hidden md:flex md:flex-col w-[260px] shrink-0 border-l border-warm overflow-y-auto bg-paper">
              <div className="px-4 py-3 border-b border-warm">
                <span className="text-[11px] font-mono text-dim uppercase tracking-widest">Settings</span>
              </div>
              <div className="p-4 space-y-5">

                {/* Required toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Required</p>
                    <p className="text-[11px] text-dim mt-0.5">Must be answered</p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleRequired}
                    className={cn(
                      'w-11 h-6 rounded-full border-2 transition-all relative shrink-0 cursor-pointer',
                      editingQ.required ? 'bg-violet border-violet' : 'bg-warm border-ghost/60',
                    )}
                  >
                    <span className={cn(
                      'absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full shadow-sm transition-all duration-200',
                      editingQ.required ? 'right-[2px] bg-white' : 'left-[2px] bg-ghost',
                    )} />
                  </button>
                </div>

                <div className="h-px bg-warm" />

                {/* Description */}
                <div>
                  <label className="block text-[11px] font-mono text-dim uppercase tracking-widest mb-2">Helper text</label>
                  <input
                    className="w-full px-3 py-2 border border-warm text-[13px] text-ink font-sans bg-paper focus:outline-none focus:border-violet transition-colors rounded-lg"
                    value={editingQ.description ?? ''}
                    onChange={e => setQAndSave(q => q ? { ...q, description: e.target.value } : q)}
                    placeholder="Optional description…"
                  />
                </div>

                {/* Type-specific settings */}
                <TypeSettings q={editingQ} setQ={setQAndSave} />
              </div>
            </aside>
          )}
        </TabsContent>

        {/* ── SHARE TAB ────────────────────────────────────────────────────── */}
        <TabsContent value="share" className="overflow-auto">
          <div className="max-w-lg mx-auto px-8 py-10 space-y-6">
            <div>
              <h2 className="font-serif text-[24px] tracking-tight text-ink mb-1">Share survey</h2>
              <p className="text-[13px] text-dim">Distribute your survey via link, QR code, or embed.</p>
            </div>

            <div className="rounded-xl border border-warm overflow-hidden">
              <div className="px-4 py-3 border-b border-warm bg-warm/20">
                <p className="text-[11px] font-mono text-dim uppercase tracking-widest">Status</p>
              </div>
              <div className="px-4 py-4 flex items-center justify-between">
                <StatusDot status={survey?.status ?? 'DRAFT'} />
                <button
                  onClick={() => toggleStatus.mutate()}
                  className="h-8 px-4 text-[13px] font-medium rounded-lg border border-warm text-dim hover:text-ink hover:border-ink transition-all"
                >
                  {survey?.status === 'ACTIVE' ? 'Pause collection' : 'Start collecting'}
                </button>
              </div>
            </div>

            {survey?.status === 'ACTIVE' ? (
              <>
                <div className="rounded-xl border border-warm overflow-hidden">
                  <div className="px-4 py-3 border-b border-warm bg-warm/20">
                    <p className="text-[11px] font-mono text-dim uppercase tracking-widest">Survey link</p>
                  </div>
                  <div className="px-4 py-4 space-y-3">
                    <div className="flex items-center gap-2 px-3 py-2 bg-warm/40 border border-warm rounded-lg">
                      <span className="flex-1 text-[12px] font-mono text-dim truncate">{shareUrl}</span>
                      <button onClick={copyLink} className="shrink-0 text-dim hover:text-ink transition-colors p-1">
                        <Copy size={13} />
                      </button>
                    </div>
                    {copied && <p className="text-[11px] font-mono text-emerald-600">Copied to clipboard</p>}
                    <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                      <button className="w-full h-9 text-[13px] font-medium rounded-lg border border-warm text-dim hover:text-ink hover:border-ink transition-all inline-flex items-center justify-center gap-1.5">
                        <ExternalLink size={13} />Open survey
                      </button>
                    </a>
                  </div>
                </div>

                <div className="rounded-xl border border-warm overflow-hidden">
                  <div className="px-4 py-3 border-b border-warm bg-warm/20">
                    <p className="text-[11px] font-mono text-dim uppercase tracking-widest">QR Code</p>
                  </div>
                  <div className="px-4 py-6 flex flex-col items-center gap-3">
                    <div className="w-28 h-28 rounded-xl border border-warm flex items-center justify-center bg-warm/20">
                      <QrCode size={48} className="text-dim opacity-40" />
                    </div>
                    <p className="text-[11px] font-mono text-dim text-center">QR code generation available in Pro plan</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-warm/60 px-5 py-8 text-center">
                <p className="font-serif text-[18px] text-dim mb-1">Survey is not active</p>
                <p className="text-[13px] text-dim">Publish the survey first to access sharing options.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── RESPONSES TAB ────────────────────────────────────────────────── */}
        <TabsContent value="responses" className="overflow-auto">
          <SurveyResponses surveyId={id ?? ''} surveySlug={survey?.slug ?? ''} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Type-specific settings ─────────────────────────────────────────────────────
function TypeSettings({ q, setQ }: { q: Question; setQ: React.Dispatch<React.SetStateAction<Question | null>> }) {
  const setOpts = (patch: Record<string, unknown>) =>
    setQ(prev => {
      if (!prev) return prev
      const cur = parseOptions(prev.options)
      return { ...prev, options: { ...cur, ...patch } }
    })

  const fieldCls = 'w-full px-3 py-2 border border-warm text-[13px] text-ink font-sans bg-paper focus:outline-none focus:border-violet transition-colors rounded-lg'
  const labelCls = 'block text-[11px] font-mono text-dim uppercase tracking-widest mb-2'

  if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE' || q.type === 'DROPDOWN') {
    const choices = (q.options?.choices as { id: string; label: string }[]) ?? [
      { id: '1', label: 'Option A' },
      { id: '2', label: 'Option B' },
    ]
    return (
      <div>
        <div className="h-px bg-warm mb-5" />
        <label className={labelCls}>Choices</label>
        <div className="space-y-2">
          {choices.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2">
              <input
                className={cn(fieldCls, 'flex-1')}
                value={c.label}
                onChange={e => {
                  const updated = choices.map((x, j) => j === i ? { ...x, label: e.target.value } : x)
                  setOpts({ choices: updated })
                }}
              />
              <button
                onClick={() => setOpts({ choices: choices.filter((_, j) => j !== i) })}
                className="p-1.5 text-dim hover:text-red-400 rounded transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setOpts({ choices: [...choices, { id: Date.now().toString(), label: `Option ${choices.length + 1}` }] })}
            className="text-[12px] font-mono text-dim hover:text-violet transition-colors mt-1 flex items-center gap-1"
          >
            <Plus size={11} /> Add option
          </button>
        </div>
      </div>
    )
  }

  if (q.type === 'STAR_RATING') {
    const max = (q.options?.max as number) ?? 5
    return (
      <div>
        <div className="h-px bg-warm mb-5" />
        <label className={labelCls}>Max stars</label>
        <div className="flex rounded-lg border border-warm overflow-hidden">
          {[3, 5, 7, 10].map(n => (
            <button
              key={n}
              onClick={() => setOpts({ max: n })}
              className={cn(
                'flex-1 py-2 text-[13px] font-mono transition-colors border-r border-warm last:border-r-0',
                max === n ? 'bg-violet text-white' : 'text-dim hover:text-ink hover:bg-warm/40',
              )}
            >
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
      <div className="space-y-4">
        <div className="h-px bg-warm" />
        <div>
          <label className={labelCls}>Scale range</label>
          <div className="flex gap-2 items-center text-[13px] font-mono text-dim">
            <input type="number" className={cn(fieldCls, 'w-16 text-center')}
              value={opts?.min ?? 1} min={1} max={5}
              onChange={e => setOpts({ min: Number(e.target.value) })} />
            <span className="text-dim">to</span>
            <input type="number" className={cn(fieldCls, 'w-16 text-center')}
              value={opts?.max ?? 5} min={2} max={10}
              onChange={e => setOpts({ max: Number(e.target.value) })} />
          </div>
        </div>
        <div className="space-y-2">
          <label className={labelCls}>End labels</label>
          <input className={fieldCls} placeholder="Low label" value={opts?.minLabel ?? ''} onChange={e => setOpts({ minLabel: e.target.value })} />
          <input className={fieldCls} placeholder="High label" value={opts?.maxLabel ?? ''} onChange={e => setOpts({ maxLabel: e.target.value })} />
        </div>
      </div>
    )
  }

  if (q.type === 'YES_NO') {
    const opts = q.options as { yesLabel?: string; noLabel?: string } | undefined
    return (
      <div className="space-y-3">
        <div className="h-px bg-warm" />
        <label className={labelCls}>Button labels</label>
        <input className={fieldCls} placeholder="Yes" value={opts?.yesLabel ?? ''} onChange={e => setOpts({ yesLabel: e.target.value })} />
        <input className={fieldCls} placeholder="No" value={opts?.noLabel ?? ''} onChange={e => setOpts({ noLabel: e.target.value })} />
      </div>
    )
  }

  if (q.type === 'NUMERIC') {
    const opts = q.options as { min?: number; max?: number; unit?: string } | undefined
    return (
      <div className="space-y-4">
        <div className="h-px bg-warm" />
        <div>
          <label className={labelCls}>Range</label>
          <div className="flex gap-2 items-center">
            <input type="number" className={cn(fieldCls, 'flex-1')} placeholder="Min" value={opts?.min ?? ''} onChange={e => setOpts({ min: Number(e.target.value) })} />
            <span className="text-dim text-[13px]">–</span>
            <input type="number" className={cn(fieldCls, 'flex-1')} placeholder="Max" value={opts?.max ?? ''} onChange={e => setOpts({ max: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Unit</label>
          <input className={fieldCls} placeholder="e.g. kg, km, $" value={opts?.unit ?? ''} onChange={e => setOpts({ unit: e.target.value })} />
        </div>
      </div>
    )
  }

  if (q.type === 'VOICE_RESPONSE' || q.type === 'AUDIO_CAPTURE' || q.type === 'AUDIO_QUESTION') {
    const opts = q.options as { minDurationSec?: number; maxDurationSec?: number; minDbfs?: number; minSnrDb?: number } | undefined
    return (
      <div className="space-y-4">
        <div className="h-px bg-warm" />
        <div>
          <label className={labelCls}>Min duration (sec)</label>
          <input type="number" className={fieldCls}
            value={opts?.minDurationSec ?? 15} min={5}
            onChange={e => setOpts({ minDurationSec: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Max duration (sec)</label>
          <input type="number" className={fieldCls}
            value={opts?.maxDurationSec ?? 300} min={30}
            onChange={e => setOpts({ maxDurationSec: Number(e.target.value) })} />
        </div>
        <div className="h-px bg-warm" />
        <p className="text-[10px] font-mono text-dim uppercase tracking-widest">Quality thresholds</p>
        <div>
          <label className={labelCls}>Min volume level (dBFS)</label>
          <input type="number" className={fieldCls}
            value={opts?.minDbfs ?? -18} min={-60} max={0}
            onChange={e => setOpts({ minDbfs: Number(e.target.value) })} />
          <p className="text-[10px] text-dim mt-1">How loud the recording must be. −18 is a good default; lower = more lenient.</p>
        </div>
        <div>
          <label className={labelCls}>Min signal-to-noise ratio (dB)</label>
          <input type="number" className={fieldCls}
            value={opts?.minSnrDb ?? 15} min={0} max={60}
            onChange={e => setOpts({ minSnrDb: Number(e.target.value) })} />
          <p className="text-[10px] text-dim mt-1">How clean the recording must be. 15 dB is a good default; lower = more lenient.</p>
        </div>
      </div>
    )
  }

  if (q.type === 'MATRIX') {
    const opts = q.options as { rows?: string[]; columns?: string[] } | undefined
    const rows = opts?.rows ?? ['Row 1', 'Row 2']
    const cols = opts?.columns ?? ['Column 1', 'Column 2', 'Column 3']
    return (
      <div className="space-y-4">
        <div className="h-px bg-warm" />
        <div>
          <label className={labelCls}>Rows</label>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input className={cn(fieldCls, 'flex-1')} value={r}
                  onChange={e => { const u = [...rows]; u[i] = e.target.value; setOpts({ rows: u }) }} />
                <button onClick={() => setOpts({ rows: rows.filter((_, j) => j !== i) })} className="p-1.5 text-dim hover:text-red-400 rounded transition-colors"><Trash2 size={12} /></button>
              </div>
            ))}
            <button onClick={() => setOpts({ rows: [...rows, `Row ${rows.length + 1}`] })}
              className="text-[12px] font-mono text-dim hover:text-violet transition-colors flex items-center gap-1">
              <Plus size={11} /> Add row
            </button>
          </div>
        </div>
        <div>
          <label className={labelCls}>Columns</label>
          <div className="space-y-2">
            {cols.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input className={cn(fieldCls, 'flex-1')} value={c}
                  onChange={e => { const u = [...cols]; u[i] = e.target.value; setOpts({ columns: u }) }} />
                <button onClick={() => setOpts({ columns: cols.filter((_, j) => j !== i) })} className="p-1.5 text-dim hover:text-red-400 rounded transition-colors"><Trash2 size={12} /></button>
              </div>
            ))}
            <button onClick={() => setOpts({ columns: [...cols, `Column ${cols.length + 1}`] })}
              className="text-[12px] font-mono text-dim hover:text-violet transition-colors flex items-center gap-1">
              <Plus size={11} /> Add column
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (q.type === 'FILE_UPLOAD') {
    const opts = q.options as { accept?: string; maxMB?: number } | undefined
    return (
      <div className="space-y-4">
        <div className="h-px bg-warm" />
        <div>
          <label className={labelCls}>Accepted file types</label>
          <input className={fieldCls} placeholder="e.g. .pdf,.docx,image/*" value={opts?.accept ?? ''} onChange={e => setOpts({ accept: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Max size (MB)</label>
          <input type="number" className={fieldCls} value={opts?.maxMB ?? 10} min={1} max={100} onChange={e => setOpts({ maxMB: Number(e.target.value) })} />
        </div>
      </div>
    )
  }

  return null
}

// ── Canvas question preview ────────────────────────────────────────────────────
function QuestionPreview({ q }: { q: Question }) {
  if (q.type === 'DESCRIPTION_SLIDE') return (
    <div className="flex items-center gap-4 my-2">
      <hr className="flex-1 border-warm" />
      <span className="text-[11px] font-mono text-dim uppercase tracking-widest">{q.title}</span>
      <hr className="flex-1 border-warm" />
    </div>
  )
  if (q.type === 'VOICE_RESPONSE' || q.type === 'AUDIO_CAPTURE' || q.type === 'AUDIO_QUESTION') return (
    <div className="flex flex-col items-center gap-4 py-8 rounded-xl border border-warm bg-warm/10">
      <div className="w-14 h-14 rounded-xl border border-warm bg-paper flex items-center justify-center text-dim shadow-sm">
        <Mic size={24} />
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        {['WAV 16kHz', `Min ${(q.options as { minDurationSec?: number })?.minDurationSec ?? 15}s`, 'QC enabled'].map(b => (
          <span key={b} className="text-[10px] font-mono border border-warm px-2 py-1 rounded-full text-dim bg-paper">{b}</span>
        ))}
      </div>
      <p className="text-[12px] font-mono text-dim">Tap to record</p>
    </div>
  )
  if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE' || q.type === 'DROPDOWN') {
    const choices = (q.options as { choices?: { id: string; label: string }[] })?.choices ?? [
      { id: '1', label: 'Option A' },
      { id: '2', label: 'Option B' },
    ]
    const isCheck = q.type === 'MULTIPLE_CHOICE'
    if (q.type === 'DROPDOWN') return (
      <div className="flex items-center justify-between h-11 border border-warm rounded-lg px-4 text-[14px] text-dim bg-warm/10">
        <span>Select an option…</span>
        <ChevronDown size={14} className="text-dim" />
      </div>
    )
    return (
      <div className="space-y-2">
        {choices.map(c => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3 border border-warm rounded-lg hover:border-ink transition-colors cursor-pointer">
            <div className={cn('w-4 h-4 border border-ghost shrink-0', isCheck ? 'rounded' : 'rounded-full')} />
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
        <div className="flex-1 py-4 border border-warm rounded-lg text-center text-[15px] text-dim hover:border-ink cursor-pointer transition-colors">{opts?.yesLabel ?? 'Yes'}</div>
        <div className="flex-1 py-4 border border-warm rounded-lg text-center text-[15px] text-dim hover:border-ink cursor-pointer transition-colors">{opts?.noLabel ?? 'No'}</div>
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
            <div key={v} className="flex-1 h-11 border border-warm rounded-lg flex items-center justify-center font-mono text-[13px] text-dim hover:border-ink cursor-pointer transition-colors">{v}</div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] font-mono text-dim">
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
          <Star key={i} size={22} className={i < 3 ? 'text-amber-400 fill-amber-400' : 'text-warm fill-warm'} />
        ))}
      </div>
    )
  }
  if (q.type === 'MATRIX') {
    const opts = q.options as { rows?: string[]; columns?: string[] } | undefined
    const rows = opts?.rows ?? ['Row 1', 'Row 2']
    const cols = opts?.columns ?? ['Col 1', 'Col 2', 'Col 3']
    return (
      <div className="overflow-x-auto rounded-lg border border-warm">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-warm/20">
              <th className="border-b border-r border-warm px-3 py-2 text-left text-dim font-mono font-normal" />
              {cols.map(c => <th key={c} className="border-b border-r border-warm last:border-r-0 px-3 py-2 text-dim font-mono font-normal">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r} className="border-b border-warm last:border-b-0">
                <td className="border-r border-warm px-3 py-2.5 text-dim font-mono">{r}</td>
                {cols.map(c => (
                  <td key={c} className="border-r border-warm last:border-r-0 px-3 py-2.5 text-center">
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
      <div className="border-2 border-dashed border-warm rounded-xl p-8 flex flex-col items-center gap-2 bg-warm/5">
        <Upload size={24} className="text-dim opacity-40" />
        <p className="text-[13px] text-dim">Drag & drop or click to upload</p>
        <p className="text-[11px] font-mono text-dim">{opts?.accept ?? 'Any file'} · Max {opts?.maxMB ?? 10}MB</p>
      </div>
    )
  }
  if (q.type === 'NAME') return (
    <div className="flex gap-3">
      <div className="flex-1 h-11 border border-warm rounded-lg flex items-center px-4 text-dim text-[13px] font-mono">First name</div>
      <div className="flex-1 h-11 border border-warm rounded-lg flex items-center px-4 text-dim text-[13px] font-mono">Last name</div>
    </div>
  )
  if (q.type === 'NUMERIC') {
    const unit = (q.options as { unit?: string })?.unit
    return (
      <div className="flex items-center h-11 border border-warm rounded-lg overflow-hidden">
        <input className="flex-1 h-full px-4 bg-transparent text-dim text-[13px] font-mono outline-none" placeholder="0" readOnly />
        {unit && <span className="px-3 h-full flex items-center border-l border-warm text-[12px] font-mono text-dim bg-warm/20">{unit}</span>}
      </div>
    )
  }
  if (q.type === 'VIDEO_CAPTURE') return (
    <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-warm bg-warm/10">
      <div className="w-14 h-14 rounded-xl border border-warm bg-paper flex items-center justify-center text-dim shadow-sm"><Video size={24} /></div>
      <p className="text-[12px] font-mono text-dim">Tap to record video</p>
    </div>
  )
  return (
    <div className="h-11 border border-warm rounded-lg flex items-center px-4 text-dim text-[13px] font-mono">
      {q.type.replace(/_/g, ' ').toLowerCase()}
    </div>
  )
}

// ── Types for inline responses ────────────────────────────────────────────────
interface SessionRow { id: string; status: string; created_at: string; respondent_ref?: string }
interface RespRow {
  id: string; session_id: string; question_id: string; type: string; status: string
  text_value?: string | null; audio_url?: string | null; audio_wav_url?: string | null
  audio_duration_sec?: number | null; qc_result?: string | null; transcript?: string | null
  extracted_value?: string | null; confidence_score?: number | null
}
const AUDIO_Q_TYPES = new Set(['VOICE_RESPONSE', 'AUDIO_CAPTURE', 'AUDIO_QUESTION'])
function fmtDur(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function normAudioSrc(url: string | null | undefined) {
  if (!url) return null
  return url.replace(/^https?:\/\/localhost:\d+/, '')
}

function InlineMiniPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false)
  const [el, setEl] = useState<HTMLAudioElement | null>(null)
  return (
    <div className="flex items-center gap-2">
      <button type="button"
        onClick={() => { if (!el) return; playing ? el.pause() : el.play(); setPlaying(p => !p) }}
        className="w-7 h-7 rounded-full border border-warm flex items-center justify-center text-dim hover:border-violet hover:text-violet transition-all shrink-0"
      >
        {playing ? <Pause size={11} /> : <Play size={11} />}
      </button>
      <audio ref={setEl} src={src} onEnded={() => setPlaying(false)} className="hidden" />
      <div className="flex-1 h-1 bg-warm rounded-full min-w-[50px]" />
    </div>
  )
}

// ── Inline responses panel ─────────────────────────────────────────────────────
function SurveyResponses({ surveyId }: { surveyId: string; surveySlug: string }) {
  const qc = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)

  const { data: qData = [] } = useQuery<{ id: string; type: string; title: string; order_index: number }[]>({
    queryKey: ['questions', surveyId],
    queryFn: () => api.get(`/surveys/${surveyId}/questions`),
    enabled: !!surveyId,
  })
  const questions = [...qData].sort((a, b) => a.order_index - b.order_index)

  const { data: sessData } = useQuery({
    queryKey: ['sessions', surveyId],
    queryFn: () => api.get<{ data: SessionRow[] }>(`/sessions?surveyId=${surveyId}&pageSize=200`),
    enabled: !!surveyId,
  })
  const sessions: SessionRow[] = (sessData as { data: SessionRow[] } | null)?.data ?? []

  const { data: respData, isLoading } = useQuery({
    queryKey: ['survey-responses', surveyId],
    queryFn: () => api.get<{ data: RespRow[] }>(`/responses?surveyId=${surveyId}&pageSize=500`),
    enabled: !!surveyId,
  })
  const allResponses: RespRow[] = (respData as { data: RespRow[] } | null)?.data ?? []

  const bySession: Record<string, RespRow[]> = {}
  for (const r of allResponses) {
    if (!bySession[r.session_id]) bySession[r.session_id] = []
    bySession[r.session_id].push(r)
  }

  const approveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/responses/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['survey-responses', surveyId] }),
  })
  const rejectMut = useMutation({
    mutationFn: (id: string) => api.patch(`/responses/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['survey-responses', surveyId] }),
  })

  const completedCount = sessions.filter(s => s.status === 'COMPLETED').length
  const audioCount = allResponses.filter(r => AUDIO_Q_TYPES.has(r.type)).length

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-serif text-[24px] tracking-tight text-ink">Responses</h2>
          {sessions.length > 0 && (
            <p className="text-[13px] text-dim font-mono mt-0.5">
              {sessions.length} respondents · {completedCount} completed
              {audioCount > 0 && ` · ${audioCount} audio`}
            </p>
          )}
        </div>
        <Link to="/responses">
          <button className="h-8 px-3 text-[13px] font-medium rounded-lg border border-warm text-dim hover:text-ink hover:border-ink transition-all inline-flex items-center gap-1.5">
            View all <ChevronRight size={13} />
          </button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-warm/40 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-warm px-5 py-12 text-center">
          <p className="font-serif text-[18px] text-dim mb-1">No responses yet</p>
          <p className="text-[13px] text-dim">Responses appear here once your survey is submitted.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-warm overflow-hidden shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-warm/30 border-b border-warm">
                <th className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest w-10">#</th>
                <th className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest whitespace-nowrap">Date</th>
                <th className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest">Status</th>
                <th className="px-4 py-3 text-[10px] font-mono text-dim uppercase tracking-widest">Answers</th>
                <th className="w-8" aria-label="Expand" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((sess, idx) => {
                const sessResp = bySession[sess.id] ?? []
                const isOpen = openId === sess.id
                const hasAudio = sessResp.some(r => AUDIO_Q_TYPES.has(r.type))
                const answerMap = Object.fromEntries(sessResp.map(r => [r.question_id, r]))

                return (
                  <>
                    <tr
                      key={sess.id}
                      onClick={() => setOpenId(isOpen ? null : sess.id)}
                      className={cn(
                        'cursor-pointer border-b border-warm transition-colors',
                        isOpen ? 'bg-violet/5' : 'hover:bg-warm/30',
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[12px] text-dim">{idx + 1}</span>
                          {hasAudio && <Mic size={10} className="text-violet opacity-60" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-[12px] text-dim font-mono">
                          {new Date(sess.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center px-2.5 py-1 text-[11px] font-mono font-medium rounded-full',
                          sess.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : sess.status === 'IN_PROGRESS' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-warm text-dim',
                        )}>
                          {sess.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px] font-mono text-dim">
                          {sessResp.length}/{questions.length}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-dim">
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr key={`${sess.id}-detail`} className="border-b border-warm">
                        <td colSpan={5} className="p-0">
                          <div className="px-5 py-5 bg-warm/5 border-t border-warm space-y-5">
                            {questions.map((q, qi) => {
                              const r = answerMap[q.id]
                              const isAudio = r && AUDIO_Q_TYPES.has(r.type)
                              const audioSrcUrl = isAudio ? normAudioSrc(r.audio_wav_url || r.audio_url) : null

                              return (
                                <div key={q.id} className="flex gap-4 items-start">
                                  <span className="text-[10px] font-mono text-dim w-5 shrink-0 text-right mt-0.5">{qi + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12px] text-dim mb-1.5">{q.title}</p>
                                    {!r ? (
                                      <p className="text-[13px] text-dim italic">No response</p>
                                    ) : isAudio ? (
                                      <div className="space-y-2">
                                        {audioSrcUrl
                                          ? <InlineMiniPlayer src={audioSrcUrl} />
                                          : <p className="text-[12px] font-mono text-dim">Audio pending processing…</p>
                                        }
                                        {r.audio_duration_sec != null && (
                                          <p className="text-[11px] font-mono text-dim">
                                            Duration: {fmtDur(r.audio_duration_sec)}
                                          </p>
                                        )}
                                        {r.transcript && (
                                          <div className="pl-3 border-l-2 border-warm">
                                            <p className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Transcript</p>
                                            <p className="text-[13px] text-ink leading-relaxed">
                                              {(() => { try { return JSON.parse(r.transcript).text ?? r.transcript } catch { return r.transcript } })()}
                                            </p>
                                          </div>
                                        )}
                                        {r.status === 'SUBMITTED' && (
                                          <div className="flex gap-2 pt-1">
                                            <button type="button" onClick={() => approveMut.mutate(r.id)}
                                              disabled={approveMut.isPending || rejectMut.isPending}
                                              className="px-3 py-1 rounded-lg text-[12px] font-mono border border-warm hover:border-emerald-400 hover:text-emerald-600 text-dim transition-all disabled:opacity-40">
                                              Approve
                                            </button>
                                            <button type="button" onClick={() => rejectMut.mutate(r.id)}
                                              disabled={approveMut.isPending || rejectMut.isPending}
                                              className="px-3 py-1 rounded-lg text-[12px] font-mono border border-warm hover:border-red-400 hover:text-red-500 text-dim transition-all disabled:opacity-40">
                                              Reject
                                            </button>
                                          </div>
                                        )}
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
                                    ) : (
                                      <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{r.text_value}</p>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
