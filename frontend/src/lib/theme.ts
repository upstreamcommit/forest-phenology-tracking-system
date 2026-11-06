import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'fpts-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    // Storage can be blocked (private mode, sandboxed frames); fall back to the system.
  }
  return 'system'
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches
    ? 'dark'
    : 'light'
}

/**
 * The user's theme choice, persisted, plus the theme it resolves to. Keeps data-theme on <html>
 * in sync (index.html sets it before first paint) and follows the system while on "system".
 */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY)
    if (!media) return
    const onChange = () => setSystem(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = choice === 'system' ? system : choice

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, [])

  return { choice, resolved, setChoice }
}

/** The theme currently applied to the page, for components (like the map) that draw colours. */
export function useResolvedTheme(): ResolvedTheme {
  const read = (): ResolvedTheme =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  const [theme, setTheme] = useState<ResolvedTheme>(read)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return theme
}
