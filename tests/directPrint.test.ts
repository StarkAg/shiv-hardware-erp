import { mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM module without types
import { parseIppPrinters, parseSettings, printDirect } from '../print-server/direct-print.mjs'
// @ts-expect-error plain ESM module without types
import { parseResponse } from '../print-server/ipp.mjs'

/** An IPP reply: status, then groups of [tag, name, values]. */
function reply(status: number, requestId: number, groups: [number, [number, string, (string | number)[]][]][]) {
  const out: number[] = [2, 0, status >> 8, status & 0xff, ...[24, 16, 8, 0].map((s) => (requestId >>> s) & 0xff)]
  for (const [groupTag, attrs] of groups) {
    out.push(groupTag)
    for (const [tag, name, values] of attrs) {
      values.forEach((v, i) => {
        const n = i === 0 ? Buffer.from(name) : Buffer.alloc(0)
        let b: Buffer
        if (typeof v === 'number') { b = Buffer.alloc(4); b.writeInt32BE(v) } else b = Buffer.from(v)
        out.push(tag, n.length >> 8, n.length & 0xff, ...n, b.length >> 8, b.length & 0xff, ...b)
      })
    }
  }
  out.push(0x03)
  return Buffer.from(out)
}

/** The HP as it answered on 25 Nov 2026, cut to what printing reads. */
const HP = [
  [0x41, 'printer-make-and-model', ['HP LaserJet Tank MFP 260x']],
  [0x49, 'document-format-supported', ['application/PCLm', 'image/pwg-raster', 'image/urf']],
  [0x44, 'pwg-raster-document-type-supported', ['sgray_8']],
  [0x32, 'pwg-raster-document-resolution-supported', []],
  [0x44, 'print-color-mode-supported', ['auto', 'auto-monochrome', 'monochrome']],
  [0x44, 'media-supported', ['iso_a4_210x297mm', 'na_letter_8.5x11in']],
] as [number, string, (string | number)[]][]

describe('direct IPP printing', () => {
  let server: http.Server
  let url: string
  const jobs: { attrs: Record<string, unknown>; data: Buffer; chunked: boolean }[] = []
  let offerPclm = true

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const op = body.readUInt16BE(2)
        const id = body.readUInt32BE(4)
        res.writeHead(200, { 'Content-Type': 'application/ipp' })
        if (op === 0x0b) {
          const offered = HP.filter(([, n]) => !n.includes('resolution'))
            .map(([t, n, v]) => [t, n, n === 'document-format-supported' && !offerPclm ? v.filter((f) => f !== 'application/PCLm') : v] as [number, string, (string | number)[]])
          // resolution values are 9 bytes; the helper writes strings, so add them by hand below
          const base = reply(0, id, [[0x04, offered]])
          const res9 = (x: number) => { const b = Buffer.alloc(9); b.writeInt32BE(x); b.writeInt32BE(x, 4); b[8] = 3; return b }
          const name = Buffer.from('pwg-raster-document-resolution-supported')
          const extra = Buffer.concat([
            Buffer.from([0x32, 0, name.length]), name, Buffer.from([0, 9]), res9(300),
            Buffer.from([0x32, 0, 0, 0, 9]), res9(600),
          ])
          res.end(Buffer.concat([base.subarray(0, base.length - 1), extra, Buffer.from([0x03])]))
          return
        }
        // Print-Job: the request's attributes, then the document after the end tag.
        const parsed = parseResponse(body)
        const end = body.indexOf(0x03, body.indexOf(Buffer.from('document-format')))
        const ops = parsed.groups.find((g: { tag: number }) => g.tag === 1)?.attrs ?? {}
        const jobAttrs = parsed.groups.find((g: { tag: number }) => g.tag === 2)?.attrs ?? {}
        const pwgAt = body.indexOf(Buffer.from('RaS2'))
        const data = body.subarray(pwgAt >= 0 ? pwgAt : body.indexOf(Buffer.from('%PDF-1.7')))
        jobs.push({ attrs: { ...ops, ...jobAttrs }, data, chunked: req.headers['transfer-encoding'] === 'chunked' })
        expect(end).toBeGreaterThan(0)
        res.end(reply(0, id, [[0x02, [[0x21, 'job-id', [41]], [0x23, 'job-state', [3]]]]]))
      })
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ipp/print`
  })
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())))

  it('reads the printer list from .env', () => {
    const map = parseIppPrinters('NPI33F31D (HP LaserJet Tank MFP 2606sdw)=http://192.168.29.184:631/ipp/print; bad ;x=ftp://no')
    expect([...map]).toEqual([['NPI33F31D (HP LaserJet Tank MFP 2606sdw)', 'http://192.168.29.184:631/ipp/print']])
  })

  it('reads the SumatraPDF-style settings', () => {
    expect(parseSettings(['fit', 'monochrome', 'portrait', 'paper=A4', 'bin=Rear Paper Feeder', 'print-quality=5']))
      .toEqual({ scale: 'fit', mono: true, orientation: 'portrait', paper: 'iso_a4_210x297mm', quality: 5 })
  })

  const photoFile = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'direct-print-'))
    const photo = join(dir, 'photo.jpg')
    const { readFileSync } = await import('node:fs')
    writeFileSync(photo, readFileSync(new URL('../assets/products/wpc-door-frame.jpg', import.meta.url)))
    return photo
  }

  it('sends a photo to the HP as PCLm at 600 dpi, chunked, A4, with the copies asked for', async () => {
    offerPclm = true
    const result = await printDirect(url, await photoFile(), { copies: 2, title: 'WhatsApp photo.jpg', settings: ['fit', 'color', 'portrait', 'paper=A4'] })
    expect(result).toMatchObject({ jobId: 41, pages: 1, dpi: 600 })
    const job = jobs.at(-1)!
    // Sent with a length, the HP waits 30 s and drops the job; chunked, it prints.
    expect(job.chunked).toBe(true)
    expect(job.attrs).toMatchObject({
      'document-format': 'application/PCLm', 'job-name': 'WhatsApp photo.jpg', copies: 2,
      media: 'iso_a4_210x297mm', 'print-color-mode': 'monochrome',
    })
    const text = job.data.toString('latin1')
    expect(text.startsWith('%PDF-1.7\n%PCLm 1.0\n')).toBe(true)
    expect(text).toContain('/MediaBox [ 0 0 595 841 ]')
    expect(text).toContain('/Width 4960')
    expect(text).toContain('/ColorSpace /DeviceGray')
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('sends PWG raster to a printer without PCLm', async () => {
    offerPclm = false
    // its own address, so the remembered answer of the PCLm printer is not used
    const result = await printDirect(`${url}?pwg-only`, await photoFile(), { copies: 2, title: 'WhatsApp photo.jpg', settings: ['fit', 'color', 'portrait', 'paper=A4'] })
    offerPclm = true
    expect(result).toMatchObject({ jobId: 41, pages: 1, dpi: 300 })
    const job = jobs.at(-1)!
    expect(job.attrs).toMatchObject({ 'document-format': 'image/pwg-raster', copies: 2 })
    // The printer only takes grey, so a colour ask still goes as sgray at 2480 x 3507.
    expect(job.data.readUInt32BE(4 + 400)).toBe(18)
    expect(job.data.readUInt32BE(4 + 372)).toBe(2480)
    expect(job.data.readUInt32BE(4 + 376)).toBe(3507)
  })

  it('refuses a file type it cannot draw, so the Windows way takes it', async () => {
    await expect(printDirect(url, 'C:/x/file.docx', {})).rejects.toThrow(/cannot print/)
  })

  it('fails fast when the printer is not there', async () => {
    const t = Date.now()
    await expect(printDirect('http://127.0.0.1:9/ipp/print', 'C:/x/a.pdf', {})).rejects.toThrow()
    expect(Date.now() - t).toBeLessThan(5000)
  })
})
