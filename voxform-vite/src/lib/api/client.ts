const BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

function token() { return localStorage.getItem('vf_token') }
export function setToken(t: string) { localStorage.setItem('vf_token', t) }
export function clearToken() { localStorage.removeItem('vf_token') }

export async function apiFetch<T>(path: string, init: RequestInit & { skipAuth?: boolean } = {}): Promise<T> {
  const { skipAuth, ...options } = init
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  let sentAuth = false
  if (!skipAuth) {
    const t = token()
    if (t) { headers['Authorization'] = `Bearer ${t}`; sentAuth = true }
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' })

  if (res.status === 401 && sentAuth) {
    const ok = await tryRefresh()
    if (ok) {
      headers['Authorization'] = `Bearer ${token()}`
      const retry = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' })
      if (!retry.ok) throw await toError(retry)
      const d = await retry.json()
      return d.data ?? d
    }
    clearToken()
    if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
      window.location.href = '/login'
    }
    throw new Error('session expired')
  }

  if (!res.ok) throw await toError(res)
  if (res.status === 204) return undefined as T
  const d = await res.json()
  return d.data ?? d
}

async function tryRefresh() {
  try {
    const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    if (!r.ok) return false
    const d = await r.json()
    const t = d.data?.accessToken ?? d.accessToken
    if (t) { setToken(t); return true }
    return false
  } catch { return false }
}

async function toError(res: Response) {
  try {
    const b = await res.json()
    const msg = b.detail?.message ?? b.detail ?? b.message ?? `HTTP ${res.status}`
    return new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  } catch { return new Error(`HTTP ${res.status}`) }
}

export const api = {
  get:    <T>(p: string)            => apiFetch<T>(p),
  post:   <T>(p: string, b?: unknown)   => apiFetch<T>(p, { method: 'POST',   body: JSON.stringify(b) }),
  put:    <T>(p: string, b?: unknown)   => apiFetch<T>(p, { method: 'PUT',    body: JSON.stringify(b) }),
  patch:  <T>(p: string, b?: unknown)   => apiFetch<T>(p, { method: 'PATCH',  body: JSON.stringify(b) }),
  delete: <T>(p: string)            => apiFetch<T>(p, { method: 'DELETE' }),
}
