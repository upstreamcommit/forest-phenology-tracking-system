import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ThresholdControl } from './ThresholdControl'

describe('ThresholdControl', () => {
  it('shows the default as soon as Reset is pressed, before the value comes back', async () => {
    const user = userEvent.setup()
    const onReset = vi.fn()
    // The owner updates `value` later (through the URL), so it stays at 0.4 here.
    render(
      <ThresholdControl value={0.4} defaultValue={0.5} onChange={vi.fn()} onReset={onReset} />,
    )
    const slider = screen.getByRole('slider', { name: 'Season threshold' })
    expect(slider).toHaveAttribute('aria-valuetext', '40% of the seasonal amplitude')

    const reset = screen.getByRole('button', { name: 'Reset the threshold to 50%' })
    await user.click(reset)

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(slider).toHaveAttribute('aria-valuetext', '50% of the seasonal amplitude')
    expect(slider).toHaveValue('0.5')
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(reset).toBeDisabled()
    expect(slider).toHaveFocus()
  })
})
