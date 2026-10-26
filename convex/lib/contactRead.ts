/**
 * The customer's mobile and Aadhaar, as read off a bill photo, checked before
 * either goes in a box.
 *
 * The reader (convex/ai.ts readContact) returns what is written, digit for
 * digit, with a `?` for a digit it cannot make out. Nothing here guesses: a
 * number is only given back to fill a box when it is whole and has the shape
 * it must have. Everything read is still given back as written, so the counter
 * sees it beside the box whether it filled anything or not.
 *
 *   - Mobile: ten digits starting 6, 7, 8 or 9 (every Indian mobile does). A
 *     +91, 91 or 0 written in front is the dialling prefix, not part of it.
 *     The shop's own numbers are on its pad; they are never the customer's.
 *   - Aadhaar: twelve digits, never starting 0 or 1, and the last digit is the
 *     Verhoeff check digit of the other eleven. One misread digit, or two
 *     neighbours swapped, fails the check — the commonest ways a handwritten
 *     number comes out wrong.
 */

export type ReadNumber = {
  /** As written on the photo, spaces and all. */
  raw: string
  /** The number to put in the box, or null when it is not one. */
  number: string | null
}

/** `name`: the customer's name as written on the slip, when one is. */
export type ContactRead = { phones: ReadNumber[]; uids: ReadNumber[]; name?: string }

/** The digits of a number as written: spaces, dashes, dots and brackets go. */
function bare(raw: string): string {
  return raw.replace(/[\s\-.()/]/g, '')
}

/** A whole Indian mobile number, or null. `own` are the shop's own numbers. */
export function parseMobile(raw: string, own: readonly string[] = []): string | null {
  // A first group of three to five digits starting 0 is an STD code: 0651
  // 2234567 is a Ranchi landline, and 06553 is Ramgarh's. Its 0 dropped, what
  // is left can look just like a mobile.
  if (/^\s*\(?0\d{2,4}[\s\-./)]/.test(raw)) return null
  let s = bare(raw)
  if (s.startsWith('+')) s = s.slice(1)
  if (!/^\d+$/.test(s)) return null
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2)
  else if (s.length === 11 && s.startsWith('0')) s = s.slice(1)
  if (!/^[6-9]\d{9}$/.test(s)) return null
  if (own.includes(s)) return null
  return s
}

// Verhoeff's tables: d is the dihedral group D5, p the position permutation.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

/** True when the last digit is the Verhoeff check digit of the rest. */
export function verhoeffValid(digits: string): boolean {
  let c = 0
  const n = digits.length
  for (let i = 0; i < n; i++) {
    c = D[c][P[i % 8][Number(digits[n - 1 - i])]]
  }
  return c === 0
}

/** A whole Aadhaar number, or null. */
export function parseAadhaar(raw: string): string | null {
  const s = bare(raw)
  if (!/^[2-9]\d{11}$/.test(s)) return null
  return verhoeffValid(s) ? s : null
}

/**
 * Everything the reader returned, each with the number it gives (if any).
 * The same number read twice is listed once; the shop's own (`own`) not at all.
 */
export function parseContactRead(
  read: { phones?: readonly string[]; uids?: readonly string[]; name?: string },
  own: readonly string[] = [],
): ContactRead {
  const name = String(read.name ?? '').replace(/\s+/g, ' ').trim()
  const list = (raws: readonly string[] | undefined, parse: (raw: string) => string | null) => {
    const seen = new Set<string>()
    const out: ReadNumber[] = []
    for (const r of raws ?? []) {
      const raw = String(r).trim()
      if (!raw) continue
      const number = parse(raw)
      // The shop's own number off its pad is not shown at all: it is not the
      // customer's, and a line saying so on every bill is noise.
      if (number && own.includes(number)) continue
      const key = number ?? `raw:${bare(raw)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ raw, number })
    }
    return out
  }
  return {
    phones: list(read.phones, (raw) => parseMobile(raw)),
    uids: list(read.uids, parseAadhaar),
    ...(name ? { name } : {}),
  }
}

/** An account as the name box offers it. */
export type NamedAccount = { name: string; mobile: string; mobile2?: string; uid?: string }

/**
 * The customer to put in an empty name box from what a photo said. Most slips
 * carry only a number, so the number comes first: the one account holding a
 * mobile or Aadhaar read off it. Then a name written on the slip, as the
 * account of that name (spelt as the account has it) or, with none, as written.
 * A number two accounts share names neither. `fold` sets case, spacing and
 * "M/s" aside (convex/lib/text foldName).
 */
export function nameToFill(
  current: string | undefined,
  read: ContactRead,
  accounts: readonly NamedAccount[],
  fold: (name: string) => string,
): NamedAccount | null {
  if ((current ?? '').trim()) return null
  const numbers = new Set([...read.phones, ...read.uids].map((r) => r.number).filter(Boolean))
  const holders = accounts.filter((a) =>
    (a.mobile && numbers.has(a.mobile)) || (a.mobile2 && numbers.has(a.mobile2)) || (a.uid && numbers.has(a.uid)))
  if (new Set(holders.map((a) => fold(a.name))).size === 1) return holders[0]
  const written = read.name ?? ''
  if (!fold(written)) return null
  return accounts.find((a) => fold(a.name) === fold(written))
    ?? likeAccount(written, accounts)
    ?? { name: written, mobile: '' }
}

/** Words that say nothing about who it is: courtesies and joiners. */
const NO_NAME = new Set(['m', 's', 'ms', 'mr', 'mrs', 'smt', 'shri', 'sri', 'ji', 'jee', 'and', 'the'])

/** A name's words, lower case, its courtesies left out. */
function nameWords(name: string): string[] {
  return name.toLowerCase().replace(/m\/s/g, ' ').split(/[^a-z0-9]+/).filter((w) => w && !NO_NAME.has(w))
}

/** Letters to change to turn one word into the other (Levenshtein). */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length]
}

/**
 * Two words a hand could have written for one: the same, a letter or two out
 * (one in a short word, two in a long one), or one cut short of the other
 * ("Jew." for "Jewellers").
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const short = Math.min(a.length, b.length)
  if (short >= 3 && (a.startsWith(b) || b.startsWith(a))) return true
  if (short < 4) return false
  return editDistance(a, b) <= (short >= 7 ? 2 : 1)
}

/**
 * The account a name read off a slip is most like, when one stands out. Each
 * written word is looked for among the account's; most of the written words
 * must be found (or all of the account's own name), and the account whose own name (before its comma, the place
 * after) is most covered wins. Two accounts as like as each other: neither.
 */
export function likeAccount<T extends NamedAccount>(written: string, accounts: readonly T[]): T | null {
  const words = nameWords(written)
  if (!words.length) return null
  let best: { account: T; score: number } | null = null
  let second = 0
  for (const account of accounts) {
    const [own, ...place] = account.name.split(',')
    const ownWords = nameWords(own)
    const all = [...ownWords, ...nameWords(place.join(' '))]
    const found = words.filter((w) => all.some((x) => sameWord(w, x))).length
    const share = found / words.length
    const covered = ownWords.filter((x) => words.some((w) => sameWord(w, x))).length / Math.max(1, ownWords.length)
    // Every word of the account's own name there, the place written another
    // way ("Ramgarh" for "RMG"), is still that account.
    if (share < 0.75 && !(covered === 1 && share >= 0.5)) continue
    const score = share * 0.6 + covered * 0.4
    if (!best || score > best.score) { second = best?.score ?? 0; best = { account, score } }
    else if (score > second) second = score
  }
  return best && best.score >= 0.7 && best.score - second >= 0.1 ? best.account : null
}

/**
 * The number to put in an empty box: the first whole one read. A box that
 * already holds something, typed or from the account, is never given one.
 */
export function numberToFill(current: string | undefined, read: readonly ReadNumber[]): string | null {
  if ((current ?? '').trim()) return null
  return read.find((r) => r.number)?.number ?? null
}
