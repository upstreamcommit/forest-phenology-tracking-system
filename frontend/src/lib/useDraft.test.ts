import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useDraft } from './useDraft'

describe('useDraft', () => {
  it('starts from the value and holds a draft until the value changes', () => {
    const { result, rerender } = renderHook(({ value }) => useDraft(value), {
      initialProps: { value: 2026 },
    })
    expect(result.current[0]).toBe(2026)

    act(() => result.current[1](2025))
    act(() => result.current[1](2024))
    expect(result.current[0]).toBe(2024)

    // A render with the same value keeps the draft.
    rerender({ value: 2026 })
    expect(result.current[0]).toBe(2024)
  })

  it('follows the value whenever it changes, replacing the draft', () => {
    const { result, rerender } = renderHook(({ value }) => useDraft(value), {
      initialProps: { value: 'a' },
    })
    act(() => result.current[1]('draft'))

    rerender({ value: 'b' })
    expect(result.current[0]).toBe('b')

    act(() => result.current[1]('next draft'))
    rerender({ value: 'a' })
    expect(result.current[0]).toBe('a')
  })
})
