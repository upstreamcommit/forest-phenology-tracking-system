import { useEffect, useRef, type RefObject } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'

import { useCatalog, useHealth } from '../api/queries'
import { Badge } from '../components/Badge'
import { APP_NAME } from '../components/PageTitle'
import { SegmentedControl } from '../components/SegmentedControl'
import { useTheme, type ThemeChoice } from '../lib/theme'

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
]

// The active link is underlined as well as tinted, so it doesn't rely on colour alone.
function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-md px-2.5 py-1.5 text-sm font-medium ${
    isActive
      ? 'bg-accent-soft text-accent underline decoration-2 underline-offset-4'
      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
  }`
}

function ApiStatus() {
  const health = useHealth()
  if (health.isPending) return <Badge>Checking API…</Badge>
  if (health.isError) return <Badge tone="danger">API unreachable</Badge>
  return <Badge tone="ok">API online</Badge>
}

/** True when any product the API serves is synthetic, so the shell can say so on every page. */
function useShowsSyntheticData(): boolean {
  // A catalogue of the wrong shape is a query error (getCatalog checks it), so data is safe here.
  return useCatalog().data?.products.some((p) => p.synthetic === true) ?? false
}

/**
 * After a client-side navigation to another page, moves focus to the new page's heading (an h1
 * with tabIndex -1), or to main while the page is still loading, so screen readers announce it.
 */
function useFocusOnNavigate(main: RefObject<HTMLElement | null>) {
  const { pathname } = useLocation()
  const shownPath = useRef(pathname)

  useEffect(() => {
    if (shownPath.current === pathname) return
    shownPath.current = pathname
    const target = main.current?.querySelector<HTMLElement>('h1[tabindex="-1"]') ?? main.current
    target?.focus()
  }, [main, pathname])
}

export function AppShell() {
  const { choice, setChoice } = useTheme()
  const synthetic = useShowsSyntheticData()
  const mainRef = useRef<HTMLElement>(null)
  useFocusOnNavigate(mainRef)

  return (
    <div className="flex flex-col lg:h-full">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium shadow-panel focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <NavLink to="/" className="flex items-center gap-2 font-semibold text-ink">
            <img src="/leaf.svg" alt="" className="size-6" />
            <span>{APP_NAME}</span>
          </NavLink>
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Map
            </NavLink>
            <NavLink to="/about" className={navClass}>
              Data &amp; methods
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <ApiStatus />
            <SegmentedControl
              label="Theme"
              hideLabel
              options={THEME_OPTIONS}
              value={choice}
              onChange={setChoice}
            />
          </div>
        </div>
        {synthetic && (
          <p className="border-t border-line bg-warn-soft px-4 py-1.5 text-xs text-warn">
            All data shown is <strong>synthetic</strong> demo data, generated to look plausible. It
            is not satellite observation.
          </p>
        )}
      </header>
      <main
        ref={mainRef}
        id="main"
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col outline-none"
      >
        <Outlet />
      </main>
    </div>
  )
}
