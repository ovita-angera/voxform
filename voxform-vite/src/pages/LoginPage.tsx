import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/hooks/useAuth'
import { Btn, Input } from '@/components/ui'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-[30px] tracking-tight text-ink">Sign in</h1>
        <p className="text-[13px] text-dim mt-1">Enter your workspace credentials</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@org.com" required autoComplete="email" />
        <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" />

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[12px] text-dim hover:text-ink font-mono">Forgot password?</Link>
        </div>

        {error && (
          <p className="text-[13px] text-red-600 py-2.5 px-4 border border-red-200 bg-red-50">{error}</p>
        )}

        <Btn type="submit" className="w-full" disabled={loading} size="lg">
          {loading ? 'Signing in…' : 'Sign in'}
        </Btn>
      </form>

      <div className="border-t border-warm pt-5 space-y-2">
        <p className="text-[11px] font-mono text-dim uppercase tracking-widest">Demo credentials</p>
        {[['admin@nri.ac.ke', 'voxform123'], ['surveyor@nri.ac.ke', 'voxform123']].map(([e, p]) => (
          <button key={e} onClick={() => { setEmail(e); setPassword(p) }}
            className="w-full text-left px-3 py-2 border border-warm hover:border-ink transition-colors group">
            <p className="text-[12px] font-mono text-dim group-hover:text-ink">{e}</p>
          </button>
        ))}
      </div>

      <p className="text-[13px] text-dim text-center">
        No account? <Link to="/register" className="text-ink font-medium hover:underline">Create one</Link>
      </p>
    </div>
  )
}
