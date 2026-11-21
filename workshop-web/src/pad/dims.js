// ── Sizes, the way the shop writes them ─────────────────────────────────────
// Inches and soot, where soot is eighths. Every measurement on the mechanic's
// sheet is in this form — 13⅞, 40⁶/₈, 41⅝ — so it is what the app stores,
// rather than a decimal that has to be turned back into a fraction to be read
// out loud at the workshop. Same shape the panel's own Dimension carries.

export const dim = (inches = 0, soot = 0) => ({ inches: Number(inches) || 0, soot: Number(soot) || 0 })
export const blankDim = () => ({ inches: 0, soot: 0 })

/** The size as a plain number of inches, for arithmetic only. */
export const inchesOf = (d) => (Number(d?.inches) || 0) + (Number(d?.soot) || 0) / 8

/**
 * Eighths, written out of eight and never reduced.
 *
 * The shop writes 6/8, not ¾, and 4/8 rather than ½ — because the tape is read
 * in eighths and reducing the fraction means converting it back at the saw.
 * The mechanic's sheet has 40 6/8 and 41 5/8 on it in exactly that form.
 */
export const SOOT_GLYPH = ['', '1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8']

/** The reduced forms, accepted on the way in but never written out. */
const VULGAR = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']

/** 13 and 7 soot → 13 7/8 */
export const fmtDim = (d) => {
  const i = Number(d?.inches) || 0
  const s = Number(d?.soot) || 0
  return s ? `${i} ${SOOT_GLYPH[s]}` : String(i)
}

export const fmtSize = (w, h) => `${fmtDim(w)}″ × ${fmtDim(h)}″`

/** Square feet of an opening. */
export const sqftOf = (w, h) => (inchesOf(w) * inchesOf(h)) / 144

/** The distance round an opening, in running feet — what sections are cut to. */
export const perimeterFt = (w, h) => (2 * (inchesOf(w) + inchesOf(h))) / 12

/** Accepts "13 7/8", "13.875", "13-7", "13⅞" — whatever gets typed or pasted. */
export function parseDim(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return blankDim()

  // The written form first, so "11 1/8" is not mistaken for a glyph match.
  const frac = raw.match(/^(\d+)[\s-]+(\d)\s*\/\s*8$/)
  if (frac) return dim(Number(frac[1]), Number(frac[2]))

  for (let s = 1; s < 8; s++) {
    if (raw.includes(VULGAR[s])) return dim(parseInt(raw, 10) || 0, s)
  }

  const dash = raw.match(/^(\d+)[\s-]+(\d)$/)
  if (dash) return dim(Number(dash[1]), Number(dash[2]) % 8)

  const num = Number(raw)
  if (Number.isFinite(num)) {
    const whole = Math.floor(num)
    // Nearest eighth, because that is the finest the shop cuts to anyway.
    return dim(whole, Math.round((num - whole) * 8) % 8)
  }
  return blankDim()
}

export const dimIsSet = (d) => inchesOf(d) > 0
