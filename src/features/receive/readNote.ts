import { foldName, properItem } from '../../../convex/lib/text'

/**
 * A delivery written the way it would be said — "15 Sunmica, 10 hinges" —
 * read into lines, matched to the items the shop already knows.
 */

export type Line = { key: string; name: string; qty: number; unit: string }
export type Known = { name: string; unit: string; lastQty?: number }

const UNITS: Record<string, string> = {
  pc: 'Pc', pcs: 'Pc', piece: 'Pc', pieces: 'Pc', nos: 'Pc', no: 'Pc',
  sheet: 'Sheet', sheets: 'Sheet', sht: 'Sheet',
  box: 'Box', boxes: 'Box', bundle: 'Bundle', bundles: 'Bundle', set: 'Set', sets: 'Set',
  kg: 'Kg', kgs: 'Kg', ltr: 'Ltr', litre: 'Ltr', l: 'Ltr', mtr: 'M', m: 'M', meter: 'M',
  ft: 'Ft', feet: 'Ft', rft: 'Rft', bag: 'Bag', bags: 'Bag', roll: 'Roll', rolls: 'Roll', pkt: 'Pkt', packet: 'Pkt',
}
// Words that only say the goods arrived.
const FILLER = /\b(came|come|aaya|aya|aye|aaye|received|recieved|arrived|delivered|mila|mile|only)\b/gi

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** The item a typed name most likely means, from the ones the shop knows. */
function bestKnown(typed: string, known: Known[]): Known | undefined {
  const want = foldName(typed)
  if (!want) return undefined
  return (
    known.find((k) => foldName(k.name) === want) ??
    known.find((k) => foldName(k.name).startsWith(want)) ??
    known.find((k) => foldName(k.name).includes(want))
  )
}

/** "15 Sunmica, 10 hinges and 2 box screw" → lines. */
export function readNote(note: string, known: Known[]): Line[] {
  const out: Line[] = []
  for (const raw of note.split(/[,\n;]+|\band\b|\baur\b/i)) {
    const part = raw.replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
    if (!part) continue
    let qty = 1
    let rest = part
    const lead = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(part)
    const tail = /^(.*?)\s*[x×-]?\s*(\d+(?:\.\d+)?)$/.exec(part)
    if (lead && lead[2]) { qty = Number(lead[1]); rest = lead[2] }
    else if (tail && tail[1]) { qty = Number(tail[2]); rest = tail[1] }
    let unit = ''
    const words = rest.split(' ')
    const first = UNITS[words[0]?.toLowerCase() ?? '']
    const last = UNITS[words[words.length - 1]?.toLowerCase() ?? '']
    if (first && words.length > 1) { unit = first; words.shift() }
    else if (last && words.length > 1) { unit = last; words.pop() }
    const typed = words.join(' ').trim()
    if (!typed) continue
    const match = bestKnown(typed, known)
    out.push({
      key: newId(),
      name: match?.name ?? properItem(typed),
      qty: qty > 0 ? qty : 1,
      unit: unit || match?.unit || 'Pc',
    })
  }
  return out
}

