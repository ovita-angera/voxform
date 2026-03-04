import { useState, useRef, useEffect } from 'react'
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
      body.textValue = typeof value === 'string' ? value : JSON.stringify(value)
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
    fd.append('file', blob, `audio${mimeType.includes('wav') ? '.wav' : '.webm'}`)
    fd.append('responseId', responseId)
    if (qcResult) fd.append('clientQcResult', JSON.stringify(qcResult))
    await fetch(`${BASE}/public/audio/upload/${uploadId}`, { method: 'POST', body: fd })
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
            await uploadAudio(responseId, av.blob, av.mimeType ?? 'audio/webm', av.qcResult)
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
          <div className="h-0.5 bg-warm">
            <div className="h-full bg-ink transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex items-center justify-between px-5 h-11">
            <button onClick={back} className="text-dim hover:text-ink transition-colors p-1 -ml-1 font-mono text-[13px]">←</button>
            <span className="font-mono text-[11px] text-dim tracking-[0.08em]">{step} / {total}</span>
            <span className="font-mono text-[11px] text-dim">
              {survey.title.length > 22 ? survey.title.slice(0, 22) + '…' : survey.title}
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
            ['Offline', 'capable'],
          ].map(([v, l]) => (
            <div key={l} className="border-l-2 border-warm pl-3">
              <p className="font-serif text-[16px] font-semibold text-ink">{v}</p>
              <p className="font-mono text-[11px] text-ghost">{l}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="pt-10">
        <button
          onClick={onStart}
          className="w-full h-14 bg-ink text-paper font-sans font-semibold text-[15px] tracking-[0.01em] transition-opacity hover:opacity-85"
        >
          Begin survey →
        </button>
        <p className="text-center mt-3 font-mono text-[11px] text-ghost">Your responses are recorded securely</p>
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
  return (
    <div className="min-h-full flex flex-col max-w-[520px] mx-auto">
      <div className="flex-1 p-8 pt-8">
        <p className="font-mono text-[11px] text-dim tracking-[0.1em] mb-5 uppercase">
          {String(index).padStart(2, '0')} — {question.type.replace(/_/g, ' ')}
          {!!question.required && <span className="ml-1.5 text-ghost">*</span>}
        </p>
        <h2 className="font-serif text-[clamp(22px,5vw,28px)] leading-[1.2] tracking-tight text-ink mb-2">
          {question.title}
        </h2>
        {question.description && (
          <p className="text-[13px] text-dim leading-relaxed mb-6">{question.description}</p>
        )}
        <QuestionInput question={question} value={value} onChange={onChange} />
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
          <p className="text-center mt-2 font-mono text-[11px] text-ghost">This question is required</p>
        )}
      </div>
    </div>
  )
}

function SectionBreakInput({ onChange }: { onChange: (v: unknown) => void }) {
  useEffect(() => { onChange('__break__') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="h-0.5 bg-warm my-2" />
}

function QuestionInput({ question: q, value, onChange }: { question: Question; value: unknown; onChange: (v: unknown) => void }) {
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
    const choices = (q.options as { choices?: { id: string; label: string }[] })?.choices ?? []
    return (
      <div className="flex flex-col gap-2">
        {choices.map(c => (
          <button type="button" key={c.id} onClick={() => onChange(c.id)}
            className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl border text-left transition-all
              ${value === c.id ? 'border-ink bg-ink text-paper shadow-sm' : 'border-warm hover:border-ink hover:shadow-sm'}`}>
            <div className={`w-4 h-4 rounded-full border-[1.5px] shrink-0 transition-all flex items-center justify-center
              ${value === c.id ? 'border-paper' : 'border-ghost'}`}>
              {value === c.id && <div className="w-2 h-2 rounded-full bg-paper" />}
            </div>
            <span className={`text-[15px] transition-colors ${value === c.id ? 'text-paper' : 'text-ink'}`}>{c.label}</span>
          </button>
        ))}
      </div>
    )
  }
  if (q.type === 'MULTIPLE_CHOICE') {
    const choices = (q.options as { choices?: { id: string; label: string }[] })?.choices ?? []
    const selected: string[] = (value as string[]) ?? []
    return (
      <div className="flex flex-col gap-2">
        {choices.map(c => {
          const on = selected.includes(c.id)
          return (
            <button type="button" key={c.id}
              onClick={() => onChange(on ? selected.filter(x => x !== c.id) : [...selected, c.id])}
              className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl border text-left transition-all
                ${on ? 'border-ink bg-ink text-paper shadow-sm' : 'border-warm hover:border-ink hover:shadow-sm'}`}>
              <div className={`w-4 h-4 rounded border-[1.5px] shrink-0 flex items-center justify-center transition-all
                ${on ? 'border-paper bg-paper' : 'border-ghost'}`}>
                {on && <span className="text-ink text-[10px] font-bold leading-none">✓</span>}
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
        {[{ val: 'yes', label: opts?.yesLabel ?? 'Yes' }, { val: 'no', label: opts?.noLabel ?? 'No' }].map(o => (
          <button type="button" key={o.val} onClick={() => onChange(o.val)}
            className={`flex-1 py-5 rounded-xl text-[16px] font-medium border transition-all
              ${value === o.val ? 'bg-ink text-paper border-ink shadow-sm' : 'bg-paper text-ink border-warm hover:border-ink hover:shadow-sm'}`}>
            {o.label}
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
            <button key={v} onClick={() => onChange(v)}
              className={`flex-1 h-13 border font-mono text-[14px] transition-all
                ${value === v ? 'bg-ink text-paper border-ink' : 'bg-paper text-dim border-warm hover:border-ink hover:text-ink'}`}
              style={{ height: 52 }}>
              {v}
            </button>
          ))}
        </div>
        {(opts.minLabel ?? opts.maxLabel) && (
          <div className="flex justify-between mt-2 font-mono text-[11px] text-ghost">
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
            <button key={v} onClick={() => onChange(v)}
              className={`flex-1 min-w-[36px] font-mono text-[14px] border transition-all
                ${value === v ? 'bg-ink text-paper border-ink' : 'bg-paper text-dim border-warm hover:border-ink hover:text-ink'}`}
              style={{ height: 52 }}>
              {v}
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-2 font-mono text-[11px] text-ghost">
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
          <button key={v} onClick={() => onChange(v)}
            className={`text-[32px] bg-none border-none cursor-pointer transition-colors
              ${(value as number) >= v ? 'text-ink' : 'text-warm'}`}>
            ★
          </button>
        ))}
      </div>
    )
  }
  if (q.type === 'VOICE_RESPONSE' || q.type === 'AUDIO_CAPTURE' || q.type === 'AUDIO_QUESTION') return (
    <AudioWidget
      minDuration={(q.options as { minDurationSec?: number })?.minDurationSec ?? 15}
      maxDuration={(q.options as { maxDurationSec?: number })?.maxDurationSec ?? 300}
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
  if (q.type === 'SECTION_BREAK' || q.type === 'DESCRIPTION_SLIDE') return <SectionBreakInput onChange={onChange} />
  return (
    <input className={inputStyle}
      value={value as string ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder="Answer…"
    />
  )
}

// ── Audio widget ───────────────────────────────────────────────────────────────
function AudioWidget({ minDuration, maxDuration, value, onChange }: {
  minDuration: number; maxDuration: number; value: AudioValue | null; onChange: (v: unknown) => void
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'done'>(value ? 'done' : 'idle')
  const [duration, setDuration] = useState(value?.duration ?? 0)
  const [error, setError] = useState('')
  const [bars, setBars] = useState<number[]>(Array(20).fill(4))
  const [liveDbfs, setLiveDbfs] = useState(-60)
  const [qcSummary, setQcSummary] = useState<{ avgDbfs: number; pctGood: number } | null>(
    (value?.qcResult as { avgDbfs: number; pctGood: number } | undefined) ?? null
  )
  const mrRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const waveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qcIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const dbfsHistoryRef = useRef<number[]>([])
  const durationRef = useRef(value?.duration ?? 0)

  function fmt(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  async function start() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })

      // Web Audio API for real-time dBFS metering
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser
      audioCtx.createMediaStreamSource(stream).connect(analyser)
      dbfsHistoryRef.current = []

      chunks.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mr.ondataavailable = e => e.data.size > 0 && chunks.current.push(e.data)
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: mr.mimeType })
        const url = URL.createObjectURL(blob)
        const history = dbfsHistoryRef.current
        const qcResult = history.length > 0 ? {
          avgDbfs: Math.round(history.reduce((s, v) => s + v, 0) / history.length),
          pctGood: parseFloat((history.filter(v => v > -18).length / history.length).toFixed(2)),
        } : undefined
        onChange({ blob, blobUrl: url, duration: durationRef.current, mimeType: mr.mimeType, qcResult })
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start(250)
      mrRef.current = mr
      setState('recording')
      durationRef.current = 0
      setDuration(0)
      setLiveDbfs(-60)

      timerRef.current = setInterval(() => {
        durationRef.current += 1
        setDuration(d => d + 1)
      }, 1000)
      waveRef.current = setInterval(() => setBars(Array(20).fill(0).map(() => 3 + Math.random() * 29)), 90)

      // dBFS polling every 120 ms
      const buf = new Float32Array(analyser.frequencyBinCount)
      qcIntervalRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buf)
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length)
        const db = Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(rms, 1e-10))))
        dbfsHistoryRef.current.push(db)
        setLiveDbfs(db)
      }, 120)
    } catch {
      setError('Microphone access denied. Please allow microphone permission and try again.')
    }
  }

  function stop() {
    if (qcIntervalRef.current) { clearInterval(qcIntervalRef.current); qcIntervalRef.current = null }
    audioCtxRef.current?.close(); audioCtxRef.current = null; analyserRef.current = null

    const history = dbfsHistoryRef.current
    if (history.length > 0) {
      const avg = history.reduce((s, v) => s + v, 0) / history.length
      setQcSummary({ avgDbfs: Math.round(avg), pctGood: history.filter(v => v > -18).length / history.length })
    }

    mrRef.current?.stop()
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (waveRef.current) { clearInterval(waveRef.current); waveRef.current = null }
    setState('done')
    setBars(Array(20).fill(4))
  }

  function reset() {
    onChange(null); setState('idle'); setQcSummary(null); setLiveDbfs(-60)
    durationRef.current = 0; setDuration(0)
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (waveRef.current) clearInterval(waveRef.current)
    if (qcIntervalRef.current) clearInterval(qcIntervalRef.current)
    audioCtxRef.current?.close()
  }, [])

  const meetsMin = duration >= minDuration

  // Signal quality helpers
  const sigTier = liveDbfs > -18 ? 'good' : liveDbfs > -30 ? 'ok' : 'poor'
  const sigBarColor = sigTier === 'good' ? 'bg-emerald-400' : sigTier === 'ok' ? 'bg-amber-400' : 'bg-red-400'
  const sigTextColor = sigTier === 'good' ? 'text-emerald-600' : sigTier === 'ok' ? 'text-amber-600' : 'text-red-500'
  const sigBarWidth = `${Math.max(3, ((liveDbfs + 60) / 60) * 100)}%`

  const sumTier = qcSummary ? (qcSummary.avgDbfs > -18 ? 'good' : qcSummary.avgDbfs > -30 ? 'ok' : 'poor') : null
  const sumLabel = sumTier === 'good' ? 'Good' : sumTier === 'ok' ? 'Marginal' : 'Weak'
  const sumColor = sumTier === 'good' ? 'text-emerald-600' : sumTier === 'ok' ? 'text-amber-600' : 'text-red-500'

  return (
    <div className="rounded-2xl border border-warm/70 bg-paper shadow-sm p-8 flex flex-col items-center gap-5">
      <div className={`font-mono text-[44px] font-medium tracking-[-0.04em] tabular-nums leading-none transition-colors ${state === 'recording' ? 'text-ink' : 'text-dim'}`}>
        {fmt(duration)}
      </div>

      {/* Waveform bars */}
      <div className="flex gap-[3px] items-center h-10">
        {bars.map((h, i) => (
          <div key={i} className={`w-[3px] rounded-full transition-all ${state === 'recording' ? 'bg-ink' : 'bg-warm'}`}
            style={{
              height: state === 'recording' ? h : 4,
              transitionDuration: state === 'recording' ? '80ms' : '300ms',
            }} />
        ))}
      </div>

      {/* Real-time dBFS meter — only while recording */}
      {state === 'recording' && (
        <div className="w-full space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-dim tracking-widest uppercase">Signal</span>
            <span className={`font-mono text-[11px] font-medium ${sigTextColor}`}>
              {Math.round(liveDbfs)} dBFS · {sigTier === 'good' ? 'Good' : sigTier === 'ok' ? 'Marginal' : 'Weak'}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-warm overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-100 ${sigBarColor}`} style={{ width: sigBarWidth }} />
          </div>
        </div>
      )}

      {/* Record / stop button */}
      {state !== 'done' ? (
        <button
          type="button"
          onClick={state === 'idle' ? start : stop}
          className={`w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all shadow-sm
            ${state === 'recording' ? 'border-ink bg-ink' : 'border-warm bg-paper hover:border-ink hover:shadow-md'}`}>
          {state === 'idle'
            ? <div className="w-5 h-5 rounded-full bg-ink" />
            : <div className="w-4 h-4 rounded-sm bg-paper" />
          }
        </button>
      ) : (
        <div className="flex gap-2.5 w-full">
          <button type="button" onClick={reset}
            className="flex-1 h-11 rounded-xl border border-warm text-[13px] text-dim hover:text-ink hover:border-ink transition-all">
            Re-record
          </button>
          <div className="flex-[2] h-11 rounded-xl border border-violet/40 bg-violet/8 text-violet text-[13px] font-semibold flex items-center justify-center gap-2">
            <span>✓</span> Recorded
          </div>
        </div>
      )}

      {state === 'done' && value?.blobUrl && (
        <audio controls src={value.blobUrl} className="w-full h-9" />
      )}

      {/* QC summary after done */}
      {state === 'done' && qcSummary && (
        <p className={`font-mono text-[11px] ${sumColor}`}>
          Signal: {sumLabel} · avg {qcSummary.avgDbfs} dBFS
          {sumTier === 'poor' && ' — consider re-recording in a quieter space'}
        </p>
      )}

      <div className="text-center">
        {state === 'recording' && !meetsMin && (
          <p className="font-mono text-[11px] text-dim">{minDuration - duration}s remaining (min {minDuration}s)</p>
        )}
        {state === 'recording' && meetsMin && (
          <p className="font-mono text-[11px] text-violet">Min duration reached — tap stop when ready</p>
        )}
        {state === 'idle' && (
          <p className="font-mono text-[11px] text-ghost">Tap to record · Min {minDuration}s · Max {Math.floor(maxDuration / 60)}min</p>
        )}
        {state === 'done' && duration < minDuration && (
          <p className="font-mono text-[11px] text-amber-600">Too short ({duration}s) — please re-record (min {minDuration}s)</p>
        )}
      </div>

      {error && <p className="text-[12px] text-red-500 text-center leading-relaxed">{error}</p>}
    </div>
  )
}

// ── Location widget ────────────────────────────────────────────────────────────
function LocationWidget({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const loc = value as { lat: number; lng: number; accuracy: number } | null

  function capture() {
    setState('loading')
    navigator.geolocation.getCurrentPosition(
      pos => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        setState('done')
      },
      () => { setState('error'); setMsg('Location access denied. Please enable and retry.') },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  if (state === 'done' && loc) return (
    <div className="border border-warm p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-2 h-2 rounded-full bg-ink" />
        <span className="font-mono text-[12px] text-ink">Location captured</span>
        <button onClick={() => { onChange(null); setState('idle') }}
          className="ml-auto font-mono text-[11px] text-dim hover:text-ink transition-colors">
          Reset
        </button>
      </div>
      <div className="font-mono text-[12px] text-dim leading-7">
        <p>{loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}</p>
        <p>±{Math.round(loc.accuracy)}m accuracy</p>
      </div>
    </div>
  )

  return (
    <div className="border border-warm p-7 text-center">
      {state === 'error' && <p className="text-[12px] text-red-500 mb-4 leading-relaxed">{msg}</p>}
      <button onClick={capture} disabled={state === 'loading'}
        className={`h-13 px-7 border font-sans font-semibold text-[14px] transition-all
          ${state === 'loading'
            ? 'border-warm text-dim cursor-not-allowed'
            : 'border-ink bg-ink text-paper hover:opacity-85 cursor-pointer'}`}
        style={{ height: 52 }}>
        {state === 'loading' ? 'Locating…' : '⊕ Capture location'}
      </button>
    </div>
  )
}

function DoneScreen({ survey }: { survey: Survey }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center px-8 gap-6 max-w-[420px] mx-auto">
      <div className="w-12 h-12 border-[1.5px] border-ink flex items-center justify-center">
        <span className="font-mono text-[20px] text-ink">✓</span>
      </div>
      <div>
        <h2 className="font-serif text-[28px] tracking-tight text-ink mb-2.5">Thank you</h2>
        <p className="text-[14px] text-dim leading-relaxed max-w-[280px]">
          Your responses have been recorded. You can now close this window.
        </p>
      </div>
      <p className="font-mono text-[11px] text-ghost mt-4">{survey.title}</p>
    </div>
  )
}

function FullMessage({ text, spinner }: { text: string; spinner?: boolean }) {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 font-sans bg-paper">
      {spinner ? (
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-ink"
              style={{ animation: `pp 1.2s ease-in-out ${i * 0.15}s infinite` }} />
          ))}
          <style>{`@keyframes pp{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}`}</style>
        </div>
      ) : <span className="text-[28px] opacity-30">○</span>}
      <p className="text-[14px] text-dim">{text}</p>
    </div>
  )
}
