/**
 * Printing a PDF or a photo straight to a network printer over IPP: the page
 * pictures are drawn here (raster.mjs) and sent as PWG raster, so no Windows
 * driver and no print program sits in between. On the shop HP a 2-page PDF
 * went out in about 0.3 s this way, against about 8 s through Windows' own
 * IPP driver (measured 25 Nov 2026).
 *
 * Which printers: PRINTER_IPP_URLS in .env, "Windows printer name=IPP address"
 * pairs split by ";", e.g.
 *   PRINTER_IPP_URLS=NPI33F31D (HP LaserJet Tank MFP 2606sdw)=http://192.168.29.184:631/ipp/print
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { formatsOf, getPrinterAttributes, printJob } from './ipp.mjs'
import { encodePclm, encodePwg, renderPages } from './raster.mjs'

const listOf = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

/** "name=url;name=url" as a Map. A printer name has no "=", so the first one splits. */
export function parseIppPrinters(value) {
  const map = new Map()
  for (const entry of String(value ?? '').split(';')) {
    const at = entry.indexOf('=')
    if (at < 1) continue
    const name = entry.slice(0, at).trim()
    const url = entry.slice(at + 1).trim()
    if (name && /^(https?|ipps?):\/\//i.test(url)) map.set(name, url)
  }
  return map
}

/** The same settings list SumatraPDF took (fit, monochrome, portrait, paper=A4…). */
export function parseSettings(settings = []) {
  const out = { scale: 'fit', mono: false, orientation: null, paper: 'iso_a4_210x297mm', quality: null }
  for (const raw of settings) {
    const s = String(raw).trim().toLowerCase()
    if (s === 'fit' || s === 'shrink' || s === 'noscale') out.scale = s
    else if (s === 'monochrome') out.mono = true
    else if (s === 'color') out.mono = false
    else if (s === 'portrait' || s === 'landscape') out.orientation = s
    else if (s.startsWith('paper=')) {
      const p = s.slice(6)
      out.paper = p === 'a5' ? 'iso_a5_148x210mm' : p === 'letter' ? 'na_letter_8_5x11in' : 'iso_a4_210x297mm'
    } else if (s.startsWith('print-quality=')) out.quality = Number(s.slice(14)) || null
  }
  return out
}

const MEDIA_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }
export const directPrintable = (filePath) => extname(filePath).toLowerCase() in MEDIA_TYPES

// What each printer is and takes, asked once and kept for ten minutes.
const info = new Map()
export async function printerInfo(url, { fresh = false } = {}) {
  const cached = info.get(url)
  if (!fresh && cached && Date.now() - cached.at < 10 * 60_000) return cached.attrs
  const attrs = await getPrinterAttributes(url, { timeoutMs: 4000 })
  info.set(url, { at: Date.now(), attrs })
  return attrs
}

/** The resolution to draw at: as asked if the printer takes it, else the nearest it does. */
function pickDpi(attrs, want) {
  const offered = listOf(attrs['pwg-raster-document-resolution-supported'])
    .map((r) => Number(String(r).split('x')[0]))
    .filter(Boolean)
  if (!offered.length || offered.includes(want)) return want
  return offered.reduce((best, d) => (Math.abs(d - want) < Math.abs(best - want) ? d : best))
}

/**
 * Prints one file on the printer at `url`. PDFs are drawn at `pdfDpi` (text
 * wants it sharp), photos at `photoDpi` (they gain nothing past 300 and are
 * three times the size to send at 600).
 */
export async function printDirect(url, filePath, { copies = 1, title = 'Shiv Print', settings = [], pdfDpi = 600, photoDpi = 300 } = {}) {
  const started = Date.now()
  const mediaType = MEDIA_TYPES[extname(filePath).toLowerCase()]
  if (!mediaType) throw new Error(`cannot print ${extname(filePath) || 'this file'} directly`)
  const attrs = await printerInfo(url)
  const formats = formatsOf(attrs)
  // PCLm first: it is what the HP's own driver sends, and what it printed (job 27).
  const pclm = formats.includes('application/PCLm')
  if (!pclm && !formats.includes('image/pwg-raster')) throw new Error('the printer takes neither PCLm nor PWG raster')

  const opts = parseSettings(settings)
  let color
  let dpi
  if (pclm) {
    color = !opts.mono && listOf(attrs['print-color-mode-supported']).includes('color')
    // PCLm comes at the printer's one source resolution (600 on the HP).
    dpi = Number(String(listOf(attrs['pclm-source-resolution-supported'])[0] ?? '600').split('x')[0]) || 600
  } else {
    const types = listOf(attrs['pwg-raster-document-type-supported'])
    color = !opts.mono && types.includes('srgb_8')
    if (!color && !types.includes('sgray_8')) throw new Error(`the printer takes ${types.join(', ') || 'no'} raster types, not sgray_8`)
    dpi = pickDpi(attrs, mediaType === 'application/pdf' ? pdfDpi : photoDpi)
  }
  const buffer = await readFile(filePath)
  const pages = await renderPages({ buffer, mediaType }, { dpi, paper: opts.paper, color, scale: opts.scale, orientation: opts.orientation })
  const drawn = Date.now()
  const data = pclm
    ? encodePclm(pages, { dpi, paper: opts.paper, color, stripHeight: Number(attrs['pclm-strip-height-preferred']) || 64 })
    : encodePwg(pages, { dpi, paper: opts.paper, color })
  const result = await printJob(url, data, {
    format: pclm ? 'application/PCLm' : 'image/pwg-raster',
    copies,
    jobName: title,
    color,
    media: opts.paper,
    fit: false, // already drawn to the paper
    quality: opts.quality === 5 ? 5 : null,
    attrs,
  })
  return {
    ...result,
    pages: pages.length,
    dpi,
    bytes: data.length,
    ms: { draw: drawn - started, total: Date.now() - started },
  }
}
