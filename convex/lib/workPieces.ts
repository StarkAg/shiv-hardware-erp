/**
 * The pieces of a work order — what the mechanic measures.
 *
 * Made to measure, every piece can be its own size: a line of 9 pieces is 9
 * things to measure ("1 of 9" … "9 of 9"), each with its own width and height.
 * The visit slip, the mechanic's phone and the Work list all count them here,
 * so a size written on one is found by the others.
 */

/** A fare, a round-off, a "Bill" total: charges on the bill, nothing to measure. */
const CHARGE = /^(?:bill|fare|cartage|freight|labour|labor|transport|discount|less|(?:[csi]\s*\.?\s*)?gst\b.*)$/i

export type WorkPiece = {
  /** The line's id and which of its pieces: stays the same when lines are reordered. */
  key: string
  what: string
  /** "3 of 9" when the line is several pieces, else ''. */
  of: string
  /** How many this row stands for: 1, or the line's whole quantity when it is not split. */
  qty: number
}

/** What the mechanic wrote for one piece. Sizes are kept as he typed them. */
export type PieceSize = { key: string; what: string; w: string; h: string; note?: string }

/** The sizes brought back from the site, and who brought them. */
export type SiteSizes = {
  /** When they were last written (ms). The newer copy of these wins, whatever else changed on the bill. */
  at: number
  by: string
  unit: 'in' | 'mm' | 'ft'
  pieces: PieceSize[]
  notes?: string
}

export const UNIT_WORD: Record<SiteSizes['unit'], string> = { in: 'inch', mm: 'mm', ft: 'ft' }

export function workPieces(items: any[] = []): WorkPiece[] {
  const out: WorkPiece[] = []
  items.forEach((i, at) => {
    const what = String(i?.description ?? '').trim()
    if (!what || i?.isRoundup || i?.isDiscount || i?.amountOnly || CHARGE.test(what)) return
    const id = String(i?.id ?? `line${at}`)
    const qty = Number(i?.qty) || 1
    if (Number.isInteger(qty) && qty > 1 && qty <= 30) {
      for (let n = 1; n <= qty; n++) out.push({ key: `${id}#${n}`, what, of: `${n} of ${qty}`, qty: 1 })
    } else {
      out.push({ key: `${id}#1`, what, of: '', qty: Number(i?.qty) || 1 })
    }
  })
  return out
}

/** "24 x 36", "24 wide", '' — one piece's size as a line of text. */
export function sizeText(p: Pick<PieceSize, 'w' | 'h'> | undefined): string {
  const w = (p?.w ?? '').trim()
  const h = (p?.h ?? '').trim()
  if (w && h) return `${w} x ${h}`
  if (w) return `${w} wide`
  if (h) return `${h} high`
  return ''
}
