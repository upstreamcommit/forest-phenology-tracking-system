import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { YearSlider } from './YearSlider'

const YEARS = [2016, 2017, 2018, 2020]

function ControlledSlider({ initial }: { initial: number }) {
  const [year, setYear] = useState(initial)
  return <YearSlider years={YEARS} value={year} onChange={setYear} />
}

describe('YearSlider', () => {
  it('is a labelled slider that announces the year', () => {
    render(<YearSlider years={YEARS} value={2017} onChange={() => {}} />)
    const slider = screen.getByRole('slider', { name: 'Year' })
    expect(slider).toHaveValue('1')
    expect(slider).toHaveAttribute('aria-valuetext', '2017')
  })

  it('steps through the stored years, skipping gaps', () => {
    const onChange = vi.fn()
    render(<YearSlider years={YEARS} value={2018} onChange={onChange} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Year' }), { target: { value: '3' } })
    expect(onChange).toHaveBeenLastCalledWith(2020)
  })

  it('shows each step at once while the value catches up, then follows the value', () => {
    // The value comes from the URL, which updates after the event: until then each step must
    // start from the last one, not from the old value.
    const onChange = vi.fn()
    const { rerender } = render(<YearSlider years={YEARS} value={2020} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: 'Year' })

    fireEvent.change(slider, { target: { value: '2' } })
    expect(slider).toHaveValue('2')
    expect(slider).toHaveAttribute('aria-valuetext', '2018')
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(onChange.mock.calls).toEqual([[2018], [2017]])
    expect(slider).toHaveAttribute('aria-valuetext', '2017')

    rerender(<YearSlider years={YEARS} value={2016} onChange={onChange} />)
    expect(slider).toHaveAttribute('aria-valuetext', '2016')
  })

  it('moves one year with the previous and next buttons', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<YearSlider years={YEARS} value={2018} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(onChange).toHaveBeenLastCalledWith(2017)
    await user.click(screen.getByRole('button', { name: 'Next year' }))
    expect(onChange).toHaveBeenLastCalledWith(2018)
  })

  it('marks the buttons unavailable at either end, without making them unfocusable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<YearSlider years={YEARS} value={2016} onChange={onChange} />)
    const previous = screen.getByRole('button', { name: 'Previous year' })
    expect(previous).toHaveAttribute('aria-disabled', 'true')
    expect(previous).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next year' })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
    await user.click(previous)
    expect(onChange).not.toHaveBeenCalled()

    rerender(<YearSlider years={YEARS} value={2020} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Next year' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('keeps focus on a button that reaches the end of the range', async () => {
    const user = userEvent.setup()
    render(<ControlledSlider initial={2018} />)
    const next = screen.getByRole('button', { name: 'Next year' })

    await user.click(next)

    expect(screen.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2020')
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(next).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2020')
  })
})
