import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken, clearToken } from '@/lib/api/client'

export interface AuthUser {
  id: string; name: string; email: string; role: string; orgId: string
  org: { id: string; name: string; plan: string }
}

let globalUser: AuthUser | null = null
const listeners = new Set<() => void>()
function notify() { listeners.forEach(fn => fn()) }

export function useAuth() {
  const [user, setUserState] = useState<AuthUser | null>(globalUser)
  const [loading, setLoading] = useState(!globalUser)
  const navigate = useNavigate()

  useEffect(() => {
    const sync = () => setUserState(globalUser)
    listeners.add(sync)
    return () => { listeners.delete(sync) }
  }, [])

  useEffect(() => {
    if (globalUser) return
    if (!localStorage.getItem('vf_token')) { setLoading(false); return }
    api.get<AuthUser>('/users/me')
      .then(u => { globalUser = u; setUserState(u) })
      .catch(() => { globalUser = null; setUserState(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', { email, password })
    setToken(res.accessToken)
    globalUser = res.user; notify()
    return res.user
  }, [])

  const register = useCallback(async (d: { name: string; email: string; password: string; orgName: string }) => {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/register', d)
    setToken(res.accessToken)
    globalUser = res.user; notify()
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout') } catch { /* best effort */ }
    clearToken(); globalUser = null; notify()
    navigate('/login')
  }, [navigate])

  const refreshUser = useCallback(async () => {
    const u = await api.get<AuthUser>('/users/me')
    globalUser = u; notify()
    return u
  }, [])

  return { user, loading, login, register, logout, refreshUser }
}
