import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM module without types
import { encodePwg, renderPages } from '../print-server/raster.mjs'
// @ts-expect-error plain ESM module without types
import { parseResponse } from '../print-server/ipp.mjs'

/** Reads PWG raster back: the printer's side of encodePwg. */
function decodePwg(buf: Buffer) {
  expect(buf.toString('latin1', 0, 4)).toBe('RaS2')
  const pages = []
  let i = 4
  while (i < buf.length) {
    const h = buf.subarray(i, i + 1796)
    i += 1796
    const width = h.readUInt32BE(372)
    const height = h.readUInt32BE(376)
    const bpp = h.readUInt32BE(388) / 8
    const stride = h.readUInt32BE(392)
    expect(stride).toBe(width * bpp)
    const data = Buffer.alloc(stride * height)
    let y = 0
    while (y < height) {
      const repeat = buf[i++] + 1
      const line = Buffer.alloc(stride)
      let x = 0
      while (x < width) {
        const n = buf[i++]
        if (n <= 127) {
          const px = buf.subarray(i, i + bpp); i += bpp
          for (let k = 0; k <= n; k += 1) px.copy(line, (x + k) * bpp)
          x += n + 1
        } else {
          const count = 257 - n
          buf.copy(line, x * bpp, i, i + count * bpp); i += count * bpp
          x += count
        }
      }
      expect(x).toBe(width)
      for (let r = 0; r < repeat; r += 1) line.copy(data, (y + r) * stride)
      y += repeat
    }
    pages.push({ width, height, bpp, dpi: h.readUInt32BE(276), colorSpace: h.readUInt32BE(400), total: h.readUInt32BE(452), data, sizeName: h.toString('utf8', 1732, 1796).replace(/\0+$/, '') })
  }
  return pages
}

describe('PWG raster', () => {
  it('packs and unpacks every kind of line exactly', () => {
    const width = 300
    const height = 700
    const data = Buffer.alloc(width * height, 0xff)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = y * width + x
        if (y % 97 === 0) data[o] = (x * 7 + y) & 0xff // all different
        else if (y % 5 === 0) data[o] = x < 150 ? 0 : 0x80 // two runs
        else if (y > 300 && y < 600) data[o] = 0x10 // 299 repeated lines
        else if (y % 3 === 0) data[o] = (x % 3 === 0 ? 0 : x) & 0xff // mixed runs and stretches
      }
    }
    const pages = decodePwg(encodePwg([{ width, height, data }], { dpi: 300 }))
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ width, height, bpp: 1, dpi: 300, colorSpace: 18, total: 1, sizeName: 'iso_a4_210x297mm' })
    expect(pages[0].data.equals(data)).toBe(true)
  })

  it('carries colour as 3 bytes a pixel in sRGB', () => {
    const width = 130
    const height = 4
    const data = Buffer.alloc(width * height * 3)
    for (let o = 0; o < data.length; o += 1) data[o] = (o * 13) & 0xff
    const [page] = decodePwg(encodePwg([{ width, height, data }], { dpi: 600, color: true }))
    expect(page).toMatchObject({ bpp: 3, colorSpace: 19, dpi: 600 })
    expect(page.data.equals(data)).toBe(true)
  })

  it('draws a photo onto upright A4 at the asked resolution, and round-trips it', async () => {
    const buffer = readFileSync(new URL('../assets/products/wpc-door-frame.jpg', import.meta.url))
    const pages = await renderPages({ buffer, mediaType: 'image/jpeg' }, { dpi: 150 })
    expect(pages).toHaveLength(1)
    expect([pages[0].width, pages[0].height]).toEqual([1240, 1753])
    const [back] = decodePwg(encodePwg(pages, { dpi: 150 }))
    expect(back.data.equals(pages[0].data)).toBe(true)
    // White margins at the corners, the photo in the middle.
    expect(back.data[0]).toBe(255)
    expect(back.data[(877 * 1240) + 620]).toBeLessThan(250)
  })
})

describe('IPP replies', () => {
  it('reads status, groups and multi-valued attributes', () => {
    const parts: number[] = [2, 0, 0, 0, 0, 0, 0, 7, 0x04]
    const add = (tag: number, name: string, value: Buffer) => {
      parts.push(tag, 0, name.length, ...Buffer.from(name), value.length >> 8, value.length & 0xff, ...value)
    }
    add(0x49, 'document-format-supported', Buffer.from('image/pwg-raster'))
    add(0x49, '', Buffer.from('image/urf'))
    const state = Buffer.alloc(4); state.writeInt32BE(3)
    add(0x23, 'printer-state', state)
    parts.push(0x03)
    const res = parseResponse(Buffer.from(parts))
    expect(res.status).toBe(0)
    expect(res.requestId).toBe(7)
    expect(res.groups[0].attrs).toEqual({ 'document-format-supported': ['image/pwg-raster', 'image/urf'], 'printer-state': 3 })
  })
})
