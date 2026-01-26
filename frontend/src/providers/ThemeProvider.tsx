import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useTenant } from './TenantProvider'

export type ThemeMode = 'light' | 'dark'

type ThemeContextValue = {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const THEME_STORAGE_KEY = 'pf.theme.mode'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function normalizeMode(value: unknown): ThemeMode | null {
  if (value === 'light' || value === 'dark') return value
  return null
}

export function ThemeProvider(props: { children: React.ReactNode }) {
  const tenant = useTenant()

  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = normalizeMode(window.localStorage.getItem(THEME_STORAGE_KEY))
    if (saved) return saved

    const fromTenant = tenant.branding?.defaultTheme === 'DARK' ? 'dark' : 'light'
    return fromTenant
  })

  // If user has never chosen a theme, follow tenant default.
  useEffect(() => {
    const saved = normalizeMode(window.localStorage.getItem(THEME_STORAGE_KEY))
    if (saved) return
    const fromTenant = tenant.branding?.defaultTheme === 'DARK' ? 'dark' : 'light'
    setModeState(fromTenant)
  }, [tenant.branding?.defaultTheme])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', mode === 'dark')
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  }, [mode])

  const value = useMemo<ThemeContextValue>(() => {
    return {
      mode,
      setMode: (next) => setModeState(next),
      toggle: () => setModeState((m) => (m === 'dark' ? 'light' : 'dark')),
    }
  }, [mode])

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
