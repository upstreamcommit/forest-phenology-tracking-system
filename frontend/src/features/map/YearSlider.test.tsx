import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { YearSlider } from './YearSlider'

const YEARS = [2016, 2017, 2018, 2020]

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

  it('moves one year with the previous and next buttons', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<YearSlider years={YEARS} value={2018} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(onChange).toHaveBeenLastCalledWith(2017)
    await user.click(screen.getByRole('button', { name: 'Next year' }))
    expect(onChange).toHaveBeenLastCalledWith(2020)
  })

  it('disables the buttons at either end', () => {
    const { rerender } = render(<YearSlider years={YEARS} value={2016} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Previous year' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next year' })).toBeEnabled()
    rerender(<YearSlider years={YEARS} value={2020} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled()
  })
})
