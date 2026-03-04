import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-paper flex">
      {/* Left panel — decorative */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between p-12 bg-ink text-paper border-r border-mark">
        <div>
          <p className="font-serif text-[22px] leading-tight">voxform</p>
          <span className="inline-block mt-2 px-2 py-0.5 text-[10px] font-mono border border-violet text-violet uppercase tracking-widest">Beta</span>
        </div>
        <div className="space-y-6">
          <p className="font-serif text-[32px] leading-[1.15] tracking-tight">
            Field research,<br />
            <em>precisely captured.</em>
          </p>
          <p className="text-[13px] text-ghost leading-relaxed max-w-[280px]">
            Audio-native surveys for researchers who need truth from the field, not approximations.
          </p>
          <div className="flex gap-8 pt-2">
            {[['WAV', '16kHz'], ['Offline', 'PWA'], ['AI', 'Transcription']].map(([val, lbl]) => (
              <div key={lbl}>
                <p className="font-serif text-[16px] text-paper">{val}</p>
                <p className="text-[11px] text-ghost font-mono">{lbl}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-ghost font-mono">© {new Date().getFullYear()} Voxform</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[380px]">
          <p className="lg:hidden font-serif text-[20px] text-ink mb-10">voxform</p>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
