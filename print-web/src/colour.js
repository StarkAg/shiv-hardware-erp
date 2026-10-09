/**
 * Whether a file needs the colour printer, judged from what is on it.
 *
 * Each picture (and the first pages of a PDF) is looked at small, and its
 * pixels counted: one is coloured when its channels are well apart — a real
 * red, blue or green, not the cream of paper, the grey of a shadow or the
 * yellow cast of a phone photo taken under shop light. A page with more than
 * a sliver of coloured pixels goes to the colour printer; a black-and-white
 * page, even photographed, goes to black and white.
 */

const SIDE = 96 // pixels across the small copy that is looked at
const CHROMA = 48 // 0–255: how far apart the channels must be to count as colour
const SHARE = 0.03 // the share of coloured pixels that makes a page a colour page
const PDF_PAGES = 3

/** The share of truly coloured pixels in a drawn canvas. */
function colourShare(canvas) {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height)
  // A cast over the whole picture (warm light, blue shade) is taken off first,
  // by measuring each channel against the picture's own average.
  let r = 0, g = 0, b = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2] }
  const mean = (r + g + b) / (3 * n)
  const cast = [r / n - mean, g / n - mean, b / n - mean]
  let coloured = 0
  for (let i = 0; i < data.length; i += 4) {
    const cr = data[i] - cast[0], cg = data[i + 1] - cast[1], cb = data[i + 2] - cast[2]
    if (Math.max(cr, cg, cb) - Math.min(cr, cg, cb) > CHROMA) coloured += 1
  }
  return coloured / n
}

function small(width, height) {
  const scale = SIDE / Math.max(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  return canvas
}

async function imageIsColour(file) {
  const bitmap = await createImageBitmap(file)
  const canvas = small(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return colourShare(canvas) > SHARE
}

let pdfjs = null
async function pdfIsColour(file) {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    for (let p = 1; p <= Math.min(PDF_PAGES, pdf.numPages); p += 1) {
      const page = await pdf.getPage(p)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: SIDE / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      if (colourShare(canvas) > SHARE) return true
    }
    return false
  } finally {
    void pdf.destroy()
  }
}

/** 'color' when any of the files has colour on it, else 'bw'. A file that cannot be read counts as colour for a photo, black and white for a paper. */
export async function detectMode(files) {
  const verdicts = await Promise.all(files.map(async (file) => {
    try {
      if (file.type === 'application/pdf') return await pdfIsColour(file)
      if (file.type.startsWith('image/')) return await imageIsColour(file)
    } catch {
      return file.type.startsWith('image/')
    }
    return false
  }))
  return verdicts.some(Boolean) ? 'color' : 'bw'
}
