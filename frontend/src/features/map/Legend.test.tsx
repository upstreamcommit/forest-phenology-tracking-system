import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { buildColourScale, SEQUENTIAL_PALETTE } from './colourScale'
import { Legend } from './Legend'

/** jsdom reports colours as rgb(). */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

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
      'Colours run from dark purple for ≤ 120 days through green to yellow for ≥ 240 days.',
    )
    expect(region).toHaveTextContent(
      'Marked values: ≤ 120 days, 150 days, 180 days, 210 days, ≥ 240 days.',
    )
    expect(within(region).getByText('No data')).toBeInTheDocument()
    expect(region).toHaveTextContent('Dashed outline: NDVI curves available')
  })

  it('says the scale is the same for every year', () => {
    const { legend } = buildColourScale({ metric: 'sos', values: [100], theme: 'light' })
    render(<Legend metric="sos" legend={legend} showComputedArea={false} />)
    expect(screen.getByText('The scale is the same for every year.')).toBeVisible()
  })

  it('draws the gradient from the first palette colour to the last', () => {
    const { legend } = buildColourScale({ metric: 'eos', values: [280], theme: 'light' })
    const { container } = render(<Legend metric="eos" legend={legend} showComputedArea={false} />)

    const bar = container.querySelector<HTMLElement>('[data-legend-bar]')
    const image = bar?.style.backgroundImage ?? ''
    expect(image.startsWith(`linear-gradient(to right, ${rgb(SEQUENTIAL_PALETTE[0])} 0%,`)).toBe(
      true,
    )
    expect(image.endsWith(`${rgb(SEQUENTIAL_PALETTE[SEQUENTIAL_PALETTE.length - 1])} 100%)`)).toBe(
      true,
    )
  })

  it('places the end ticks at the ends of the bar and drops labels that would collide', () => {
    const { legend } = buildColourScale({ metric: 'season_length', theme: 'light' })
    const { container } = render(
      <Legend metric="season_length" legend={legend} showComputedArea={false} />,
    )

    // jsdom has no layout, so the bar keeps the 320px sidebar width.
    const ticks = [...container.querySelectorAll<HTMLElement>('[data-tick]')]
    expect(ticks.map((t) => t.textContent)).toEqual(['≤ 120 days', '180 days', '≥ 240 days'])
    expect(ticks.map((t) => t.style.left)).toEqual(['0%', '50%', '100%'])
    expect(ticks[0]).not.toHaveClass('-translate-x-1/2')
    expect(ticks[2]).toHaveClass('-translate-x-full')
  })

  it('names each forest category next to its colour', () => {
    const { legend } = buildColourScale({ metric: 'forest', values: [1, 0, null], theme: 'dark' })
    render(<Legend metric="forest" legend={legend} showComputedArea={false} />)

    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['Forest', 'Open land', 'No data'])
    if (legend.kind !== 'categories' || !legend.noData) throw new Error('expected categories')
    const colours = [...legend.items.map((i) => i.colour), legend.noData.colour]
    items.forEach((item, i) => {
      const swatch = item.querySelector<HTMLElement>('span[aria-hidden="true"]')
      expect(swatch?.style.backgroundColor).toBe(rgb(colours[i]))
    })
    expect(screen.queryByText(/NDVI curves available/)).not.toBeInTheDocument()
    expect(screen.queryByText(/same for every year/)).not.toBeInTheDocument()
  })

  it('shows the scale without a no-data entry before the grid has loaded', () => {
    const { legend } = buildColourScale({ metric: 'sos', theme: 'light' })
    render(<Legend metric="sos" legend={legend} showComputedArea={false} />)

    expect(screen.getByText('≤ 11 Mar')).toBeInTheDocument()
    expect(screen.queryByText('No data')).not.toBeInTheDocument()
    expect(screen.queryByText(/No cell has a value/)).not.toBeInTheDocument()
  })
})
