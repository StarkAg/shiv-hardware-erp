import { describe, expect, test } from 'vitest'
import { fixSpelling } from '../convex/lib/spelling'
import { properItem, properText } from '../convex/lib/text'
import { tidyCatalog } from '../convex/catalog'

describe('item spellings', () => {
  test.each([
    ['Abbro Tape', 'Abro Tape'],
    ['Asion Abbro Tape', 'Asian Abro Tape'],
    ['Sanmica Linear Off White', 'Sunmica Linear Off White'],
    ['Sanmaica 1mm', 'Sunmica 1mm'],
    ["2'' Ghuja", "2'' Gujja"],
    ['1.5" ghuza', '1.5" Gujja'],
    ['3"x2" wpe chowkat', '3"x2" wpe Chowkhat'],
    ["10''Talascopic Indian", "10''Telescopic Indian"],
    ['Mica 3419 SU Centyry', 'Mica 3419 SU Century'],
    ['4" Cutter blade Bosh', '4" Cutter blade Bosch'],
    ['Fevicol Headx', 'Fevicol HeatX'],
    ['35 X 10 Liping Teak', '35 X 10 Lipping Teak'],
    ["1'' Baffer", "1'' Buffer"],
    ['Door clozer jolly', 'Door Closer jolly'],
  ])('%s → %s', (input, expected) => {
    expect(fixSpelling(input)).toBe(expected)
  })

  test('only whole words change', () => {
    expect(fixSpelling('Sonrisa Trekker Face Tag')).toBe('Sonrisa Trekker Face Tag')
    expect(fixSpelling('Screws Discounted')).toBe('Screws Discounted')
  })

  test('item names get spelling and case together; party names only case', () => {
    expect(properItem('asion abbro tape')).toBe('Asian Abro Tape')
    // Sizes are written as the shop writes them, "X" with a space either side.
    expect(properItem('3"x2" wpc chowkat')).toBe('3" X 2" WPC Chowkhat')
    expect(properText('Maria Stores')).toBe('Maria Stores')
  })
})

describe('My Items that become one name are one entry', () => {
  test('duplicates merge, and the removed id points at the kept one', () => {
    const { customCatalog, remap } = tidyCatalog({
      hardwareCatalog: {},
      sets: [],
      customCatalog: [
        { id: 'a', name: 'Abro Tape', sizes: ['1"'], brands: [], unit: 'B/L', rate: 110 },
        { id: 'b', name: 'Abbro Tape', sizes: ['2"'], brands: ['Asian'], unit: 'bl', rates: [120] },
        { id: 'c', name: 'Fevicol Marine', sizes: [], brands: [] },
      ],
    })
    expect(customCatalog.map((e: any) => e.name)).toEqual(['Abro Tape', 'Fevicol Marine'])
    expect(customCatalog[0]).toMatchObject({ id: 'a', unit: 'B/L', rate: 110, sizes: ['1"', '2"'], brands: ['Asian'] })
    expect(remap).toEqual({ b: 'a' })
  })
})
