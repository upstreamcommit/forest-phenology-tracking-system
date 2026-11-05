import type { ReactNode } from 'react'

import { Spinner } from './Spinner'

type Tone = 'loading' | 'error' | 'empty' | 'info'

interface StatusMessageProps {
  tone: Tone
  title: string
  children?: ReactNode
  action?: ReactNode
}

const BOX: Record<Tone, string> = {
  loading: 'border-line bg-surface',
  error: 'border-danger/40 bg-danger-soft',
  empty: 'border-line border-dashed bg-surface',
  info: 'border-line bg-surface-sunken',
}

/** Loading, error, empty and info states, announced to assistive technology. */
export function StatusMessage({ tone, title, children, action }: StatusMessageProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border p-4 text-sm ${BOX[tone]}`}
    >
      {tone === 'loading' ? (
        <Spinner label={title} />
      ) : (
        <p className={`font-medium ${tone === 'error' ? 'text-danger' : 'text-ink'}`}>{title}</p>
      )}
      {children && <div className="mt-1 text-ink-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
