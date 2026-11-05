import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { buildColourScale } from './colourScale'
import { Legend } from './Legend'

describe('Legend', () => {
  it('labels the gradient in text, not colour alone', () => {
    const { legend } = buildColourScale({
      metric: 'season_length',
      values: [150, 160, 170, null],
      theme: 'light',
    })
    render(<Legend metric="season_length" legend={legend} showComputedArea />)

    const region = screen.getByRole('region', { name: 'Legend: Season length' })
    expect(region).toHaveTextContent(
      'Colours run from dark purple for 150 days through green to yellow for 170 days.',
    )
    expect(within(region).getByText('No data')).toBeInTheDocument()
    expect(region).toHaveTextContent('Dashed outline: NDVI curves available')
  })

  it('names each forest category', () => {
    const { legend } = buildColourScale({ metric: 'forest', values: [1, 0], theme: 'dark' })
    render(<Legend metric="forest" legend={legend} showComputedArea={false} />)

    const items = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual(['Forest', 'Open land'])
    expect(screen.queryByText(/NDVI curves available/)).not.toBeInTheDocument()
  })

  it('says when there is nothing to show', () => {
    const { legend } = buildColourScale({ metric: 'sos', values: [null], theme: 'light' })
    render(<Legend metric="sos" legend={legend} showComputedArea={false} />)
    expect(screen.getByText('No cell has a value for this metric.')).toBeInTheDocument()
  })
})
