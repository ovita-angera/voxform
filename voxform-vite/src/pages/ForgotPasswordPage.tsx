import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Input } from '@/components/ui'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // TODO: wire to POST /auth/forgot-password
    await new Promise(r => setTimeout(r, 800))
    setSent(true)
    setLoading(false)
  }

  if (sent) return (
    <div className="space-y-6">
      <div className="w-10 h-10 border border-ink flex items-center justify-center font-mono text-ink text-lg">✓</div>
      <div>
        <h1 className="font-serif text-[28px] tracking-tight text-ink">Check your email</h1>
        <p className="text-[13px] text-dim mt-2 leading-relaxed">
          We sent a password reset link to <strong className="text-ink">{email}</strong>. It expires in 15 minutes.
        </p>
      </div>
      <Link to="/login" className="text-[13px] text-dim hover:text-ink font-mono">
        ← Back to sign in
      </Link>
    </div>
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-[30px] tracking-tight text-ink">Reset password</h1>
        <p className="text-[13px] text-dim mt-1">We'll send a reset link to your email</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Input label="Work email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@org.com" required autoFocus />
        <Btn type="submit" className="w-full" disabled={loading} size="lg">
          {loading ? 'Sending…' : 'Send reset link'}
        </Btn>
      </form>

      <Link to="/login" className="text-[13px] text-dim hover:text-ink font-mono">
        ← Back to sign in
      </Link>
    </div>
  )
}
