import { useState } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { useTheme } from '@/lib/hooks/useTheme'
import { api } from '@/lib/api/client'
import { Btn, Input } from '@/components/ui'
import { Check, Zap } from 'lucide-react'

export function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState(user?.name ?? '')
  const [saved, setSaved] = useState(false)
  const [planLoading, setPlanLoading] = useState(false)
  const [planMsg, setPlanMsg] = useState('')

  const isPro = (user?.org?.plan ?? '').toUpperCase() === 'PRO'

  async function saveProfile() {
    await api.put('/users/me', { name })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function switchPlan(target: 'FREE' | 'PRO') {
    setPlanLoading(true); setPlanMsg('')
    try {
      await api.put('/orgs/plan', { plan: target })
      await refreshUser()
    } catch {
      setPlanMsg('Failed to update plan. Please try again.')
    } finally {
      setPlanLoading(false)
    }
  }

  const proFeatures = [
    'QR code generation & download',
    'Unlimited surveys & responses',
    'Advanced audio quality thresholds',
    'Priority transcription queue',
    'CSV / JSON export',
  ]
  const freeFeatures = [
    'Up to 5 active surveys',
    'Up to 100 responses / month',
    'All question types',
    'WAV audio recording & storage',
    'Basic transcription (Groq)',
  ]

  return (
    <div className="max-w-lg mx-auto px-8 py-10">
      <h1 className="font-serif text-[32px] tracking-tight text-ink mb-8">Settings</h1>

      <div className="space-y-8">
        {/* Profile */}
        <div className="border border-warm">
          <div className="px-5 py-3.5 border-b border-warm">
            <p className="text-[12px] font-mono text-dim uppercase tracking-widest">Profile</p>
          </div>
          <div className="px-5 py-5 space-y-4">
            <Input label="Name" value={name} onChange={e => setName(e.target.value)} />
            <Input label="Email" value={user?.email ?? ''} disabled className="opacity-50 cursor-not-allowed" />
            <Input label="Role" value={user?.role?.toLowerCase() ?? ''} disabled className="opacity-50 cursor-not-allowed" />
            <Btn size="sm" onClick={saveProfile}>{saved ? '✓ Saved' : 'Save changes'}</Btn>
          </div>
        </div>

        {/* Plan */}
        <div className="border border-warm">
          <div className="px-5 py-3.5 border-b border-warm flex items-center justify-between">
            <p className="text-[12px] font-mono text-dim uppercase tracking-widest">Plan</p>
            <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-sm ${isPro ? 'bg-violet text-white' : 'bg-ink text-paper'}`}>
              {user?.org?.plan ?? 'FREE'}
            </span>
          </div>
          <div className="px-5 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {/* Free card */}
              <div className={`rounded-xl border p-4 space-y-3 transition-all ${!isPro ? 'border-ink bg-ink/3' : 'border-warm'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-ink">Free</p>
                  {!isPro && <Check size={13} className="text-ink" />}
                </div>
                <p className="text-[18px] font-serif text-ink">$0<span className="text-[12px] font-sans text-dim">/mo</span></p>
                <ul className="space-y-1.5">
                  {freeFeatures.map(f => (
                    <li key={f} className="flex items-start gap-1.5 text-[11px] text-dim">
                      <Check size={10} className="mt-[3px] shrink-0 text-dim" />{f}
                    </li>
                  ))}
                </ul>
                {isPro && (
                  <button onClick={() => switchPlan('FREE')} disabled={planLoading}
                    className="w-full h-8 text-[12px] font-mono border border-warm rounded-lg text-dim hover:text-ink hover:border-ink transition-all disabled:opacity-40">
                    Downgrade
                  </button>
                )}
              </div>
              {/* Pro card */}
              <div className={`rounded-xl border p-4 space-y-3 transition-all ${isPro ? 'border-violet bg-violet/5' : 'border-warm'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-violet">Pro</p>
                  {isPro && <Check size={13} className="text-violet" />}
                </div>
                <p className="text-[18px] font-serif text-ink">$12<span className="text-[12px] font-sans text-dim">/mo</span></p>
                <ul className="space-y-1.5">
                  {proFeatures.map(f => (
                    <li key={f} className="flex items-start gap-1.5 text-[11px] text-dim">
                      <Check size={10} className="mt-[3px] shrink-0 text-violet" />{f}
                    </li>
                  ))}
                </ul>
                {!isPro && (
                  <button onClick={() => switchPlan('PRO')} disabled={planLoading}
                    className="w-full h-8 text-[12px] font-mono bg-violet text-white rounded-lg hover:bg-violet/90 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5">
                    <Zap size={11} />Upgrade
                  </button>
                )}
              </div>
            </div>
            {planMsg && <p className="text-[12px] font-mono text-red-500">{planMsg}</p>}
            <div className="flex items-center justify-between py-2 border-t border-warm">
              <span className="text-[13px] text-dim">Organisation</span>
              <span className="text-[13px] font-medium text-ink">{user?.org?.name}</span>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="border border-warm">
          <div className="px-5 py-3.5 border-b border-warm">
            <p className="text-[12px] font-mono text-dim uppercase tracking-widest">Appearance</p>
          </div>
          <div className="px-5 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] text-ink font-medium">Theme</p>
                <p className="text-[12px] text-dim font-mono mt-0.5">Light or dark interface</p>
              </div>
              <div className="flex border border-warm">
                {(['light', 'dark'] as const).map(t => (
                  <button key={t} onClick={() => setTheme(t)}
                    className={`px-4 h-8 text-[12px] font-mono capitalize transition-colors
                      ${theme === t ? 'bg-ink text-paper' : 'bg-paper text-dim hover:text-ink'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
