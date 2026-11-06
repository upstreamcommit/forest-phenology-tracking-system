import type { ReactNode } from 'react'

import { useCatalog } from '../../api/queries'
import type { Product } from '../../api/types'
import { Button } from '../../components/Button'
import { PageTitle } from '../../components/PageTitle'
import { StatusMessage } from '../../components/StatusMessage'
import { describeError } from '../../lib/errors'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-ink-muted">{children}</div>
    </section>
  )
}

function yearRange(years: number[]): string {
  return years.length ? `${years[0]}–${years[years.length - 1]}` : 'none'
}

function bboxText([minLon, minLat, maxLon, maxLat]: number[]): string {
  return `lon ${minLon} to ${maxLon}, lat ${minLat} to ${maxLat}`
}

function ProductSummary({ product }: { product: Product }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h3 className="font-medium text-ink">
        {product.label} <span className="font-mono text-xs text-ink-subtle">({product.id})</span>
      </h3>
      {product.description && <p className="mt-1 text-sm">{product.description}</p>}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-subtle">Stored metrics</dt>
        <dd>
          {product.stored
            ? `${yearRange(product.stored.years)}, ${bboxText(product.stored.bbox)}` +
              (product.stored.grid_step_deg ? `, every ${product.stored.grid_step_deg}°` : '')
            : 'none'}
        </dd>
        <dt className="text-ink-subtle">NDVI curves</dt>
        <dd>
          {product.computed
            ? `${yearRange(product.computed.years)}, ${bboxText(product.computed.bbox)}, ` +
              `${product.computed.pixel_size_deg}° pixels`
            : 'none'}
        </dd>
      </dl>
    </div>
  )
}

function DataAvailable() {
  const catalog = useCatalog()
  if (catalog.isPending) return <StatusMessage tone="loading" title="Loading the catalogue" />
  if (catalog.isError) {
    return (
      <StatusMessage
        tone="error"
        title="Could not load the catalogue"
        action={<Button onClick={() => void catalog.refetch()}>Try again</Button>}
      >
        {describeError(catalog.error)}
      </StatusMessage>
    )
  }
  if (catalog.data.products.length === 0) {
    return <StatusMessage tone="empty" title="The API reports no data yet." />
  }
  return (
    <div className="space-y-3">
      {catalog.data.products.map((product) => (
        <ProductSummary key={product.id} product={product} />
      ))}
    </div>
  )
}

export function AboutPage() {
  const catalog = useCatalog()
  const threshold = catalog.data?.default_threshold_frac ?? 0.5

  return (
    <article className="mx-auto w-full max-w-3xl overflow-y-auto px-4 py-8">
      <PageTitle>Data &amp; methods</PageTitle>
      <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
        Data &amp; methods
      </h1>
      <p className="mt-2 text-ink-muted">
        The Forest Phenology Explorer shows when the growing season starts and ends, and how long
        it lasts, on a grid over Great Britain. It is a demonstration of the Forest Phenology
        Tracking System (FPTS) API.
      </p>

      <Section title="The data is synthetic">
        <p>
          Every value here is <strong className="text-ink">generated</strong>, not measured. An
          invented seasonal model gives later, shorter seasons further north and on uplands, patchy
          woodland that greens earlier and senesces later, a slow trend towards earlier springs,
          and some years with early or late springs or summer droughts that hit the south-east
          hardest (for example 2018 and 2022). It looks plausible so the maps and charts have
          something to show, but it says nothing about real forests.
        </p>
      </Section>

      <Section title="What the measures mean">
        <dl className="space-y-2">
          <div>
            <dt className="font-medium text-ink">Start of season (SOS)</dt>
            <dd>The date vegetation greenness first rises above the season threshold.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">End of season (EOS)</dt>
            <dd>The last date greenness is still above that threshold.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Season length</dt>
            <dd>Days from start to end of season.</dd>
          </div>
        </dl>
      </Section>

      <Section title="How seasons are computed">
        <p>
          Greenness is measured as NDVI, the normalised difference vegetation index, from a stack
          of composites every 16 days. For each pixel and year the threshold is the yearly minimum
          plus a fraction of the seasonal amplitude: NDVI<sub>min</sub> + {threshold} × (NDVI
          <sub>max</sub> − NDVI<sub>min</sub>). The start of season is the first composite at or
          above it and the end of season the last, so computed dates land on composite days.
        </p>
        <p>
          The map shows <strong className="text-ink">stored</strong> metrics, precomputed for every
          grid point. Inside the outlined area the raw NDVI stack is also available, so a point
          there can show its NDVI curve alongside the stored values. The two come from the same
          model, and at the default threshold, which the stored metrics use, they agree to within
          about one composite. Other thresholds move the computed dates further.
        </p>
      </Section>

      <Section title="Data available now">
        <DataAvailable />
      </Section>

      <Section title="API and credits">
        <p>
          Everything on these pages comes from the FPTS API. Its interactive documentation is at{' '}
          <a href="/docs" className="font-medium text-accent underline">
            /docs
          </a>
          .
        </p>
        <p>
          Basemap: <a href="https://openfreemap.org" className="underline">OpenFreeMap</a>, ©{' '}
          <a href="https://www.openmaptiles.org/" className="underline">
            OpenMapTiles
          </a>
          , data from{' '}
          <a href="https://www.openstreetmap.org/copyright" className="underline">
            OpenStreetMap
          </a>
          . Map rendering by MapLibre GL JS.
        </p>
      </Section>
    </article>
  )
}
