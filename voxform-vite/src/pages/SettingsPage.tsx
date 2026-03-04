import { useState } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { useTheme } from '@/lib/hooks/useTheme'
import { api } from '@/lib/api/client'
import { Btn, Input } from '@/components/ui'

export function SettingsPage() {
  const { user } = useAuth()
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState(user?.name ?? '')
  const [saved, setSaved] = useState(false)

  async function saveProfile() {
    await api.put('/users/me', { name })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

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

        {/* Workspace */}
        <div className="border border-warm">
          <div className="px-5 py-3.5 border-b border-warm">
            <p className="text-[12px] font-mono text-dim uppercase tracking-widest">Workspace</p>
          </div>
          <div className="px-5 py-5 space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-warm">
              <span className="text-[13px] text-dim">Organisation</span>
              <span className="text-[13px] font-medium text-ink">{user?.org?.name}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[13px] text-dim">Current plan</span>
              <span className="text-[13px] font-mono font-medium bg-ink text-paper px-2 py-0.5">{user?.org?.plan}</span>
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
