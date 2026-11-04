/**
 * Whether a shared photo needs the colour printer. The same rule as
 * print-web/src/colour.js and print-server/colour-check.mjs: look at it small,
 * take off any cast over the whole picture, and count the truly coloured pixels.
 */
const SIDE = 400
const CHROMA = 48
const SHARE = 0.005

export function photoIsColour(img: HTMLImageElement) {
  const scale = SIDE / Math.max(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
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
  return coloured / n > SHARE
}
