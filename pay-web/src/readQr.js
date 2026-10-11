// Reads the QR codes in a photo, on the phone: nothing is uploaded.
import jsQR from 'jsqr'

async function open(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }) } catch { /* try the plain way */ }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

// The whole photo at a few sizes, then closer looks: on a shop's poster or in
// a chat screenshot the QR is a small part of the picture, and the reader
// misses a code that is too small or too large for it.
function* looks(w, h) {
  for (const side of [1000, 600, 1600]) yield { x: 0, y: 0, w, h, side }
  for (const [fx, fy] of [[0.2, 0.2], [0, 0], [0.4, 0], [0, 0.4], [0.4, 0.4]]) {
    yield { x: w * fx, y: h * fy, w: w * 0.6, h: h * 0.6, side: 1000 }
  }
}

/** A reader for a running camera: give it the <video>, get the text of the QRs in view (none: an empty list). */
export function frameReader() {
  let detector = null
  try {
    if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] })
  } catch { /* not on this phone */ }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return async (video) => {
    if (video.readyState < 2 || !video.videoWidth) return []
    if (detector) {
      try {
        const found = await detector.detect(video)
        if (found.length) return found.map((code) => code.rawValue).filter(Boolean)
      } catch { detector = null }
    }
    const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    // A printed QR is dark on light; looking for the other kind too halves the speed.
    const code = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' })
    return code?.data ? [code.data] : []
  }
}

/** The text of every QR found in the photo (none: an empty list). Throws when the photo cannot be opened. */
export async function readQr(blob) {
  const picture = await open(blob)
  const w = picture.width, h = picture.height

  // The phone's own reader first: it is the better one where there is one.
  if ('BarcodeDetector' in window) {
    try {
      const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(picture)
      if (found.length) return found.map((code) => code.rawValue).filter(Boolean)
    } catch { /* not on this phone after all */ }
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  for (const look of looks(w, h)) {
    const scale = Math.min(look.side / Math.max(look.w, look.h), 2)
    canvas.width = Math.max(1, Math.round(look.w * scale))
    canvas.height = Math.max(1, Math.round(look.h * scale))
    // White underneath: a see-through PNG would otherwise read as black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(picture, look.x, look.y, look.w, look.h, 0, 0, canvas.width, canvas.height)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(pixels.data, pixels.width, pixels.height)
    if (code?.data) return [code.data]
  }
  return []
}
