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

describe('names the shop settled on', () => {
  test.each([
    ['19 X 6 SS Screw (+)', '19 X 6 Screw SS (+)'],
    ['30" SS Screw (+)', '3" Screw SS (+)'],
    ["3'' SS Screw (+)", '3" Screw SS (+)'],
    ["10''Telescopic Indian", '10" Telescopic Indian'],
    ["17 No 1'' HL Nail", '17 No 1" HL Nail'],
    ["1'' Pipe SS 12'", `1" Pipe SS 12'`],
    ["2''x1'' Patti", '2" X 1" Patti'],
    ['Mica HG', 'Sunmica HG'],
    ['Mica 3 Pcs', 'Sunmica'],
    ['240 HDG', 'Sunmica HT 240 HDG'],
    ['0.8 LW 8340', 'Sunmica 0.8mm LW 8340'],
    ['Sunmica LPOL 1402', 'Sunmica LP/OL 1402'],
    ['9" Bed Joint', '9" Bed Joint H'],
    ['Glass Runner', 'Glass Runner Prakash'],
    ["4'' Cutter Blade", '4" Cutter Blade Bosch'],
    ["4'' cutter blade bosch", '4" Cutter Blade Bosch'],
    ['Sunmica Linear Offwhite', 'Sunmica Linear Off White'],
    ['Mica 9441 - SHG', 'Sunmica 9441 SHG'],
    ['9441-shg', 'Sunmica 9441 SHG'],
    ['Mica 3419 SU Centyry', 'Sunmica Century 3419 SU'],
    ['HR Lam 8207-ST', 'Sunmica HR 8207 ST'],
    ['H.R. Lam 8221 SF', 'Sunmica HR 8221 SF'],
    ['4284 NGN', 'Sunmica HT 4284 NGN'],
    ['C GST 9%', 'CGST 9%'],
    ['1/1/2 Nail', '1 1/2" Nail'],
    ['20No 3/4" HL Nail', '20 No 3/4" HL Nail'],
    ['Alaldite 180 Gm', 'Araldite 180 Gm'],
    ['L Vaccum SS 3/4"', '3/4" L Vacuum SS'],
    ["6'' T/B Acer Jazz", '6" TB Acer Jazz'],
    ['6mm S 8 X 4 Pcs', '6mm S 8 X 4'],
    ['Fevicol Relam 430 G', 'Fevicol Relam 430 Gm'],
  ])('%s → %s', (input, expected) => {
    expect(properItem(input)).toBe(expected)
    // Settled: saving it again changes nothing.
    expect(properItem(expected)).toBe(expected)
  })

  test('the ones kept apart stay apart', () => {
    for (const name of ['3/4" Screw SS (+)', '19 X 6 Screw SS (+)', '12mm S 6 X 3', 'Magnet', 'Door Magnet', 'Sunmica 4284 NGN Extra', "1'' Oval Pipe".replace("''", '"')]) {
      expect(properItem(name)).toBe(properText(fixSpelling(name)))
    }
  })

  test('two spellings of one item become one entry, and bills follow', () => {
    const tidy = tidyCatalog({
      hardwareCatalog: {},
      customCatalog: [
        { id: 'a', name: '19 X 6 SS Screw (+)', rate: 0.88, unit: 'Pc', sizes: [], brands: [] },
        { id: 'b', name: '19 X 6 Screw SS (+)', rate: 0.88, unit: 'Pc', sizes: [], brands: [] },
        { id: 'c', name: '3/4" Screw SS (+)', rate: 0.88, unit: 'Pc', sizes: [], brands: [] },
      ],
      sets: [],
    })
    expect(tidy.customCatalog.map((e: any) => e.name)).toEqual(['19 X 6 Screw SS (+)', '3/4" Screw SS (+)'])
    expect(tidy.remap).toEqual({ b: 'a' })
  })
})
