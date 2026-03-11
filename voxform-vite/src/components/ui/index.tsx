import React from 'react'
import { cn } from '@/lib/utils/cn'

// ── Button ────────────────────────────────────────────────────────────────────
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'solid' | 'outline' | 'ghost' | 'violet'
  size?: 'sm' | 'md' | 'lg'
}

export function Btn({ variant = 'solid', size = 'md', className = '', children, ...props }: BtnProps) {
  const base = 'inline-flex items-center justify-center font-sans font-medium leading-none transition-all focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed'
  const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-5 text-[14px]', lg: 'h-12 px-7 text-[15px]' }
  const variants = {
    solid:   'bg-ink text-paper hover:bg-mark border border-ink',
    outline: 'bg-transparent text-ink border border-warm hover:border-ink hover:bg-warm',
    ghost:   'bg-transparent text-dim hover:text-ink hover:bg-warm border border-transparent',
    violet:  'bg-violet text-paper hover:bg-violet-dim border border-violet',
  }
  return (
    <button className={cn(base, sizes[size], variants[variant], className)} {...props}>
      {children}
    </button>
  )
}

// ── Input ─────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string; error?: string
}
export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-[12px] font-medium text-dim uppercase tracking-wider font-mono">{label}</label>}
      <input
        className={cn('h-11 px-4 bg-paper border rounded-none text-ink text-[14px] font-sans placeholder:text-ghost focus:outline-none focus:border-ink transition-colors', error ? 'border-red-400' : 'border-warm', className)}
        {...props}
      />
      {error && <span className="text-[12px] text-red-500">{error}</span>}
    </div>
  )
}

// ── Textarea ──────────────────────────────────────────────────────────────────
interface TAProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string }
export function Textarea({ label, className = '', ...props }: TAProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-[12px] font-medium text-dim uppercase tracking-wider font-mono">{label}</label>}
      <textarea className={cn('px-4 py-3 bg-paper border border-warm rounded-none text-ink text-[14px] font-sans placeholder:text-ghost focus:outline-none focus:border-ink transition-colors resize-none', className)} {...props} />
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
type BadgeColor = 'ink' | 'warm' | 'green' | 'amber' | 'red' | 'violet'
export function Badge({ color = 'warm', children }: { color?: BadgeColor; children: React.ReactNode }) {
  const c: Record<BadgeColor, string> = {
    ink:    'bg-ink text-paper',
    warm:   'bg-warm text-dim',
    green:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
    amber:  'bg-amber-50 text-amber-700 border border-amber-200',
    red:    'bg-red-50 text-red-600 border border-red-200',
    violet: 'bg-violet/10 text-violet border border-violet/30',
  }
  return <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium tracking-wide rounded-full', c[color])}>{children}</span>
}

// ── Divider ───────────────────────────────────────────────────────────────────
export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="border-warm" />
  return (
    <div className="flex items-center gap-4">
      <hr className="flex-1 border-warm" />
      <span className="text-[11px] text-dim font-mono uppercase tracking-widest">{label}</span>
      <hr className="flex-1 border-warm" />
    </div>
  )
}

// ── StatusDot ─────────────────────────────────────────────────────────────────
const STATUS_MAP: Record<string, { dot: string; label: string }> = {
  ACTIVE:   { dot: 'bg-emerald-500', label: 'Active' },
  DRAFT:    { dot: 'bg-gray-400',    label: 'Draft' },
  PAUSED:   { dot: 'bg-amber-400',   label: 'Paused' },
  CLOSED:   { dot: 'bg-red-400',     label: 'Closed' },
  ARCHIVED: { dot: 'bg-gray-300',    label: 'Archived' },
}
export function StatusDot({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { dot: 'bg-gray-300', label: status }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-dim font-mono">
      <span className={cn('w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function Empty({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <span className="text-4xl opacity-30">{icon}</span>
      <div>
        <p className="font-serif text-[18px] text-ink">{title}</p>
        {sub && <p className="text-[13px] text-dim mt-1">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Skeleton loader ───────────────────────────────────────────────────────────
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cn('animate-pulse bg-warm', className)} />
}
