import { Link } from 'react-router-dom'
import {
  Mic, AlignLeft, User, Hash, Mail, CalendarDays, Phone,
  ToggleLeft, CheckSquare, ChevronDown, Grid3X3, Upload,
  Star, Headphones, Brain, BarChart3, Shield, Zap,
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

const FEATURES = [
  {
    icon: Mic,
    title: 'Audio-native responses',
    desc: 'Capture voice responses in high-quality WAV format (16kHz). Ideal for field research where text is insufficient.',
  },
  {
    icon: Brain,
    title: 'AI transcription & extraction',
    desc: 'Groq Whisper automatically transcribes audio. Claude AI extracts structured insights — locale-aware and configurable.',
  },
  {
    icon: BarChart3,
    title: 'Actionable insights',
    desc: 'Sentiment analysis, response statistics, and download in all major formats. Your data, your way.',
  },
  {
    icon: Shield,
    title: 'Quality control built-in',
    desc: 'SNR, dBFS, and frequency thresholds ensure every audio response meets your quality bar before processing.',
  },
  {
    icon: Zap,
    title: 'Offline-capable',
    desc: 'PWA-ready. Field researchers can capture responses in areas with poor connectivity and sync when back online.',
  },
  {
    icon: Grid3X3,
    title: '16 question types',
    desc: 'From simple text to voice, video, matrix grids, and file uploads. Every data collection need covered.',
  },
]

export function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-ink font-sans">
      {/* ── Nav ── */}
      <nav className="h-16 flex items-center justify-between px-4 sm:px-8 border-b border-warm/60">
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
        <div className="inline-flex items-center gap-2 px-3 py-1 border border-violet/30 bg-violet/5 text-[11px] font-mono text-violet uppercase tracking-widest mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-violet" />
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
        <div className="mt-16 grid grid-cols-3 gap-px bg-warm border border-warm max-w-lg mx-auto">
          {[
            ['WAV', '16 kHz lossless'],
            ['Free', 'Groq Whisper tier'],
            ['16', 'question types'],
          ].map(([val, lbl]) => (
            <div key={lbl} className="bg-paper px-5 py-4 text-center">
              <p className="font-serif text-[22px] text-ink">{val}</p>
              <p className="font-mono text-[10px] text-dim uppercase tracking-wider mt-0.5">{lbl}</p>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-warm border border-warm">
            {FEATURES.map(f => {
              const Icon = f.icon
              return (
                <div key={f.title} className="bg-paper px-6 py-7 space-y-3">
                  <div className="w-9 h-9 border border-warm flex items-center justify-center">
                    <Icon size={16} className="text-violet" />
                  </div>
                  <p className="font-medium text-[15px] text-ink">{f.title}</p>
                  <p className="text-[13px] text-dim leading-relaxed">{f.desc}</p>
                </div>
              )
            })}
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
                <div key={t.label} className="flex flex-col items-center gap-2 px-3 py-4 border border-warm bg-paper hover:border-violet hover:bg-violet/5 transition-all group cursor-default">
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
        <div className="max-w-2xl mx-auto px-4 sm:px-8 py-12 sm:py-16 text-center space-y-6">
          <h2 className="font-serif text-[36px] tracking-tight leading-tight">
            Ready to capture better data?
          </h2>
          <p className="text-[14px] text-ghost leading-relaxed">
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
