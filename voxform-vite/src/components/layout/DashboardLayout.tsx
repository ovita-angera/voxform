import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, FileText, MessageSquare, Settings,
  LogOut, Sun, Moon,
} from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { useTheme } from '@/lib/hooks/useTheme'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
  { to: '/surveys',   icon: FileText,         label: 'Surveys' },
  { to: '/responses', icon: MessageSquare,    label: 'Responses' },
  { to: '/settings',  icon: Settings,         label: 'Settings' },
]

export function DashboardLayout() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-paper overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-[220px] shrink-0 flex flex-col border-r border-warm bg-paper">
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-warm">
          <span className="font-serif text-[20px] tracking-tight text-ink">voxform</span>
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" title="online" />
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 h-9 text-[13px] font-sans transition-all group rounded-sm
                 ${isActive
                   ? 'text-ink font-medium bg-warm'
                   : 'text-dim hover:text-ink hover:bg-warm/50'}`
              }
            >
              <Icon size={15} className="shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-warm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-dim truncate">{user?.org?.name}</span>
            <span className="text-[10px] font-mono font-medium bg-ink text-paper px-1.5 py-0.5 shrink-0">{user?.org?.plan}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-violet/20 border border-violet/30 flex items-center justify-center text-[11px] font-medium text-violet shrink-0">
              {user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-ink truncate">{user?.name}</p>
              <p className="text-[11px] text-dim capitalize">{user?.role?.toLowerCase()}</p>
            </div>
            <button onClick={toggle} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className="text-ghost hover:text-ink text-[13px] transition-colors p-1">
              {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
            </button>
            <button onClick={handleLogout} title="Sign out"
              className="text-ghost hover:text-ink transition-colors p-1">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
