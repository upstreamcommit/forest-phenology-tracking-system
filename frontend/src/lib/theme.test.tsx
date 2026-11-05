import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResolvedTheme, useTheme } from './theme'

/** A prefers-color-scheme query whose answer the test can change, like the OS setting. */
function fakeSystemTheme(dark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  return {
    set(next: boolean) {
      media.matches = next
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

function ThemeProbe() {
  const { choice, resolved } = useTheme()
  return <p>{`${choice}: ${resolved}`}</p>
}

function ResolvedProbe() {
  return <p>{useResolvedTheme()}</p>
}

describe('useTheme', () => {
  it('applies a saved choice over the system theme', () => {
    fakeSystemTheme(false)
    localStorage.setItem('fpts-theme', 'dark')
    render(<ThemeProbe />)
    expect(screen.getByText('dark: dark')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('ignores an unknown saved value', () => {
    fakeSystemTheme(true)
    localStorage.setItem('fpts-theme', 'sepia')
    render(<ThemeProbe />)
    expect(screen.getByText('system: dark')).toBeInTheDocument()
  })

  it('follows the system theme while on Auto', () => {
    const system = fakeSystemTheme(false)
    render(<ThemeProbe />)
    expect(screen.getByText('system: light')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')

    system.set(true)
    expect(screen.getByText('system: dark')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('dark')

    system.set(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('keeps an explicit choice when the system theme changes', () => {
    const system = fakeSystemTheme(false)
    localStorage.setItem('fpts-theme', 'light')
    render(<ThemeProbe />)
    system.set(true)
    expect(screen.getByText('light: light')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('useResolvedTheme', () => {
  it('updates when data-theme on <html> changes', async () => {
    document.documentElement.dataset.theme = 'light'
    render(<ResolvedProbe />)
    expect(screen.getByText('light')).toBeInTheDocument()

    document.documentElement.dataset.theme = 'dark'
    expect(await screen.findByText('dark')).toBeInTheDocument()

    document.documentElement.dataset.theme = 'light'
    expect(await screen.findByText('light')).toBeInTheDocument()
  })
})
