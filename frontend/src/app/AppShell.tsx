import { NavLink, Outlet } from 'react-router'

import { useCatalog, useHealth } from '../api/queries'
import { Badge } from '../components/Badge'
import { SegmentedControl } from '../components/SegmentedControl'
import { useTheme, type ThemeChoice } from '../lib/theme'

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
]

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-md px-2.5 py-1.5 text-sm font-medium ${
    isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
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
  const catalog = useCatalog()
  return catalog.data?.products.some((p) => p.synthetic === true) ?? false
}

export function AppShell() {
  const { choice, setChoice } = useTheme()
  const synthetic = useShowsSyntheticData()

  return (
    <div className="flex h-full flex-col">
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
            <span>Forest Phenology Explorer</span>
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
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        <Outlet />
      </main>
    </div>
  )
}
