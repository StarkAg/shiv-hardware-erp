// A page of the paper cash register, checked and made into Cashier lines.
//
// The reader (convex/ai.ts readCashPage) only copies figures down. Everything
// here is plain arithmetic, so a sum cannot be invented, and a figure read wrong
// shows as a total that disagrees with the one the shop wrote.
//
// One thing the paper does that the Cashier must not: an online receipt is written
// on BOTH sides, in on the left and out on the right, to take it back out of the
// drawer's sum. The Cashier does that with one line tagged online. So the right
// side's copy is matched off and never added, or the money would count as paid out.

const number = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

// Unique across a reload too: a page being worked on is kept on the phone.
let nextLine = 0
export const newLine = (fields = {}) => ({
  id: `line-${Date.now().toString(36)}-${(nextLine += 1)}`, amount: null, note: '', online: false, mark: 'none', struck: false, unsure: false, ...fields,
})

/** The reader's answer, in the shape the screen edits. */
export function fromReading(raw) {
  const lines = (list) => (Array.isArray(list) ? list : []).map((l) => newLine({
    amount: number(l?.amount),
    note: String(l?.note ?? '').trim(),
    online: !!l?.online,
    mark: l?.mark === 'yellow' || l?.mark === 'orange' ? l.mark : 'none',
    struck: !!l?.struck,
    unsure: !!l?.unsure,
  }))
  const w = raw?.written ?? {}
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw?.date ?? '') ? raw.date : '',
    opening: number(raw?.opening),
    in: lines(raw?.in),
    out: lines(raw?.out),
    written: {
      inTotal: number(w.inTotal),
      outTotal: number(w.outTotal),
      balance: number(w.balance),
      drawer: number(w.drawer),
      difference: number(w.difference),
      differenceWords: String(w.differenceWords ?? ''),
    },
  }
}

const counted = (list) => list.filter((l) => !l.struck)
const addUp = (list) => counted(list).reduce((t, l) => t + (l.amount ?? 0), 0)

/** Which right-side online lines repeat a left-side one, amount for amount. */
function pairOnline(page) {
  const waiting = new Map()
  for (const l of counted(page.in)) {
    if (!l.online || l.amount == null) continue
    waiting.set(l.amount, [...(waiting.get(l.amount) ?? []), l])
  }
  const repeats = new Set()
  const paidOnline = []
  for (const l of counted(page.out)) {
    if (!l.online || l.amount == null) continue
    const match = waiting.get(l.amount)
    if (match?.length) {
      match.shift()
      repeats.add(l.id)
    } else {
      paidOnline.push(l)
    }
  }
  return { repeats, paidOnline, unpaired: [...waiting.values()].flat() }
}

/** What might explain a side's total being off by `diff` (worked out minus written). */
function whyOff(diff, list, side) {
  const hints = []
  for (const l of list) {
    if (l.amount == null) continue
    if (l.struck && l.amount === -diff) {
      hints.push({ text: `${l.amount} is marked crossed out. If it counts, this total agrees.`, line: l.id, side, struck: false, key: 'Count it' })
    }
    if (!l.struck && l.amount === diff) {
      hints.push({ text: `If ${l.amount} is not meant to count, this total agrees.`, line: l.id, side, struck: true, key: 'Cross it out' })
    }
  }
  const unsure = counted(list).filter((l) => l.unsure && l.amount != null).map((l) => l.amount)
  if (!hints.length && unsure.length) hints.push({ text: `Look first at the figures the reader was unsure of: ${unsure.slice(0, 8).join(', ')}.` })
  // Swapping two digits always changes a figure by a multiple of 9.
  if (Math.abs(diff) % 9 === 0) hints.push({ text: `Off by ${Math.abs(diff)}, which divides by 9: two digits may be swapped on one line.` })
  return hints
}

const row = (key, label, written, worked, hints = []) => ({
  key, label, written, worked,
  ok: written == null ? null : written === worked,
  off: written == null ? 0 : worked - written,
  hints: written == null || written === worked ? [] : hints,
})

/** Every sum on the page, worked out and set against what the shop wrote. */
export function checkPage(page) {
  const { written } = page
  const inTotal = addUp(page.in) + (page.opening ?? 0)
  const outTotal = addUp(page.out)
  const balance = inTotal - outTotal
  const { repeats, paidOnline, unpaired } = pairOnline(page)
  const onlineIn = counted(page.in).filter((l) => l.online).reduce((t, l) => t + (l.amount ?? 0), 0)
  const onlineOutPaid = paidOnline.reduce((t, l) => t + (l.amount ?? 0), 0)
  const cashIn = counted(page.in).filter((l) => !l.online).reduce((t, l) => t + (l.amount ?? 0), 0)
  const cashOut = counted(page.out).filter((l) => !l.online).reduce((t, l) => t + (l.amount ?? 0), 0)
  // What the Cashier will say the drawer should hold, from cash alone.
  const expected = (page.opening ?? 0) + cashIn - cashOut

  const short = written.drawer == null ? null : balance - written.drawer
  const says = written.differenceWords.toLowerCase()
  const saysOver = /more|over|extra|excess/.test(says)
  const saysShort = /less|short|kam/.test(says)
  const signWrong = short != null && written.difference != null && short !== 0
    && ((short > 0 && saysOver) || (short < 0 && saysShort))

  const rows = [
    row('in', 'Left side total', written.inTotal, inTotal, whyOff(inTotal - (written.inTotal ?? 0), page.in, 'in')),
    row('out', 'Right side total', written.outTotal, outTotal, whyOff(outTotal - (written.outTotal ?? 0), page.out, 'out')),
    row('balance', 'Left − Right', written.balance, balance),
    row('short', 'Balance − Drawer', written.difference, short == null ? null : Math.abs(short)),
  ]
  const problems = []
  if (signWrong) problems.push(`The page says "${written.differenceWords}", but the sum makes the drawer ${short > 0 ? 'short' : 'over'}.`)
  if (unpaired.length) {
    problems.push(`Online on the left, not repeated on the right: ${unpaired.map((l) => l.amount).join(', ')}. The page's balance counts this as drawer money; the Cashier will not.`)
  }
  if (paidOnline.length) problems.push(`Online on the right with no match on the left: ${paidOnline.map((l) => l.amount).join(', ')}. These go in as paid from the bank.`)
  if (expected !== balance && !unpaired.length && !paidOnline.length) problems.push(`The Cashier will expect ${expected} in the drawer, the page says ${balance}.`)
  const unread = [...page.in, ...page.out].filter((l) => !l.struck && l.amount == null).length
  if (unread) problems.push(`${unread} ${unread === 1 ? 'figure' : 'figures'} could not be read. Type them in from the photo.`)
  if (page.opening == null) problems.push('The O/B on the page could not be read.')
  if (written.inTotal == null) problems.push('No left side total was found on the page to check against.')
  if (written.outTotal == null) problems.push('No right side total was found on the page to check against.')

  return {
    rows, problems, unread, inTotal, outTotal, balance, short, signWrong,
    onlineIn, onlineOutPaid, cashIn, cashOut, expected, repeats,
    pairs: repeats.size,
    agrees: rows.every((r) => r.ok !== false) && !problems.length,
  }
}

/** A note without the word Online, which the Cashier carries as the line's mode. */
export function cleanNote(note) {
  return String(note)
    .replace(/\bon\s?line\b/gi, ' ')
    .replace(/^[\s:=\-–.]+|[\s:=\-–.]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)

/**
 * The Cashier lines this page makes. Each id comes from what the line says, so
 * adding the same page twice lands on the same rows instead of counting twice.
 */
export function cashierLines(page, date, at = Date.now()) {
  const { repeats } = pairOnline(page)
  const seen = new Map()
  const make = (l, kind, i) => {
    const mode = l.online ? 'online' : 'cash'
    const name = (l.online ? cleanNote(l.note) : l.note.trim()) || (l.online ? 'Online' : '')
    const base = `page-${date}-${kind}-${mode}-${l.amount}-${slug(name)}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return {
      id: `${base}-${n}`, date, kind, mode, name, amount: l.amount,
      at: at + (kind === 'in' ? i : 1000 + i), updatedAt: at, dealer: false,
    }
  }
  const usable = (l) => !l.struck && l.amount != null && l.amount > 0
  return [
    ...page.in.filter(usable).map((l, i) => make(l, 'in', i)),
    ...page.out.filter((l) => usable(l) && !repeats.has(l.id)).map((l, i) => make(l, 'out', i)),
  ]
}
