import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted ring-line',
  accent: 'bg-accent-soft text-accent ring-accent/30',
  ok: 'bg-ok-soft text-ok ring-ok/30',
  warn: 'bg-warn-soft text-warn ring-warn/30',
  danger: 'bg-danger-soft text-danger ring-danger/30',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}
