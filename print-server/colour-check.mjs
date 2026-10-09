/**
 * Colour or black and white, decided on the shop PC from what is on a file.
 *
 * A print shared silently from a phone (Shiv Print, mode "auto") arrives
 * without a choice, so the print server looks at it here, in its own warm
 * Chrome page: photos as they are, PDFs page by page (the first three, drawn
 * with pdf.js). A page counts as colour only when a real share of it carries
 * colour — the cream of paper, the grey of a shadow or the yellow cast of shop
 * light is taken off first. The same rule as print-web/src/colour.js.
 */
import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as pdfjs from '/_colour/pdfjs/pdf.min.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = '/_colour/pdfjs/pdf.worker.min.mjs'
const SIDE = 400, CHROMA = 48, SHARE = 0.005, PDF_PAGES = 3 // same as print-web/src/colour.js
function colourShare(canvas) {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height)
  let r = 0, g = 0, b = 0; const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2] }
  const mean = (r + g + b) / (3 * n), cast = [r / n - mean, g / n - mean, b / n - mean]
  let coloured = 0
  for (let i = 0; i < data.length; i += 4) {
    const cr = data[i] - cast[0], cg = data[i + 1] - cast[1], cb = data[i + 2] - cast[2]
    if (Math.max(cr, cg, cb) - Math.min(cr, cg, cb) > CHROMA) coloured += 1
  }
  return coloured / n
}
function canvasFor(w, h) {
  const s = SIDE / Math.max(w, h), c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s))
  const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height)
  return [c, x]
}
const bytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
async function isColour({ type, data }) {
  if (type === 'application/pdf') {
    const pdf = await pdfjs.getDocument({ data: bytes(data) }).promise
    try {
      for (let p = 1; p <= Math.min(PDF_PAGES, pdf.numPages); p += 1) {
        const page = await pdf.getPage(p), base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: SIDE / Math.max(base.width, base.height) })
        const [c, x] = canvasFor(viewport.width, viewport.height)
        await page.render({ canvasContext: x, viewport }).promise
        if (colourShare(c) > SHARE) return true
      }
      return false
    } finally { void pdf.destroy() }
  }
  const bitmap = await createImageBitmap(new Blob([bytes(data)], { type }))
  const [c, x] = canvasFor(bitmap.width, bitmap.height)
  x.drawImage(bitmap, 0, 0, c.width, c.height)
  return colourShare(c) > SHARE
}
window.detectColour = async (files) => {
  for (const f of files) {
    try { if (await isColour(f)) return 'color' } catch { if (f.type.startsWith('image/')) return 'color' }
  }
  return 'bw'
}
window.colourReady = true
</script></body></html>`

/** Serves the check page and pdf.js to the print server's own browser. */
export function registerColourCheck(app) {
  app.use('/_colour/pdfjs', express.static(join(here, 'node_modules', 'pdfjs-dist', 'build')))
  app.get('/_colour/check.html', (_req, res) => res.type('html').send(PAGE))
}

/**
 * 'color' when any of the files carries colour, else 'bw'. `files` are
 * decoded uploads ({ mediaType, data: base64 }); `openPage` hands out a page
 * on the print server's warm browser; `port` is the print server's own.
 */
export async function detectColourMode(files, openPage, port) {
  let page
  try {
    page = await openPage()
    await page.goto(`http://127.0.0.1:${port}/_colour/check.html`, { waitUntil: 'load', timeout: 10000 })
    await page.waitForFunction('window.colourReady === true', { timeout: 10000 })
    return await page.evaluate((list) => window.detectColour(list), files.map((f) => ({ type: f.mediaType, data: f.data })))
  } finally {
    await page?.close().catch(() => {})
  }
}
