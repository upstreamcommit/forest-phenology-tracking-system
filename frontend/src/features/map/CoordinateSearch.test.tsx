import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { catalog, gridFor } from '../../test/fixtures'
import { CoordinateSearch } from './CoordinateSearch'
import { buildCells } from './gridLayer'

const cells = buildCells(gridFor(2020), 0.1)
const bbox = catalog.products[0].stored!.bbox

async function search(lat: string, lon: string) {
  const user = userEvent.setup()
  await user.clear(screen.getByLabelText('Latitude'))
  await user.clear(screen.getByLabelText('Longitude'))
  if (lat) await user.type(screen.getByLabelText('Latitude'), lat)
  if (lon) await user.type(screen.getByLabelText('Longitude'), lon)
  await user.click(screen.getByRole('button', { name: 'Find cell' }))
}

describe('CoordinateSearch', () => {
  it('selects the nearest stored cell and says which once it is selected', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <CoordinateSearch cells={cells} bbox={bbox} selected={null} onSelect={onSelect} />,
    )
    await search('51.53', '−0.47')

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ lat: 51.5, lon: -0.5 }))
    rerender(
      <CoordinateSearch
        cells={cells}
        bbox={bbox}
        selected={{ lat: 51.5, lon: -0.5 }}
        onSelect={onSelect}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Selected the nearest stored point, 51.50° N, 0.50° W.',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stops reporting its pick when another point is selected or the selection closes', async () => {
    const onSelect = vi.fn()
    const searched = { lat: 51.5, lon: -0.5 }
    const { rerender } = render(
      <CoordinateSearch cells={cells} bbox={bbox} selected={searched} onSelect={onSelect} />,
    )
    await search('51.5', '-0.5')
    expect(screen.getByRole('status')).toHaveTextContent('Selected the nearest stored point')

    rerender(
      <CoordinateSearch
        cells={cells}
        bbox={bbox}
        selected={{ lat: 51.6, lon: -0.5 }}
        onSelect={onSelect}
      />,
    )
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    // Going back to the searched point (with the browser's Back, say) does not bring it back.
    rerender(<CoordinateSearch cells={cells} bbox={bbox} selected={searched} onSelect={onSelect} />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    await search('51.5', '-0.5')
    expect(screen.getByRole('status')).toHaveTextContent('Selected the nearest stored point')
    rerender(<CoordinateSearch cells={cells} bbox={bbox} selected={null} onSelect={onSelect} />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('accepts a decimal comma and hemisphere letters', async () => {
    const onSelect = vi.fn()
    render(<CoordinateSearch cells={cells} bbox={bbox} selected={null} onSelect={onSelect} />)

    await search('51,53', '0,47 W')
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 51.5, lon: -0.5 }))
    await search('51.8N', '0.2w')
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 51.8, lon: -0.2 }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses plain text inputs, so phone keyboards offer a minus sign', () => {
    render(<CoordinateSearch cells={cells} bbox={bbox} selected={null} onSelect={() => {}} />)
    for (const name of ['Latitude', 'Longitude']) {
      const input = screen.getByLabelText(name)
      expect(input).toHaveAttribute('type', 'text')
      expect(input).not.toHaveAttribute('inputmode')
    }
  })

  it('rejects a point away from the stored grid and quotes its extent', async () => {
    const onSelect = vi.fn()
    render(<CoordinateSearch cells={cells} bbox={bbox} selected={null} onSelect={onSelect} />)
    await search('40', '-3')

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'There is no stored grid point near 40.00° N, 3.00° W. ' +
        'Stored points run from 49.50° N, 7.50° W to 59.00° N, 2.00° E.',
    )
    expect(screen.getByLabelText('Latitude')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Latitude')).toHaveAccessibleDescription(/no stored grid point/)
  })

  it('asks for both numbers', async () => {
    render(<CoordinateSearch cells={cells} bbox={bbox} selected={null} onSelect={() => {}} />)
    await search('51.5', '')
    expect(screen.getByRole('alert')).toHaveTextContent(/Enter both latitude and longitude/)
  })

  it('rejects a hemisphere letter on the wrong axis', async () => {
    const onSelect = vi.fn()
    render(<CoordinateSearch cells={cells} bbox={bbox} selected={null} onSelect={onSelect} />)
    await search('0.5 W', '51.5 N')
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/as decimal degrees/)
  })

  it('rejects impossible coordinates', async () => {
    render(<CoordinateSearch cells={cells} bbox={bbox} selected={null} onSelect={() => {}} />)
    await search('95', '0')
    expect(screen.getByRole('alert')).toHaveTextContent(/Latitude must be between -90 and 90/)
  })

  it('waits for the grid', () => {
    render(<CoordinateSearch cells={undefined} bbox={bbox} selected={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Find cell' })).toBeDisabled()
  })
})
