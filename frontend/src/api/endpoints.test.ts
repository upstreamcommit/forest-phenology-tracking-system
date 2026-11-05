import { describe, expect, it } from 'vitest'

import { catalog } from '../test/fixtures'
import { isCatalog } from './endpoints'

const [product] = catalog.products
const { stored, computed } = product

function withProduct(changes: Record<string, unknown>) {
  return { ...catalog, products: [{ ...product, ...changes }] }
}

describe('isCatalog', () => {
  it('accepts the catalogue, with or without coverage', () => {
    expect(isCatalog(catalog)).toBe(true)
    expect(isCatalog({ ...catalog, products: [] })).toBe(true)
    expect(isCatalog(withProduct({ stored: null }))).toBe(true)
    expect(isCatalog(withProduct({ computed: undefined }))).toBe(true)
  })

  it.each([
    ['no body', null],
    ['a list for a body', [catalog]],
    ['no product list', { ...catalog, products: undefined }],
    ['a product list that is not a list', { ...catalog, products: { synthetic: true } }],
    ['a product that is null', { ...catalog, products: [null] }],
    ['a product without an id', withProduct({ id: undefined })],
    ['a product with a numeric id', withProduct({ id: 7 })],
    ['stored coverage without years', withProduct({ stored: {} })],
    ['stored years that are not numbers', withProduct({ stored: { ...stored, years: ['2016'] } })],
    ['a computed bbox of three numbers', withProduct({ computed: { ...computed, bbox: [0, 1, 2] } })],
  ])('rejects a catalogue with %s', (_, body) => {
    expect(isCatalog(body)).toBe(false)
  })
})
