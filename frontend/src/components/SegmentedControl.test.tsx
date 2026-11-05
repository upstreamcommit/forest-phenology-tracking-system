import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { SegmentedControl } from './SegmentedControl'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

function Harness() {
  const [value, setValue] = useState('b')
  return <SegmentedControl label="Letter" options={OPTIONS} value={value} onChange={setValue} />
}

describe('SegmentedControl', () => {
  it('fills the checked option with the accent, which contrasts 3:1 with the track', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const checked = screen.getByRole('radio', { name: 'Beta' })
    expect(checked).toHaveAttribute('aria-checked', 'true')
    expect(checked).toHaveClass('bg-accent', 'text-accent-ink')
    for (const name of ['Alpha', 'Gamma']) {
      expect(screen.getByRole('radio', { name })).not.toHaveClass('bg-accent')
    }

    await user.click(screen.getByRole('radio', { name: 'Gamma' }))
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveClass('bg-accent', 'text-accent-ink')
    expect(screen.getByRole('radio', { name: 'Beta' })).not.toHaveClass('bg-accent')
  })

  it('moves the selection with the arrow keys and keeps one tab stop', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.tab()
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0)).toHaveLength(1)
  })
})
