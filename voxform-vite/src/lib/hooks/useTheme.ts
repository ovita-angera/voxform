import { useState, useEffect } from 'react'

type Theme = 'light' | 'dark'

function getStored(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem('vf_theme')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

let current: Theme = getStored()
const listeners = new Set<() => void>()

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(current)

  useEffect(() => {
    applyTheme(current)
    const sync = () => setThemeState(current)
    listeners.add(sync)
    return () => { listeners.delete(sync) }
  }, [])

  const setTheme = (t: Theme) => {
    current = t
    localStorage.setItem('vf_theme', t)
    applyTheme(t)
    listeners.forEach(fn => fn())
  }

  const toggle = () => setTheme(current === 'light' ? 'dark' : 'light')

  return { theme, setTheme, toggle }
}
