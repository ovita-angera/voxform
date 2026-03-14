import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/hooks/useAuth'
import { Btn, Input } from '@/components/ui'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (step === 1) { setStep(2); return }
    setLoading(true); setError('')
    try {
      await register(form)
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        {['Account', 'Workspace'].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-5 h-5 border flex items-center justify-center text-[11px] font-mono transition-all
              ${i + 1 <= step ? 'bg-ink text-paper border-ink' : 'bg-paper text-ghost border-warm'}`}>
              {i + 1 < step ? '✓' : i + 1}
            </div>
            <span className={`text-[12px] font-mono ${i + 1 === step ? 'text-ink' : 'text-ghost'}`}>{label}</span>
            {i === 0 && <span className="text-ghost mx-1">—</span>}
          </div>
        ))}
      </div>

      <div>
        <h1 className="font-serif text-[30px] tracking-tight text-ink">
          {step === 1 ? 'Create account' : 'Name your workspace'}
        </h1>
        <p className="text-[13px] text-dim mt-1">
          {step === 1 ? 'Your personal credentials' : 'One workspace per organisation'}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {step === 1 ? (
          <>
            <Input label="Full name" type="text" value={form.name} onChange={set('name')} placeholder="Jane Mwangi" required />
            <Input label="Work email" type="email" value={form.email} onChange={set('email')} placeholder="jane@org.com" required />
            <Input label="Password" type="password" value={form.password} onChange={set('password')} placeholder="Min. 8 characters" required minLength={8} />
          </>
        ) : (
          <Input label="Organisation name" type="text" value={form.orgName} onChange={set('orgName')} placeholder="Nairobi Research Institute" required autoFocus />
        )}

        {error && <p className="text-[13px] text-red-600 py-2.5 px-4 rounded-lg border border-red-200 bg-red-50">{error}</p>}

        <div className="flex gap-3">
          {step === 2 && (
            <Btn type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">← Back</Btn>
          )}
          <Btn type="submit" disabled={loading} className="flex-1" size="lg">
            {loading ? 'Creating…' : step === 1 ? 'Continue →' : 'Create workspace'}
          </Btn>
        </div>
      </form>

      <p className="text-[13px] text-dim text-center">
        Have an account? <Link to="/login" className="text-ink font-medium hover:underline">Sign in</Link>
      </p>
    </div>
  )
}
