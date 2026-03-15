import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Question {
  id: string; type: string; title: string; description?: string
  required: boolean; order: number; options?: Record<string, unknown>
}
interface Survey {
  id: string; title: string; description?: string; slug: string
  config?: unknown; questions: Question[]
}

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

// ── WAV encoder ────────────────────────────────────────────────────────────────
function _writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}
function _encodeWav(audioBuffer: AudioBuffer): Blob {
  const sr = audioBuffer.sampleRate
  const samples = audioBuffer.getChannelData(0)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++)
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
  const buf = new ArrayBuffer(44 + pcm.buffer.byteLength)
  const v = new DataView(buf)
  _writeStr(v, 0, 'RIFF'); v.setUint32(4, 36 + pcm.buffer.byteLength, true)
  _writeStr(v, 8, 'WAVE'); _writeStr(v, 12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  _writeStr(v, 36, 'data'); v.setUint32(40, pcm.buffer.byteLength, true)
  new Int16Array(buf, 44).set(pcm)
  return new Blob([buf], { type: 'audio/wav' })
}
async function _blobToWav(blob: Blob, targetSr = 16000): Promise<Blob> {
  try {
    const arrayBuf = await blob.arrayBuffer()
    const decodeCtx = new AudioContext()
    const decoded = await decodeCtx.decodeAudioData(arrayBuf)
    await decodeCtx.close()
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSr), targetSr)
    const src = offlineCtx.createBufferSource()
    src.buffer = decoded; src.connect(offlineCtx.destination); src.start()
    const rendered = await offlineCtx.startRendering()
    return _encodeWav(rendered)
  } catch {
    return blob // fallback: return original if conversion fails
  }
}

// ── Submit helpers ─────────────────────────────────────────────────────────────
async function startSession(slug: string): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/public/surveys/${slug}/session`, { method: 'POST' })
    if (!r.ok) return null
    const d = await r.json()
    return d.data?.sessionId ?? d.sessionId ?? null
  } catch { return null }
}

interface AudioValue { blob: Blob; blobUrl: string; duration: number; mimeType: string; qcResult?: Record<string, number> }

async function submitResponse(sessionId: string, q: Question, value: unknown): Promise<string | null> {
  try {
    const body: Record<string, unknown> = { questionId: q.id, type: q.type }
    if (q.type !== 'VOICE_RESPONSE' && q.type !== 'AUDIO_CAPTURE' && q.type !== 'AUDIO_QUESTION') {
      if (value instanceof File) {
        body.textValue = value.name  // store filename; actual upload via separate route if needed
      } else {
        body.textValue = typeof value === 'string' ? value : JSON.stringify(value)
      }
    } else {
      body.audioDurationSec = (value as AudioValue)?.duration ?? 0
    }
    const r = await fetch(`${BASE}/public/sessions/${sessionId}/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    const d = await r.json()
    return d.data?.responseId ?? d.responseId ?? null
  } catch { return null }
}

async function uploadAudio(responseId: string, blob: Blob, mimeType: string, qcResult?: Record<string, number>) {
  try {
    const slotRes = await fetch(`${BASE}/public/audio/slot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responseId, mimeType }),
    })
    if (!slotRes.ok) return
    const slotData = await slotRes.json()
    const uploadId = slotData.data?.uploadId ?? slotData.uploadId
    if (!uploadId) return
    const fd = new FormData()
    fd.append('file', blob, 'audio.wav')
    fd.append('responseId', responseId)
    if (qcResult) fd.append('clientQcResult', JSON.stringify(qcResult))
    await fetch(`${BASE}/public/audio/upload/${uploadId}`, { method: 'POST', body: fd })
  } catch { /* best effort */ }
}

async function uploadImage(responseId: string, file: File) {
  try {
    const fd = new FormData()
    fd.append('file', file, file.name)
    await fetch(`${BASE}/public/images/upload/${responseId}`, { method: 'POST', body: fd })
  } catch { /* best effort */ }
}

async function completeSession(sessionId: string) {
  try { await fetch(`${BASE}/public/sessions/${sessionId}/complete`, { method: 'PATCH' }) }
  catch { /* best effort */ }
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function CollectPage() {
  const { slug } = useParams<{ slug: string }>()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`${BASE}/public/surveys/${slug}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setSurvey(d.data ?? d))
      .catch(() => setError('Survey not found or no longer active.'))
  }, [slug])

  if (error) return <FullMessage text={error} />
  if (!survey) return <FullMessage text="Loading…" spinner />

  const questions = survey.questions ?? []
  const total = questions.length
  const isIntro = step === 0
  const isDone = step > total

  function answer(qid: string, value: unknown) {
    setAnswers(a => ({ ...a, [qid]: value }))
  }

  async function handleStart() {
    const sid = await startSession(slug!)
    setSessionId(sid)
    setStep(1)
  }

  function back() { setStep(s => Math.max(0, s - 1)) }

  async function next() {
    if (step === total) {
      setSubmitting(true)
      const sid = sessionId
      if (sid) {
        for (const q of questions) {
          const val = answers[q.id]
          if (val === undefined || val === null || val === '') continue
          const responseId = await submitResponse(sid, q, val)
          const isAudio = q.type === 'VOICE_RESPONSE' || q.type === 'AUDIO_CAPTURE' || q.type === 'AUDIO_QUESTION'
          if (responseId && isAudio && (val as AudioValue)?.blob) {
            const av = val as AudioValue
            const sampleRateHz = (q.options as { sampleRateHz?: number })?.sampleRateHz ?? 16000
            const wavBlob = av.mimeType?.includes('wav') ? av.blob : await _blobToWav(av.blob, sampleRateHz)
            await uploadAudio(responseId, wavBlob, 'audio/wav', av.qcResult)
          }
          if (responseId && q.type === 'IMAGE_UPLOAD' && val instanceof File) {
            await uploadImage(responseId, val)
          }
        }
        await completeSession(sid)
      }
      setSubmitting(false)
    }
    setStep(s => s + 1)
  }

  const current = step >= 1 && step <= total ? questions[step - 1] : null
  const currentAnswer = current ? answers[current.id] : null
  const canProceed = submitting ? false :
    !current?.required || (currentAnswer !== undefined && currentAnswer !== null && currentAnswer !== '')

  const progressPct = total > 0 && step >= 1 ? Math.round(((step - 1) / total) * 100) : 0

  return (
    <div className="fixed inset-0 flex flex-col bg-paper text-ink overflow-hidden font-sans">
      {!isIntro && !isDone && (
        <div className="shrink-0 border-b border-warm">
          {/* Progress bar — 2px, smooth */}
          <div className="h-0.5 bg-warm/60">
            <div className="h-full bg-violet transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex items-center justify-between px-5 h-11">
            <button type="button" onClick={back}
              className="text-dim hover:text-ink transition-colors p-1 -ml-1 font-mono text-[13px]">
              ←
            </button>
            <span className="font-mono text-[11px] text-dim tracking-[0.08em]">{step} / {total}</span>
            <span className="font-mono text-[11px] text-dim truncate max-w-[140px]">
              {survey.title}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isIntro && <IntroScreen survey={survey} onStart={handleStart} />}
        {current && (
          <QuestionScreen
            key={current.id}
            question={current}
            index={step}
            total={total}
            value={currentAnswer}
            onChange={v => answer(current.id, v)}
            canProceed={canProceed}
            submitting={submitting}
            onNext={next}
            onBack={back}
          />
        )}
        {isDone && <DoneScreen survey={survey} />}
      </div>
    </div>
  )
}

function IntroScreen({ survey, onStart }: { survey: Survey; onStart: () => void }) {
  const n = survey.questions?.length ?? 0
  return (
    <div className="min-h-full flex flex-col justify-between p-8 pt-16 max-w-lg mx-auto">
      <div>
        <p className="font-mono text-[11px] text-dim tracking-[0.1em] mb-5 uppercase">Voxform</p>
        <h1 className="font-serif text-[clamp(26px,6vw,36px)] leading-[1.15] tracking-tight text-ink mb-4">
          {survey.title}
        </h1>
        {survey.description && (
          <p className="text-[14px] text-dim leading-relaxed mb-6">{survey.description}</p>
        )}
        <div className="flex gap-6 flex-wrap">
          {[
            [`${n}`, 'questions'],
            ['WAV', '16kHz audio'],
            ['Secure', 'encrypted'],
          ].map(([v, l]) => (
            <div key={l} className="border-l-2 border-warm pl-3">
              <p className="font-serif text-[16px] font-semibold text-ink">{v}</p>
              <p className="font-mono text-[11px] text-dim">{l}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="pt-10">
        <button
          type="button"
          onClick={onStart}
          className="w-full h-14 rounded-xl bg-ink text-paper font-sans font-semibold text-[15px] tracking-[0.01em] transition-opacity hover:opacity-85 shadow-sm"
        >
          Begin survey →
        </button>
        <p className="text-center mt-3 font-mono text-[11px] text-dim">Your responses are recorded securely</p>
      </div>
    </div>
  )
}

function QuestionScreen({ question, index, total, value, onChange, canProceed, submitting, onNext, onBack }: {
  question: Question; index: number; total: number; value: unknown
  onChange: (v: unknown) => void; canProceed: boolean; submitting: boolean; onNext: () => void; onBack: () => void
}) {
  const isLast = index === total
  void onBack

  // Stable refs so the keydown listener never needs re-registration
  const canProceedRef = useRef(canProceed)
  const onNextRef = useRef(onNext)
  canProceedRef.current = canProceed
  onNextRef.current = onNext

  // Keyboard navigation: Enter → next, number keys for choices
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA') return  // allow newlines in textarea

      if (e.key === 'Enter' && canProceedRef.current) {
        e.preventDefault()
        onNextRef.current()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])  // registers once per question mount

  return (
    <div className="min-h-full flex flex-col max-w-[520px] mx-auto question-enter">
      <div className="flex-1 p-8 pt-8">
        <p className="font-mono text-[11px] text-dim tracking-[0.1em] mb-5 uppercase">
          {String(index).padStart(2, '0')} — {question.type.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}
          {!!question.required && <span className="ml-1.5 text-dim">*</span>}
        </p>
        <h2 className="font-serif text-[clamp(22px,5vw,28px)] leading-[1.2] tracking-tight text-ink mb-2">
          {question.title}
        </h2>
        {question.description && (
          <p className="text-[13px] text-dim leading-relaxed mb-6">{question.description}</p>
        )}
        <QuestionInput question={question} value={value} onChange={onChange} onCommit={canProceed ? onNext : undefined} />
      </div>

      <div className="px-6 pb-8 pt-4 border-t border-warm/60">
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className={`w-full h-14 rounded-xl font-sans font-semibold text-[15px] border transition-all
            ${canProceed
              ? 'bg-ink text-paper border-ink hover:opacity-85 cursor-pointer shadow-sm'
              : 'bg-transparent text-ghost border-warm cursor-not-allowed'}`}
        >
          {submitting ? 'Submitting…' : isLast ? 'Submit' : 'Next →'}
        </button>
        {!!question.required && !canProceed && !submitting && (
          <p className="text-center mt-2 font-mono text-[11px] text-dim">Required · press Enter when ready</p>
        )}
        {canProceed && !submitting && (
          <p className="text-center mt-2 font-mono text-[11px] text-dim/60">press Enter ↵</p>
        )}
      </div>
    </div>
  )
}

function SectionBreakInput({ onChange }: { onChange: (v: unknown) => void }) {
  useEffect(() => { onChange('__break__') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="h-0.5 bg-warm my-2" />
}

function FileUploadWidget({ accept, maxMb, file, onChange }: {
  accept: string; maxMb: number; file: File | null; onChange: (v: unknown) => void
}) {
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(f: File) {
    if (f.size > maxMb * 1024 * 1024) {
      setError(`File too large — max ${maxMb} MB`)
      return
    }
    setError('')
    onChange(f)
  }

  function fmt(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (file) {
    return (
      <div className="w-full rounded-xl border border-warm bg-paper p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-warm/60 flex items-center justify-center shrink-0">
          <span className="font-mono text-[10px] text-dim uppercase">
            {file.name.split('.').pop()?.slice(0, 4) ?? 'FILE'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] text-ink font-medium truncate">{file.name}</p>
          <p className="font-mono text-[11px] text-dim">{fmt(file.size)}</p>
        </div>
        <button type="button"
          onClick={() => { setError(''); onChange(null) }}
          className="font-mono text-[11px] text-dim hover:text-ink transition-colors px-2 py-1 rounded-lg hover:bg-warm/50">
          Remove
        </button>
      </div>
    )
  }

  return (
    <div>
      <button type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) handleFile(f)
        }}
        className={`w-full rounded-xl border-2 border-dashed py-10 flex flex-col items-center gap-3 transition-all
          ${dragging ? 'border-ink bg-ink/5' : 'border-warm hover:border-ink/40 hover:bg-warm/20'}`}>
        <div className="w-11 h-11 rounded-full bg-warm/70 flex items-center justify-center">
          <span className="text-[20px]">↑</span>
        </div>
        <div className="text-center">
          <p className="text-[15px] text-ink font-medium">Choose a file</p>
          <p className="font-mono text-[11px] text-dim mt-1">or drag and drop here · max {maxMb} MB</p>
        </div>
      </button>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
      {error && <p className="font-mono text-[11px] text-red-500 mt-2">{error}</p>}
    </div>
  )
}

function QuestionInput({ question: q, value, onChange, onCommit }: {
  question: Question; value: unknown; onChange: (v: unknown) => void; onCommit?: () => void
}) {
  const inputStyle = 'w-full px-4 py-3.5 rounded-xl border border-warm bg-paper text-[15px] text-ink font-sans placeholder:text-ghost focus:outline-none focus:border-ink focus:shadow-sm transition-all'

  if (q.type === 'SHORT_TEXT' || q.type === 'EMAIL' || q.type === 'NAME' || q.type === 'PHONE') return (
    <input className={inputStyle}
      type={q.type === 'EMAIL' ? 'email' : q.type === 'PHONE' ? 'tel' : 'text'}
      placeholder={q.type === 'EMAIL' ? 'your@email.com' : q.type === 'PHONE' ? '+1 (555) 000-0000' : 'Your answer…'}
      value={value as string ?? ''}
      onChange={e => onChange(e.target.value)}
      autoFocus
    />
  )
  if (q.type === 'NUMERIC') return (
    <input className={inputStyle} type="number"
      placeholder={(q.options as { placeholder?: string })?.placeholder ?? '0'}
      value={value as string ?? ''}
      onChange={e => onChange(e.target.value)}
      autoFocus
    />
  )
  if (q.type === 'LONG_TEXT') return (
    <textarea className={`${inputStyle} h-36 resize-none`}
      placeholder="Your answer…"
      value={value as string ?? ''}
      onChange={e => onChange(e.target.value)}
    />
  )
  if (q.type === 'SINGLE_CHOICE' || q.type === 'DROPDOWN') {
    const choices = (q.options as { choices?: { id: string; label: string }[] })?.choices ?? [
      { id: '1', label: 'Option A' }, { id: '2', label: 'Option B' },
    ]
    return (
      <div className="flex flex-col gap-2">
        {choices.map((c, i) => (
          <button type="button" key={c.id}
            onClick={() => { onChange(c.id); setTimeout(() => onCommit?.(), 120) }}
            className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl border text-left transition-all
              ${value === c.id ? 'border-ink bg-ink text-paper shadow-sm' : 'border-warm hover:border-ink hover:shadow-sm'}`}>
            <div className={`w-5 h-5 rounded-full border-[1.5px] shrink-0 flex items-center justify-center transition-all
              ${value === c.id ? 'border-paper' : 'border-ghost'}`}>
              {value === c.id
                ? <div className="w-2.5 h-2.5 rounded-full bg-paper" />
                : <span className="font-mono text-[10px] text-dim">{i + 1}</span>
              }
            </div>
            <span className={`text-[15px] transition-colors ${value === c.id ? 'text-paper' : 'text-ink'}`}>{c.label}</span>
          </button>
        ))}
      </div>
    )
  }
  if (q.type === 'MULTIPLE_CHOICE') {
    const choices = (q.options as { choices?: { id: string; label: string }[] })?.choices ?? [
      { id: '1', label: 'Option A' }, { id: '2', label: 'Option B' },
    ]
    const selected: string[] = (value as string[]) ?? []
    return (
      <div className="flex flex-col gap-2">
        {choices.map((c, i) => {
          const on = selected.includes(c.id)
          return (
            <button type="button" key={c.id}
              onClick={() => onChange(on ? selected.filter(x => x !== c.id) : [...selected, c.id])}
              className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl border text-left transition-all
                ${on ? 'border-ink bg-ink text-paper shadow-sm' : 'border-warm hover:border-ink hover:shadow-sm'}`}>
              <div className={`w-5 h-5 rounded border-[1.5px] shrink-0 flex items-center justify-center transition-all
                ${on ? 'border-paper bg-paper' : 'border-ghost'}`}>
                {on
                  ? <span className="text-ink text-[10px] font-bold leading-none">✓</span>
                  : <span className="font-mono text-[10px] text-dim">{i + 1}</span>
                }
              </div>
              <span className={`text-[15px] transition-colors ${on ? 'text-paper' : 'text-ink'}`}>{c.label}</span>
            </button>
          )
        })}
      </div>
    )
  }
  if (q.type === 'YES_NO') {
    const opts = q.options as { yesLabel?: string; noLabel?: string } | undefined
    return (
      <div className="flex gap-3">
        {[
          { val: 'yes', label: opts?.yesLabel ?? 'Yes', hint: 'Y' },
          { val: 'no',  label: opts?.noLabel  ?? 'No',  hint: 'N' },
        ].map(o => (
          <button type="button" key={o.val}
            onClick={() => { onChange(o.val); setTimeout(() => onCommit?.(), 120) }}
            className={`flex-1 py-5 rounded-xl border transition-all relative
              ${value === o.val
                ? 'bg-ink text-paper border-ink shadow-sm'
                : 'bg-paper text-ink border-warm hover:border-ink hover:shadow-sm'}`}>
            <span className="text-[16px] font-medium">{o.label}</span>
            <span className={`absolute top-2 right-3 font-mono text-[10px] ${value === o.val ? 'text-paper/50' : 'text-dim'}`}>
              {o.hint}
            </span>
          </button>
        ))}
      </div>
    )
  }
  if (q.type === 'LIKERT') {
    const opts = q.options as { min?: number; max?: number; minLabel?: string; maxLabel?: string } ?? { min: 1, max: 5 }
    const pts = Array.from({ length: (opts.max ?? 5) - (opts.min ?? 1) + 1 }, (_, i) => i + (opts.min ?? 1))
    return (
      <div>
        <div className="flex gap-1.5">
          {pts.map(v => (
            <button key={v} type="button"
              onClick={() => { onChange(v); setTimeout(() => onCommit?.(), 120) }}
              className={`flex-1 border font-mono text-[14px] rounded-xl transition-all
                ${value === v ? 'bg-ink text-paper border-ink shadow-sm' : 'bg-paper text-dim border-warm hover:border-ink hover:text-ink'}`}
              style={{ height: 52 }}>
              {v}
            </button>
          ))}
        </div>
        {(opts.minLabel ?? opts.maxLabel) && (
          <div className="flex justify-between mt-2 font-mono text-[11px] text-dim">
            <span>{opts.minLabel}</span><span>{opts.maxLabel}</span>
          </div>
        )}
      </div>
    )
  }
  if (q.type === 'NPS') {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    return (
      <div>
        <div className="flex gap-1 flex-wrap">
          {pts.map(v => (
            <button key={v} type="button"
              onClick={() => { onChange(v); setTimeout(() => onCommit?.(), 120) }}
              className={`flex-1 min-w-[36px] font-mono text-[14px] rounded-lg border transition-all
                ${value === v ? 'bg-ink text-paper border-ink shadow-sm' : 'bg-paper text-dim border-warm hover:border-ink hover:text-ink'}`}
              style={{ height: 52 }}>
              {v}
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-2 font-mono text-[11px] text-dim">
          <span>Not likely</span><span>Very likely</span>
        </div>
      </div>
    )
  }
  if (q.type === 'STAR_RATING') {
    const max = (q.options as { max?: number })?.max ?? 5
    return (
      <div className="flex gap-2">
        {Array.from({ length: max }, (_, i) => i + 1).map(v => (
          <button key={v} type="button"
            onClick={() => { onChange(v); setTimeout(() => onCommit?.(), 180) }}
            className={`text-[32px] bg-none border-none cursor-pointer transition-all hover:scale-110
              ${(value as number) >= v ? 'text-ink' : 'text-warm'}`}>
            ★
          </button>
        ))}
      </div>
    )
  }
  if (q.type === 'SLIDER') {
    const opts = q.options as { min?: number; max?: number; step?: number; minLabel?: string; maxLabel?: string } | undefined
    const min = opts?.min ?? 0; const max = opts?.max ?? 100; const step = opts?.step ?? 1
    const cur = (value as number) ?? Math.round((min + max) / 2)
    return (
      <div className="space-y-4 py-2">
        <div className="text-center">
          <span className="text-[28px] font-serif text-ink font-medium tabular-nums">{cur}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={cur}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full accent-violet cursor-pointer h-2 rounded-full appearance-none bg-warm"
          style={{ background: `linear-gradient(to right, rgb(var(--violet)) 0%, rgb(var(--violet)) ${((cur - min) / (max - min)) * 100}%, rgb(var(--warm)) ${((cur - min) / (max - min)) * 100}%, rgb(var(--warm)) 100%)` }}
        />
        {(opts?.minLabel ?? opts?.maxLabel) && (
          <div className="flex justify-between font-mono text-[11px] text-dim">
            <span>{opts?.minLabel ?? min}</span><span>{opts?.maxLabel ?? max}</span>
          </div>
        )}
      </div>
    )
  }
  if (q.type === 'WEBSITE_URL') return (
    <input className={inputStyle} type="url"
      value={value as string ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder="https://example.com"
    />
  )
  if (q.type === 'IMAGE_UPLOAD') {
    const opts = q.options as { maxSizeMb?: number; allowCamera?: boolean } | undefined
    const maxMb = opts?.maxSizeMb ?? 10
    const allowCam = opts?.allowCamera ?? true
    const img = value as File | null | undefined
    const previewUrl = img ? URL.createObjectURL(img) : null
    return (
      <div className="space-y-3">
        {previewUrl && (
          <div className="relative rounded-xl overflow-hidden border border-warm">
            <img src={previewUrl} alt="Preview" className="w-full max-h-52 object-cover" />
            <button type="button" onClick={() => onChange(null)}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-ink/70 text-paper flex items-center justify-center text-[11px] hover:bg-ink transition-colors">
              ✕
            </button>
          </div>
        )}
        {!img && (
          <div className="flex gap-2">
            <label className="flex-1 cursor-pointer">
              <div className="border-2 border-dashed border-warm rounded-xl py-6 flex flex-col items-center gap-2 hover:border-ink transition-colors bg-warm/5">
                <span className="text-[22px]">🖼</span>
                <p className="text-[13px] text-dim">Upload image</p>
                <p className="text-[11px] font-mono text-ghost">Max {maxMb}MB</p>
              </div>
              <input type="file" accept="image/*" className="sr-only"
                onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f) }} />
            </label>
            {allowCam && (
              <label className="flex-1 cursor-pointer">
                <div className="border-2 border-dashed border-warm rounded-xl py-6 flex flex-col items-center gap-2 hover:border-ink transition-colors bg-warm/5">
                  <span className="text-[22px]">📷</span>
                  <p className="text-[13px] text-dim">Take photo</p>
                </div>
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                  onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f) }} />
              </label>
            )}
          </div>
        )}
      </div>
    )
  }
  if (q.type === 'RANKING') {
    const choices = (q.options as { choices?: { id: string; label: string }[] })?.choices ?? []
    const ranked: string[] = (value as string[]) ?? []
    const unranked = choices.filter(c => !ranked.includes(c.id))
    function moveUp(idx: number) {
      if (idx === 0) return
      const r = [...ranked]; [r[idx - 1], r[idx]] = [r[idx], r[idx - 1]]; onChange(r)
    }
    function moveDown(idx: number) {
      if (idx === ranked.length - 1) return
      const r = [...ranked]; [r[idx], r[idx + 1]] = [r[idx + 1], r[idx]]; onChange(r)
    }
    return (
      <div className="space-y-2">
        {ranked.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {ranked.map((cid, i) => {
              const c = choices.find(x => x.id === cid)
              return c ? (
                <div key={cid} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-ink bg-ink text-paper">
                  <span className="text-[11px] font-mono w-5 shrink-0 opacity-60">{i + 1}</span>
                  <span className="text-[14px] flex-1">{c.label}</span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => moveUp(i)} disabled={i === 0}
                      className="w-6 h-6 flex items-center justify-center rounded opacity-60 hover:opacity-100 disabled:opacity-20">▲</button>
                    <button type="button" onClick={() => moveDown(i)} disabled={i === ranked.length - 1}
                      className="w-6 h-6 flex items-center justify-center rounded opacity-60 hover:opacity-100 disabled:opacity-20">▼</button>
                    <button type="button" onClick={() => onChange(ranked.filter(x => x !== cid))}
                      className="w-6 h-6 flex items-center justify-center rounded opacity-60 hover:opacity-100 text-[11px]">✕</button>
                  </div>
                </div>
              ) : null
            })}
          </div>
        )}
        {unranked.length > 0 && (
          <div className="space-y-1.5">
            {unranked.length < choices.length && <p className="text-[11px] font-mono text-dim mb-2">Tap to add to ranking:</p>}
            {unranked.map(c => (
              <button key={c.id} type="button" onClick={() => onChange([...ranked, c.id])}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-warm hover:border-ink hover:shadow-sm transition-all text-left">
                <span className="text-[11px] font-mono text-ghost w-5 shrink-0">—</span>
                <span className="text-[14px] text-ink flex-1">{c.label}</span>
                <span className="text-[11px] font-mono text-dim">tap to rank</span>
              </button>
            ))}
          </div>
        )}
        {choices.length === 0 && <p className="text-[13px] text-dim italic">No items configured.</p>}
      </div>
    )
  }
  if (q.type === 'VOICE_RESPONSE' || q.type === 'AUDIO_CAPTURE' || q.type === 'AUDIO_QUESTION') return (
    <AudioWidget
      minDuration={(q.options as { minDurationSec?: number })?.minDurationSec ?? 15}
      maxDuration={(q.options as { maxDurationSec?: number })?.maxDurationSec ?? 300}
      minDbfs={(q.options as { minDbfs?: number })?.minDbfs ?? -18}
      value={value as AudioValue | null}
      onChange={onChange}
    />
  )
  if (q.type === 'LOCATION') return <LocationWidget value={value} onChange={onChange} />
  if (q.type === 'DATE') return (
    <input type="date" className={`${inputStyle} font-mono`}
      title="Date"
      placeholder="YYYY-MM-DD"
      value={value as string ?? ''}
      onChange={e => onChange(e.target.value)}
    />
  )
  if (q.type === 'FILE_UPLOAD') {
    const opts = q.options as { acceptedTypes?: string; maxSizeMb?: number } | undefined
    const accept = opts?.acceptedTypes ?? '*/*'
    const maxMb = opts?.maxSizeMb ?? 10
    const file = value as File | null | undefined
    return (
      <FileUploadWidget
        accept={accept}
        maxMb={maxMb}
        file={file ?? null}
        onChange={onChange}
      />
    )
  }
  if (q.type === 'SECTION_BREAK' || q.type === 'DESCRIPTION_SLIDE') return <SectionBreakInput onChange={onChange} />
  return (
    <input className={inputStyle}
      value={value as string ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder="Answer…"
    />
  )
}

// ── Audio quality helpers ──────────────────────────────────────────────────────
type MetricTier = 'good' | 'warn' | 'poor'

function computeSnr(rmsHistory: number[]): number {
  if (rmsHistory.length < 10) return 0
  const sorted = [...rmsHistory].sort((a, b) => a - b)
  const noiseFloor = sorted[Math.floor(sorted.length * 0.10)] || 1e-10
  const signalLevel = sorted[Math.floor(sorted.length * 0.85)] || 1e-10
  return Math.max(0, Math.round(20 * Math.log10(Math.max(signalLevel / noiseFloor, 1e-10))))
}

function computeSsl(rmsHistory: number[]): number {
  if (rmsHistory.length === 0) return 0
  const avg = rmsHistory.reduce((s, v) => s + v, 0) / rmsHistory.length
  return parseFloat((avg * 33).toFixed(1))
}

interface QcSummary { avgDbfs: number; pctGood: number; sal: number; snr: number; ssl: number }

// ── Audio widget ───────────────────────────────────────────────────────────────
function AudioWidget({ minDuration, maxDuration, minDbfs = -18, value, onChange }: {
  minDuration: number; maxDuration: number; minDbfs?: number; value: AudioValue | null; onChange: (v: unknown) => void
}) {
  const qcRaw = value?.qcResult as Partial<QcSummary> | undefined
  const [state, setState] = useState<'idle' | 'recording' | 'done'>(value ? 'done' : 'idle')
  const [duration, setDuration] = useState(value?.duration ?? 0)
  const [error, setError] = useState('')
  const [bars, setBars] = useState<number[]>(Array(20).fill(4))
  const [liveDbfs, setLiveDbfs] = useState(-60)
  const [sal, setSal] = useState(0)
  const [snr, setSnr] = useState(0)
  const [ssl, setSsl] = useState(0)
  const [qcSummary, setQcSummary] = useState<QcSummary | null>(
    qcRaw ? { avgDbfs: qcRaw.avgDbfs ?? 0, pctGood: qcRaw.pctGood ?? 0, sal: qcRaw.sal ?? 0, snr: qcRaw.snr ?? 0, ssl: qcRaw.ssl ?? 0 } : null
  )
  const [showQcBanner, setShowQcBanner] = useState(false)

  const mrRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const waveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qcIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const dbfsHistoryRef = useRef<number[]>([])
  const rmsHistoryRef = useRef<number[]>([])
  const satCountRef = useRef(0)
  const durationRef = useRef(value?.duration ?? 0)

  function fmt(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  async function start() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      })
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser
      audioCtx.createMediaStreamSource(stream).connect(analyser)
      dbfsHistoryRef.current = []; rmsHistoryRef.current = []; satCountRef.current = 0

      chunks.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined)
      mr.ondataavailable = e => e.data.size > 0 && chunks.current.push(e.data)
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: mr.mimeType })
        const url = URL.createObjectURL(blob)
        const dbHist = dbfsHistoryRef.current
        const rmsH = rmsHistoryRef.current
        const dur = durationRef.current
        const qcResult: Record<string, number> | undefined = dbHist.length > 0 ? {
          avgDbfs: Math.round(dbHist.reduce((s, v) => s + v, 0) / dbHist.length),
          pctGood: parseFloat((dbHist.filter(v => v > minDbfs).length / dbHist.length).toFixed(2)),
          sal: dur > 0 ? Math.round(satCountRef.current / (dur / 60)) : 0,
          snr: computeSnr(rmsH),
          ssl: computeSsl(rmsH),
        } : undefined
        onChange({ blob, blobUrl: url, duration: durationRef.current, mimeType: mr.mimeType, qcResult })
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start(250)
      mrRef.current = mr
      setState('recording')
      durationRef.current = 0; setDuration(0); setLiveDbfs(-60); setSal(0); setSnr(0); setSsl(0)

      timerRef.current = setInterval(() => { durationRef.current += 1; setDuration(d => d + 1) }, 1000)
      waveRef.current = setInterval(() => setBars(Array(20).fill(0).map(() => 3 + Math.random() * 29)), 90)

      const buf = new Float32Array(analyser.frequencyBinCount)
      qcIntervalRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buf)
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length)
        const db = Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(rms, 1e-10))))
        // Saturation: samples at or near clipping
        satCountRef.current += buf.filter(v => Math.abs(v) >= 0.98).length
        dbfsHistoryRef.current.push(db)
        rmsHistoryRef.current.push(rms)
        setLiveDbfs(db)
        const dur = durationRef.current
        setSal(dur > 0 ? Math.round(satCountRef.current / (dur / 60)) : 0)
        setSnr(computeSnr(rmsHistoryRef.current))
        setSsl(computeSsl(rmsHistoryRef.current))
      }, 120)
    } catch {
      setError('Microphone access denied. Please allow microphone permission and try again.')
    }
  }

  function stop() {
    if (qcIntervalRef.current) { clearInterval(qcIntervalRef.current); qcIntervalRef.current = null }
    audioCtxRef.current?.close(); audioCtxRef.current = null; analyserRef.current = null
    const dbHist = dbfsHistoryRef.current
    const rmsH = rmsHistoryRef.current
    const dur = durationRef.current
    if (dbHist.length > 0) {
      setQcSummary({
        avgDbfs: Math.round(dbHist.reduce((s, v) => s + v, 0) / dbHist.length),
        pctGood: dbHist.filter(v => v > minDbfs).length / dbHist.length,
        sal: dur > 0 ? Math.round(satCountRef.current / (dur / 60)) : 0,
        snr: computeSnr(rmsH),
        ssl: computeSsl(rmsH),
      })
    }
    mrRef.current?.stop()
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (waveRef.current) { clearInterval(waveRef.current); waveRef.current = null }
    setState('done')
    setBars(Array(20).fill(4))
    setShowQcBanner(true)
  }

  function reset() {
    onChange(null); setState('idle'); setQcSummary(null); setLiveDbfs(-60); setShowQcBanner(false)
    durationRef.current = 0; setDuration(0); setSal(0); setSnr(0); setSsl(0)
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (waveRef.current) clearInterval(waveRef.current)
    if (qcIntervalRef.current) clearInterval(qcIntervalRef.current)
    audioCtxRef.current?.close()
  }, [])

  useEffect(() => {
    if (!showQcBanner) return
    const t = setTimeout(() => setShowQcBanner(false), 3500)
    return () => clearTimeout(t)
  }, [showQcBanner])

  const meetsMin = duration >= minDuration

  // Live metric tiers
  const sigTier: MetricTier = liveDbfs > minDbfs ? 'good' : liveDbfs > (minDbfs - 12) ? 'warn' : 'poor'
  const salTier: MetricTier = sal <= 600 ? 'good' : sal <= 900 ? 'warn' : 'poor'
  const snrTier: MetricTier = snr >= 13 ? 'good' : snr >= 8 ? 'warn' : 'poor'
  const sslTier: MetricTier = ssl <= 3.3 ? 'good' : ssl <= 5.0 ? 'warn' : 'poor'

  const txnDone = state === 'done'

  return (
    <div className="rounded-2xl border border-warm/70 bg-paper shadow-sm p-5 flex flex-col items-center gap-4 w-full">

      {/* Header: status badge — timer — saved badge */}
      <div className="w-full flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] tracking-widest uppercase font-semibold border transition-all
          ${state === 'recording'
            ? 'bg-red-50 text-red-600 border-red-200'
            : 'bg-warm/50 text-dim border-warm/60'}`}>
          <span className={`w-1.5 h-1.5 rounded-full transition-all ${state === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-ghost'}`} />
          {state === 'recording' ? 'Recording' : 'Ready'}
        </span>

        <span className={`font-mono text-[44px] font-medium tracking-[-0.04em] tabular-nums leading-none transition-colors
          ${state === 'recording' ? 'text-ink' : 'text-dim'}`}>
          {fmt(duration)}
        </span>

        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] tracking-widest uppercase font-semibold border transition-all
          ${txnDone
            ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
            : 'bg-warm/50 text-dim border-warm/60'}`}>
          <span className={`w-1.5 h-1.5 rounded-full transition-all ${txnDone ? 'bg-emerald-500' : 'bg-ghost'}`} />
          {txnDone ? 'Saved' : '—'}
        </span>
      </div>

      {/* Waveform bars */}
      <div className="flex gap-[3px] items-center h-9">
        {bars.map((h, i) => (
          <div key={i}
            className={`w-[3px] rounded-full transition-all ${state === 'recording' ? 'bg-indigov' : 'bg-warm'}`}
            style={{ height: state === 'recording' ? h : 4, transitionDuration: state === 'recording' ? '80ms' : '300ms' }} />
        ))}
      </div>

      {/* Live metrics — recording only */}
      {state === 'recording' && (
        <div className="w-full rounded-xl border border-warm/50 bg-warm/10 divide-y divide-warm/40 overflow-hidden">
          <AudioMetricRow
            label="Signal" value={liveDbfs > -55 ? `${liveDbfs.toFixed(1)} dBFS` : '— dBFS'}
            tier={sigTier} barWidth={`${Math.max(3, ((liveDbfs + 60) / 60) * 100)}%`}
          />
          <AudioMetricRow
            label="SAT" value={`${sal} /min`}
            tier={salTier} barWidth={`${Math.min(100, sal > 0 ? (sal / 600) * 100 : 2)}%`}
            hint="≤ 600"
          />
          <AudioMetricRow
            label="SNR" value={snr > 0 ? `${snr} dB` : '—'}
            tier={snrTier} barWidth={`${Math.min(100, (snr / 40) * 100)}%`}
            hint="≥ 13 dB"
          />
          <AudioMetricRow
            label="SSL" value={ssl > 0 ? ssl.toFixed(1) : '—'}
            tier={sslTier} barWidth={`${Math.min(100, (ssl / 5) * 100)}%`}
            hint="≤ 3.3"
          />
        </div>
      )}

      {/* Live QC guidance messages */}
      {state === 'recording' && duration > 3 && (() => {
        if (sal > 600)
          return <p className="font-mono text-[11px] text-red-500 text-center">Too loud — step back from the mic</p>
        if (snr < 8 && duration > 5)
          return <p className="font-mono text-[11px] text-amber-600 text-center">Background noise — move to a quieter place</p>
        if (liveDbfs < -45)
          return <p className="font-mono text-[11px] text-amber-600 text-center">Speak up — move mic closer to your mouth</p>
        if (ssl > 5)
          return <p className="font-mono text-[11px] text-amber-600 text-center">Unsteady — hold your phone still</p>
        if (snr >= 13 && liveDbfs > minDbfs)
          return <p className="font-mono text-[11px] text-slatebl text-center">Signal clear — keep going</p>
        return null
      })()}

      {/* Record / Stop button */}
      {state !== 'done' ? (
        <button
          type="button"
          onClick={state === 'idle' ? start : stop}
          className={`w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all shadow-sm
            ${state === 'recording'
              ? 'border-indigov bg-indigov'
              : 'border-warm bg-paper hover:border-indigov hover:shadow-md'}`}>
          {state === 'idle'
            ? <div className="w-5 h-5 rounded-full bg-indigov" />
            : <div className="w-4 h-4 rounded-sm bg-paper" />
          }
        </button>
      ) : (
        <div className="flex gap-2.5 w-full">
          <button type="button" onClick={reset}
            className="flex-1 h-11 rounded-xl border border-warm text-[13px] text-dim hover:text-ink hover:border-ink transition-all">
            Re-record
          </button>
          <div className="flex-[2] h-11 rounded-xl border border-slatebl/40 bg-slatebl/5 text-slatebl text-[13px] font-semibold flex items-center justify-center gap-2">
            <span>✓</span> Recorded
          </div>
        </div>
      )}

      {/* Audio playback */}
      {state === 'done' && value?.blobUrl && (
        <audio controls src={value.blobUrl} className="w-full h-9" />
      )}

      {/* QC banner — auto-dismisses after 3.5s */}
      {showQcBanner && qcSummary && (() => {
        let msg: string
        let cls: string
        if (qcSummary.sal > 600) {
          msg = 'Heads up — the recording was a bit loud. You can re-record or continue.'
          cls = 'border-amber-300/60 bg-amber-50/60 text-amber-700'
        } else if (qcSummary.snr < 13) {
          msg = 'Some background noise was picked up. You can re-record for a cleaner result.'
          cls = 'border-amber-300/60 bg-amber-50/60 text-amber-700'
        } else {
          msg = 'Sounds great — your recording is clear!'
          cls = 'border-slatebl/25 bg-slatebl/5 text-slatebl'
        }
        return (
          <div className={`w-full rounded-xl border px-4 py-3 font-mono text-[12px] text-center leading-snug ${cls}`}>
            {msg}
          </div>
        )
      })()}

      {/* Duration hints */}
      <div className="text-center -mt-1">
        {state === 'recording' && !meetsMin && (
          <p className="font-mono text-[11px] text-dim">{minDuration - duration}s remaining · min {minDuration}s</p>
        )}
        {state === 'recording' && meetsMin && (
          <p className="font-mono text-[11px] text-slatebl">Min reached — tap stop when ready</p>
        )}
        {state === 'idle' && (
          <p className="font-mono text-[11px] text-dim">Tap to record · Min {minDuration}s · Max {Math.floor(maxDuration / 60)}min</p>
        )}
        {state === 'done' && duration < minDuration && (
          <p className="font-mono text-[11px] text-amber-600">Too short ({duration}s) — re-record (min {minDuration}s)</p>
        )}
      </div>

      {error && <p className="text-[12px] text-red-500 text-center leading-relaxed">{error}</p>}
    </div>
  )
}

function AudioMetricRow({ label, value, tier, barWidth, hint }: {
  label: string; value: string; tier: MetricTier; barWidth: string; hint?: string
}) {
  const textColor = tier === 'good' ? 'text-slatebl' : tier === 'warn' ? 'text-amber-600' : 'text-red-500'
  const barColor  = tier === 'good' ? 'bg-slatebl'   : tier === 'warn' ? 'bg-amber-400'  : 'bg-red-400'
  return (
    <div className="px-3.5 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ghost tracking-widest uppercase w-10 shrink-0">{label}</span>
        <span className={`font-mono text-[11px] font-semibold ${textColor} flex-1`}>{value}</span>
        {hint && <span className="font-mono text-[10px] text-ghost/70 shrink-0">{hint}</span>}
      </div>
      <div className="w-full h-[3px] rounded-full bg-warm overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-150 ${barColor}`} style={{ width: barWidth }} />
      </div>
    </div>
  )
}


// ── Location widget ────────────────────────────────────────────────────────────
const DWELL_MS = 5000   // collect samples for up to 5 s
const TARGET_M = 20    // stop early if accuracy ≤ 20 m

function LocationWidget({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [bestAccuracy, setBestAccuracy] = useState<number | null>(null)
  const loc = value as { lat: number; lng: number; accuracy: number } | null

  const capture = useCallback(() => {
    setState('loading')
    setProgress(0)
    setBestAccuracy(null)
    const samples: { lat: number; lng: number; accuracy: number }[] = []
    const startTime = Date.now()
    let watchId = -1
    let finished = false

    const finish = () => {
      if (finished) return
      finished = true
      navigator.geolocation.clearWatch(watchId)
      if (samples.length > 0) {
        const best = samples.reduce((a, b) => (a.accuracy <= b.accuracy ? a : b))
        onChange(best)
        setState('done')
      } else {
        setState('error')
      }
    }

    watchId = navigator.geolocation.watchPosition(
      pos => {
        const s = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
        samples.push(s)
        const elapsed = Date.now() - startTime
        setProgress(Math.min(98, Math.round((elapsed / DWELL_MS) * 100)))
        setBestAccuracy(prev => (prev === null || s.accuracy < prev ? s.accuracy : prev))
        if (s.accuracy <= TARGET_M || elapsed >= DWELL_MS) finish()
      },
      () => setState('error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )

    setTimeout(finish, DWELL_MS + 500)
  }, [onChange])

  if (state === 'done' && loc) return (
    <div className="rounded-xl border border-warm bg-paper p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigov/10 flex items-center justify-center shrink-0 mt-0.5">
          <svg width="12" height="16" viewBox="0 0 12 16" fill="none" aria-hidden>
            <path d="M6 0C3.24 0 1 2.24 1 5c0 3.75 5 11 5 11S11 8.75 11 5c0-2.76-2.24-5-5-5Z" fill="#533A7B"/>
            <circle cx="6" cy="5" r="2" fill="white"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-mono text-[12px] text-ink font-semibold">Location captured</span>
            <button type="button" onClick={() => { onChange(null); setState('idle') }}
              className="font-mono text-[11px] text-dim hover:text-red-500 transition-colors shrink-0">
              Clear
            </button>
          </div>
          <p className="font-mono text-[12px] text-dim tabular-nums">
            {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
          </p>
          <p className="font-mono text-[11px] text-ghost mt-0.5">±{Math.round(loc.accuracy)}m accuracy</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="rounded-xl border border-warm bg-paper p-5 flex flex-col items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-indigov/10 flex items-center justify-center">
        <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden>
          <path d="M8 0C4.69 0 2 2.69 2 6c0 4.5 6 14 6 14S14 10.5 14 6c0-3.31-2.69-6-6-6Z"
            fill={state === 'loading' ? '#6969B3' : state === 'error' ? '#EF4444' : '#533A7B'}
            opacity={state === 'loading' ? 0.5 : 1}/>
          <circle cx="8" cy="6" r="2.5" fill="white"/>
        </svg>
      </div>
      {state === 'error' && (
        <p className="text-[12px] text-red-500 text-center leading-relaxed">
          Location access denied — please allow in browser settings and retry.
        </p>
      )}
      <button type="button" onClick={capture} disabled={state === 'loading'}
        className={`w-full h-12 rounded-xl font-sans font-semibold text-[14px] border transition-all flex items-center justify-center gap-2
          ${state === 'loading'
            ? 'border-warm text-dim cursor-not-allowed bg-warm/30'
            : state === 'error'
              ? 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer'
              : 'border-indigov bg-indigov text-paper hover:opacity-85 cursor-pointer shadow-sm'}`}>
        {state === 'loading'
          ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-dim/40 border-t-dim animate-spin" />Averaging signal…</>
          : state === 'error' ? 'Retry' : 'Capture location'
        }
      </button>
      {state === 'loading' && (
        <div className="w-full space-y-1.5">
          <div className="w-full h-1.5 bg-warm rounded-full overflow-hidden">
            <div className="h-full bg-indigov rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="font-mono text-[10px] text-ghost text-center">
            {bestAccuracy !== null ? `Best so far ±${Math.round(bestAccuracy)} m · targeting ±${TARGET_M} m` : 'Acquiring signal…'}
          </p>
        </div>
      )}
      {state === 'idle' && (
        <p className="font-mono text-[11px] text-ghost">GPS dwell · targets ±{TARGET_M} m accuracy</p>
      )}
    </div>
  )
}

function DoneScreen({ survey }: { survey: Survey }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center px-8 gap-6 max-w-[420px] mx-auto">
      <div className="w-14 h-14 rounded-full border-[1.5px] border-ink flex items-center justify-center pop-in">
        <span className="font-mono text-[22px] text-ink">✓</span>
      </div>
      <div className="question-enter" style={{ animationDelay: '0.1s' }}>
        <h2 className="font-serif text-[28px] tracking-tight text-ink mb-2.5">Thank you</h2>
        <p className="text-[14px] text-dim leading-relaxed max-w-[280px]">
          Your responses have been recorded. You can now close this window.
        </p>
      </div>
      <p className="font-mono text-[11px] text-dim mt-4">{survey.title}</p>
    </div>
  )
}

function FullMessage({ text, spinner }: { text: string; spinner?: boolean }) {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 font-sans bg-paper">
      {spinner ? (
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-ink loader-dot"
              style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      ) : <span className="text-[28px] opacity-30">○</span>}
      <p className="text-[14px] text-dim">{text}</p>
    </div>
  )
}
