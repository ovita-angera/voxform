import { Link } from 'react-router-dom'
import {
  Mic, AlignLeft, User, Hash, Mail, CalendarDays, Phone,
  ToggleLeft, CheckSquare, ChevronDown, Grid3X3, Upload,
  Star, Headphones,
} from 'lucide-react'
import { Btn } from '@/components/ui'

const INPUT_TYPES = [
  { icon: Mic,          label: 'Voice Response' },
  { icon: AlignLeft,    label: 'Text Input' },
  { icon: User,         label: 'Name' },
  { icon: Headphones,   label: 'Audio Question' },
  { icon: Hash,         label: 'Numeric Input' },
  { icon: Mail,         label: 'Email' },
  { icon: CalendarDays, label: 'Date Picker' },
  { icon: Phone,        label: 'Phone Number' },
  { icon: ToggleLeft,   label: 'Yes / No' },
  { icon: CheckSquare,  label: 'Checkbox' },
  { icon: ChevronDown,  label: 'Dropdown' },
  { icon: Grid3X3,      label: 'Matrix' },
  { icon: Upload,       label: 'File Upload' },
  { icon: Star,         label: 'Rating' },
]

// ── Feature illustrations ──────────────────────────────────────────────────────
function IllustWaveform() {
  const hs = [10, 20, 32, 40, 44, 38, 28, 16, 8]
  const cs = ['#98C1D9','#6969B3','#533A7B','#4B244A','#4B244A','#533A7B','#533A7B','#6969B3','#98C1D9']
  return (
    <svg viewBox="0 0 80 52" width="80" height="52" fill="none" aria-hidden>
      {hs.map((h, i) => (
        <rect key={i} x={4 + i * 8} y={48 - h} width={5} height={h} rx="2.5" fill={cs[i]} opacity={0.9} />
      ))}
    </svg>
  )
}

function IllustTranscription() {
  const barHs = [10, 18, 14, 22, 12]
  const barCs = ['#6969B3','#533A7B','#4B244A','#533A7B','#6969B3']
  const lineWs = [22, 16, 20, 13]
  const lineCs = ['#533A7B','#6969B3','#533A7B','#98C1D9']
  return (
    <svg viewBox="0 0 80 52" width="80" height="52" fill="none" aria-hidden>
      {barHs.map((h, i) => (
        <rect key={i} x={2 + i * 6} y={30 - h / 2} width={4} height={h} rx="2" fill={barCs[i]} opacity={0.85} />
      ))}
      <path d="M35 26h10M41 22l4 4-4 4" stroke="#9A9490" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      {lineWs.map((w, i) => (
        <rect key={i} x={50} y={12 + i * 10} width={w} height={3.5} rx="1.75" fill={lineCs[i]} opacity={0.8} />
      ))}
    </svg>
  )
}

function IllustChart() {
  const bars = [
    { h: 18, c: '#98C1D9' }, { h: 28, c: '#6969B3' }, { h: 38, c: '#533A7B' },
    { h: 30, c: '#4B244A' }, { h: 22, c: '#6969B3' },
  ]
  return (
    <svg viewBox="0 0 80 52" width="80" height="52" fill="none" aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={8 + i * 14} y={46 - b.h} width={10} height={b.h} rx="2" fill={b.c} opacity={0.88} />
      ))}
      <line x1="4" y1="46" x2="76" y2="46" stroke="#E8E4DC" strokeWidth="1.5"/>
    </svg>
  )
}

function IllustGauge() {
  // Semicircle gauge: center (40,48), radius 26. Zones split at 120° and 60°.
  // 180°=(14,48), 120°=(27,26), 60°=(53,26), 0°=(66,48)
  // Needle pointing ~45° (good zone): (40,48)→(56,32)
  return (
    <svg viewBox="0 0 80 52" width="80" height="52" fill="none" aria-hidden>
      <path d="M14 48 A26 26 0 0 1 27 26" stroke="#4B244A" strokeWidth="6" strokeLinecap="round"/>
      <path d="M27 26 A26 26 0 0 1 53 26" stroke="#6969B3" strokeWidth="6" strokeLinecap="round"/>
      <path d="M53 26 A26 26 0 0 1 66 48" stroke="#98C1D9" strokeWidth="6" strokeLinecap="round"/>
      <line x1="40" y1="48" x2="57" y2="31" stroke="#25171A" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="40" cy="48" r="3.5" fill="#25171A"/>
      <path d="M60 20l-3 5 3-1-2 6 6-8h-4l3-2Z" fill="#98C1D9" opacity={0.9}/>
    </svg>
  )
}

function IllustOffline() {
  // WiFi arcs + checkmark badge
  return (
    <svg viewBox="0 0 80 52" width="80" height="52" fill="none" aria-hidden>
      <circle cx="40" cy="44" r="3.5" fill="#533A7B"/>
      <path d="M31 39 A12 12 0 0 0 49 39" stroke="#533A7B" strokeWidth="3" strokeLinecap="round"/>
      <path d="M23 31 A20 20 0 0 0 57 31" stroke="#6969B3" strokeWidth="3" strokeLinecap="round"/>
      <path d="M15 23 A28 28 0 0 0 65 23" stroke="#98C1D9" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 3"/>
      <circle cx="62" cy="14" r="9" fill="#533A7B" opacity={0.9}/>
      <path d="M58 14l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IllustGrid() {
  const cs = [
    ['#533A7B','#6969B3','#98C1D9','#4B244A'],
    ['#6969B3','#533A7B','#4B244A','#6969B3'],
    ['#98C1D9','#4B244A','#533A7B','#98C1D9'],
  ]
  return (
    <svg viewBox="0 0 80 52" width="80" height="52" fill="none" aria-hidden>
      {cs.map((row, ri) => row.map((c, ci) => (
        <rect key={`${ri}-${ci}`}
          x={10 + ci * 16} y={6 + ri * 14}
          width={13} height={10} rx="2.5"
          fill={c} opacity={0.7 + ((ci + ri) % 3) * 0.08}
        />
      )))}
    </svg>
  )
}

const FEATURES = [
  {
    Illust: IllustWaveform,
    bg: 'linear-gradient(135deg, rgba(83,58,123,0.08) 0%, rgba(75,36,74,0.05) 100%)',
    title: 'Audio-native responses',
    desc: 'Capture voice responses in high-quality WAV format (16kHz). Ideal for field research where text is insufficient.',
  },
  {
    Illust: IllustTranscription,
    bg: 'linear-gradient(135deg, rgba(105,105,179,0.08) 0%, rgba(152,193,217,0.07) 100%)',
    title: 'AI transcription & extraction',
    desc: 'Groq Whisper automatically transcribes audio. Claude AI extracts structured insights — locale-aware and configurable.',
  },
  {
    Illust: IllustChart,
    bg: 'linear-gradient(135deg, rgba(75,36,74,0.09) 0%, rgba(83,58,123,0.06) 100%)',
    title: 'Actionable insights',
    desc: 'Sentiment analysis, response statistics, and download in all major formats. Your data, your way.',
  },
  {
    Illust: IllustGauge,
    bg: 'linear-gradient(135deg, rgba(105,105,179,0.08) 0%, rgba(152,193,217,0.07) 100%)',
    title: 'Quality control built-in',
    desc: 'SAT, SNR, and SSL thresholds ensure every audio response meets your quality bar before processing.',
  },
  {
    Illust: IllustOffline,
    bg: 'linear-gradient(135deg, rgba(83,58,123,0.07) 0%, rgba(105,105,179,0.09) 100%)',
    title: 'Offline-capable',
    desc: 'PWA-ready. Field researchers can capture responses in areas with poor connectivity and sync when back online.',
  },
  {
    Illust: IllustGrid,
    bg: 'linear-gradient(135deg, rgba(83,58,123,0.09) 0%, rgba(105,105,179,0.07) 100%)',
    title: '16 question types',
    desc: 'From simple text to voice, video, matrix grids, and file uploads. Every data collection need covered.',
  },
]

export function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-ink font-sans">
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-40 h-16 flex items-center justify-between px-4 sm:px-8 border-b border-warm/60 bg-paper/95 backdrop-blur-sm">
        <span className="font-serif text-[20px] tracking-tight text-ink">voxform</span>
        <div className="flex items-center gap-4">
          <Link to="/login" className="text-[13px] text-dim hover:text-ink font-mono transition-colors">Sign in</Link>
          <Link to="/register">
            <Btn variant="violet" size="sm">Get started</Btn>
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-8 pt-16 sm:pt-24 pb-14 sm:pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-violet/30 bg-violet/5 text-[11px] font-mono text-violet uppercase tracking-widest mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-violet animate-pulse" />
          Audio-native survey platform
        </div>
        <h1 className="font-serif text-[clamp(40px,7vw,72px)] leading-[1.05] tracking-tight text-ink mb-6">
          Survey with<br />
          <em className="text-violet">your voice.</em>
        </h1>
        <p className="text-[16px] text-dim leading-relaxed max-w-[520px] mx-auto mb-10">
          Voxform lets researchers capture high-fidelity audio responses, transcribe them automatically, and extract structured insights — all in one workflow.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link to="/register">
            <Btn variant="violet" size="lg">Start for free →</Btn>
          </Link>
          <Link to="/login">
            <Btn variant="outline" size="lg">Sign in</Btn>
          </Link>
        </div>

        {/* Stat strip */}
        <div className="mt-16 grid grid-cols-3 gap-px bg-warm/60 border border-warm rounded-2xl overflow-hidden max-w-lg mx-auto shadow-sm">
          {[
            ['WAV', '16 kHz lossless'],
            ['Free', 'Groq Whisper tier'],
            ['16', 'question types'],
          ].map(([val, lbl]) => (
            <div key={lbl} className="bg-paper px-5 py-5 text-center">
              <p className="font-serif text-[24px] text-ink leading-none">{val}</p>
              <p className="font-mono text-[10px] text-dim uppercase tracking-wider mt-1.5">{lbl}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="border-t border-warm">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
          <div className="text-center mb-14">
            <p className="font-mono text-[11px] text-dim uppercase tracking-widest mb-3">Why Voxform</p>
            <h2 className="font-serif text-[36px] tracking-tight text-ink">Built for serious field research</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(f => (
              <div key={f.title}
                className="rounded-xl border border-warm bg-paper shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden">
                <div className="h-28 flex items-center justify-center border-b border-warm/60"
                  style={{ background: f.bg }}>
                  <f.Illust />
                </div>
                <div className="px-5 py-5 space-y-2">
                  <p className="font-medium text-[15px] text-ink">{f.title}</p>
                  <p className="text-[13px] text-dim leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Question types showcase ── */}
      <section className="border-t border-warm bg-warm/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
          <div className="text-center mb-12">
            <p className="font-mono text-[11px] text-dim uppercase tracking-widest mb-3">Question types</p>
            <h2 className="font-serif text-[36px] tracking-tight text-ink">Every data collection need covered</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {INPUT_TYPES.map(t => {
              const Icon = t.icon
              return (
                <div key={t.label} className="flex flex-col items-center gap-2 px-3 py-4 rounded-xl border border-warm bg-paper hover:border-violet hover:bg-violet/5 hover:shadow-sm transition-all group cursor-default">
                  <Icon size={18} className="text-dim group-hover:text-violet transition-colors" />
                  <span className="text-[11px] font-mono text-dim group-hover:text-ink transition-colors text-center leading-tight">{t.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── CTA strip ── */}
      <section className="border-t border-warm bg-ink text-paper">
        <div className="max-w-2xl mx-auto px-4 sm:px-8 py-14 sm:py-20 text-center space-y-6">
          <p className="font-mono text-[11px] text-ghost/60 uppercase tracking-widest">Get started today</p>
          <h2 className="font-serif text-[clamp(28px,5vw,44px)] tracking-tight leading-[1.1]">
            Ready to capture<br />better data?
          </h2>
          <p className="text-[14px] text-ghost leading-relaxed max-w-xs mx-auto">
            Free to start. No credit card required. Works offline.
          </p>
          <Link to="/register">
            <Btn variant="violet" size="lg">Create your workspace →</Btn>
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-warm/30 px-4 sm:px-8 py-6 flex items-center justify-between">
        <span className="font-serif text-[15px] text-dim">voxform</span>
        <p className="font-mono text-[11px] text-dim">© {new Date().getFullYear()} Voxform. Audio-native surveys.</p>
      </footer>
    </div>
  )
}
