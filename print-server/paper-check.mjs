/**
 * Is this photo a sheet of paper? No AI: it looks at the colours only.
 *
 * A supplier's paper bill photographed on a phone is mostly pale, colourless
 * paper (white, cream, or grey-blue in shadow) with a little ink; a photo of a
 * vehicle, goods or a person is mostly coloured or dark. So the photo is
 * shrunk to about 160 px wide and every pixel counted:
 *
 *   paper      light (luma >= PAPER_MIN_LUMA) and nearly grey (chroma <= PAPER_MAX_CHROMA)
 *   colourful  strongly coloured (chroma >= COLOUR_MIN_CHROMA)
 *
 * It is paper when paper pixels are at least PAPER_MIN_SHARE of the photo,
 * colourful ones at most COLOUR_MAX_SHARE, and pure white ones at most
 * PURE_WHITE_MAX_SHARE. Tuned on 26 Nov 2026 on the two Simran Ply slips (one
 * cream, one grey-blue in shadow: paper 0.88, colour 0, pure white 0) against
 * product photos, card designs, the visiting card and screenshots. A white
 * printed sheet photographed also counts, as a paper. Owner's ask, 26 Nov
 * 2026: print only the paper slips from the supplier chat, "no ai".
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'

export const PAPER_RULES = {
  PAPER_MIN_LUMA: 150,
  PAPER_MAX_CHROMA: 50,
  COLOUR_MIN_CHROMA: 70,
  PAPER_MIN_SHARE: 0.7,
  COLOUR_MAX_SHARE: 0.1,
  // A phone photo of paper is never pure white; a made image (visiting card,
  // product picture on white, screenshot of a white page) mostly is.
  PURE_WHITE_MAX_SHARE: 0.4,
}

/** The colour counts of an image (a Buffer), as shares of its pixels. */
export async function paperStats(buffer, width = 160) {
  const img = await loadImage(buffer)
  const w = Math.max(1, Math.min(width, img.width))
  const h = Math.max(1, Math.round((img.height / img.width) * w))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  let paper = 0
  let colour = 0
  let pure = 0
  const n = w * h
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (luma >= PAPER_RULES.PAPER_MIN_LUMA && chroma <= PAPER_RULES.PAPER_MAX_CHROMA) paper += 1
    if (chroma >= PAPER_RULES.COLOUR_MIN_CHROMA) colour += 1
    if (r >= 250 && g >= 250 && b >= 250) pure += 1
  }
  return { paper: paper / n, colour: colour / n, pure: pure / n }
}

/** { paper: true|false, stats } for an image Buffer. */
export async function looksLikePaper(buffer) {
  const stats = await paperStats(buffer)
  const paper = stats.paper >= PAPER_RULES.PAPER_MIN_SHARE
    && stats.colour <= PAPER_RULES.COLOUR_MAX_SHARE
    && stats.pure <= PAPER_RULES.PURE_WHITE_MAX_SHARE
  return { paper, stats }
}
