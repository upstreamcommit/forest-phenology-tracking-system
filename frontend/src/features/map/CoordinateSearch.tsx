import { useId, useState, type FormEvent } from 'react'

import type { BBox } from '../../api/types'
import { Button } from '../../components/Button'
import { formatCoordinates } from '../../lib/format'
import { parseDegrees } from './coordinates'
import { findNearestCell, type CellCollection, type CellProperties } from './gridLayer'

interface CoordinateSearchProps {
  /** The cells on the map; the search is disabled until they load. */
  cells: CellCollection | undefined
  /** Extent of the stored points, quoted when a search misses the grid. */
  bbox: BBox | undefined
  /** The selected point, so the search stops reporting its pick once another is selected. */
  selected: { lat: number; lon: number } | null
  onSelect: (cell: CellProperties) => void
}

interface Found {
  lat: number
  lon: number
  message: string
  /** The point has been selected; the message goes once it no longer is. */
  selected: boolean
}

function describeExtent(bbox: BBox): string {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const from = formatCoordinates(minLat, minLon)
  const to = formatCoordinates(maxLat, maxLon)
  return `Stored points run from ${from} to ${to}.`
}

/**
 * Selects the stored grid cell nearest to typed coordinates: the keyboard route to a cell, since
 * the map itself is not keyboard friendly for picking.
 */
export function CoordinateSearch({ cells, bbox, selected, onSelect }: CoordinateSearchProps) {
  const ids = { heading: useId(), lat: useId(), lon: useId(), hint: useId(), error: useId() }
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<Found | null>(null)
  // The message reports the selection the search made: shown once that point is selected, and
  // dropped for good when another point is selected or the selection closes.
  const isSelected = found !== null && found.lat === selected?.lat && found.lon === selected.lon
  if (found && isSelected && !found.selected) setFound({ ...found, selected: true })
  if (found?.selected && !isSelected) setFound(null)
  const foundMessage = isSelected ? found.message : null

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cells) return
    setFound(null)

    const latValue = parseDegrees(lat, 'lat')
    const lonValue = parseDegrees(lon, 'lon')
    if (!Number.isFinite(latValue) || !Number.isFinite(lonValue)) {
      setError(
        'Enter both latitude and longitude as decimal degrees, for example 51.5 and -0.5 ' +
          '(or 0.5 W).',
      )
      return
    }
    if (Math.abs(latValue) > 90 || Math.abs(lonValue) > 180) {
      setError('Latitude must be between -90 and 90, and longitude between -180 and 180.')
      return
    }

    const cell = findNearestCell(cells, latValue, lonValue)
    if (!cell) {
      const extent = bbox ? ` ${describeExtent(bbox)}` : ''
      setError(
        `There is no stored grid point near ${formatCoordinates(latValue, lonValue)}.${extent}`,
      )
      return
    }
    setError(null)
    const { lat: cellLat, lon: cellLon } = cell.properties
    setFound({
      lat: cellLat,
      lon: cellLon,
      message: `Selected the nearest stored point, ${formatCoordinates(cellLat, cellLon)}.`,
      selected: false,
    })
    onSelect(cell.properties)
  }

  const describedBy = error ? `${ids.hint} ${ids.error}` : ids.hint
  const inputClass =
    'w-full rounded-md border border-ink-subtle bg-surface px-2 py-1.5 text-sm text-ink tabular-nums placeholder:text-ink-subtle aria-invalid:border-danger'

  return (
    <div className="flex flex-col gap-2">
      <h2 id={ids.heading} className="text-xs font-medium text-ink-muted">
        Find a point
      </h2>
      <form role="search" aria-labelledby={ids.heading} noValidate onSubmit={onSubmit}>
        <p id={ids.hint} className="mb-2 text-xs text-ink-subtle">
          Decimal degrees. South and west are negative, or add S or W.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={ids.lat} className="text-xs font-medium text-ink-muted">
              Latitude
            </label>
            <input
              id={ids.lat}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="51.5"
              value={lat}
              onChange={(event) => {
                setLat(event.target.value)
                setFound(null)
              }}
              aria-describedby={describedBy}
              aria-invalid={error !== null}
              className={inputClass}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={ids.lon} className="text-xs font-medium text-ink-muted">
              Longitude
            </label>
            <input
              id={ids.lon}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="-0.5"
              value={lon}
              onChange={(event) => {
                setLon(event.target.value)
                setFound(null)
              }}
              aria-describedby={describedBy}
              aria-invalid={error !== null}
              className={inputClass}
            />
          </div>
          <Button type="submit" disabled={!cells}>
            Find cell
          </Button>
        </div>
        {error && (
          <p id={ids.error} role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        {/* Always rendered: a live region must exist before its text changes to be announced. */}
        <p role="status" className="text-sm text-ink-muted [&:not(:empty)]:mt-2">
          {foundMessage}
        </p>
      </form>
    </div>
  )
}
