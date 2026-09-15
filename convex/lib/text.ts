import { fixSpelling } from './spelling'

/**
 * How every name in the shop is written: proper case, with codes in capitals.
 *
 * One rule for the whole panel and the server, because the same words were
 * reaching the books three ways — "M/S Vishal Prasad Ji", "M/s Vishal Prasad
 * Ji", "Rajesh Kumar jee" — and a unit list held "kg" and "Kg" side by side.
 *
 *   - Every word starts with a capital: "bunty sharma jee" → "Bunty Sharma Jee".
 *   - Codes are capitals. A Sunmica model or an item code — "9441-shg",
 *     "4284 ngn", "240 hdg", "3419 su" — and GST names — "cgst 9%" — are
 *     written "9441-SHG", "4284 NGN", "240 HDG", "3419 SU", "CGST 9%". A code
 *     is a short word with no vowel, or a short word written against a model
 *     number, or one of the GST names.
 *   - Letters stuck to a number are left as typed: "19mm", "3D", "20No".
 *   - Short capitals written on purpose stay: "SRT", "Ghato AIC".
 *   - A name typed with the caps lock on is set properly:
 *     "G PROFILE HANDLE BLACK" → "G Profile Handle Black".
 *
 * `properText` changes the length (spaces, the comma), so it is for saving and
 * for leaving a field — never for every keystroke, where it would move the
 * caret. While typing, `properTyping` only raises first letters.
 */

const VOWEL = /[aeiouy]/i

/** GST and the words that travel with it, always in capitals. */
const TAX = new Set(['gst', 'cgst', 'sgst', 'igst', 'utgst', 'gstin', 'hsn', 'tds', 'vat'])

/** Measures written small whatever the keyboard did: 19 mm, 30 cm. */
const SMALL = new Set(['mm', 'cm'])

/**
 * Unit words, which have no vowel either but are not codes: Pc, Kg, Pkt.
 * Written with a capital and nothing more.
 */
const UNIT_WORDS = new Set([
  'pc', 'pcs', 'kg', 'kgs', 'gm', 'gms', 'ft', 'sft', 'sqft', 'sq', 'pkt', 'pkts',
  'ltr', 'mtr', 'ml', 'nos', 'set', 'sets', 'box', 'bag', 'roll', 'feet', 'inch', 'sheet',
])

/** Short words with no vowel that are words, not codes. */
const NOT_CODES = new Set(['mr', 'mrs', 'ms', 'dr', 'jr', 'sr', 'st', 'smt', 'pvt', 'ltd', 'nr', 'bhd'])

const COURTESY = /^m\/s\.?$/i
const MODEL_NUMBER = /^\d{3,}(?:\.\d+)?$/

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

function fixRun(
  run: string,
  before: string,
  beforeThat: string,
  nearModel: boolean,
  shouted: boolean,
): string {
  const lower = run.toLowerCase()
  const caps = run === run.toUpperCase()

  // "19mm", "3D", "20No": letters on a number belong to the number.
  if (/\d/.test(before)) return run
  if (TAX.has(lower)) return run.toUpperCase()
  if (SMALL.has(lower)) return lower
  if (UNIT_WORDS.has(lower)) return capital(run)
  // "Louver's", "don't" — but "O'Brien".
  if (/['’]/.test(before) && /[A-Za-z]/.test(beforeThat)) return run.length <= 2 ? lower : capital(run)
  // Beside a model number a short word is its code: "3419 SU", "8207-ST".
  if (nearModel && (run.length <= 2 || (caps && run.length <= 4))) return run.toUpperCase()
  if (NOT_CODES.has(lower)) return capital(run)
  // HDG, SHG, NGN, SS, MP, HL, WPC.
  if (run.length >= 2 && run.length <= 4 && !VOWEL.test(run)) return run.toUpperCase()
  // Capitals typed on purpose: SRT, AIC.
  if (caps && run.length <= 4 && !shouted) return run
  if (caps) return capital(run)
  // Otherwise raise the first letter and keep the rest: "HeatX", "DDoor".
  return run.charAt(0).toUpperCase() + run.slice(1)
}

/** A name or item, set to the shop's rule. For saving and leaving a field. */
export function properText(input: string | undefined | null): string {
  const text = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    // "Agarwal Enterprises ,Ranchi" → "Agarwal Enterprises, Ranchi".
    .replace(/\s*,\s*(?=[A-Za-z])/g, ', ')
  if (!text) return ''
  // Caps lock on: no small letters anywhere, and a real word among them.
  const shouted = !/[a-z]/.test(text) && /[A-Z]{5,}/.test(text)
  const words = text.split(' ')
  return words
    .map((word, i) => {
      if (COURTESY.test(word)) return 'M/s'
      const nearModel =
        MODEL_NUMBER.test(words[i - 1] ?? '') ||
        MODEL_NUMBER.test(words[i + 1] ?? '') ||
        /\d{3,}/.test(word)
      return word.replace(/[A-Za-z]+/g, (run, at: number) =>
        fixRun(run, word[at - 1] ?? '', word[at - 2] ?? '', nearModel, shouted),
      )
    })
    .join(' ')
}

/**
 * An item line: the shop's spelling of the goods ("Abbro" → "Abro"), the
 * name rule, and board sizes spaced "8 X 4".
 */
export function properItem(input: string | undefined | null): string {
  // Every "x" between two sizes, however many parts and with inch or foot
  // marks: "17x20x6" → "17 X 20 X 6", '1 1/2"x3/4"' → '1 1/2" X 3/4"'.
  return properText(fixSpelling(input)).replace(/(\d+(?:\.\d+)?['"′″]*)\s*[x×]\s*(?=\d)/gi, '$1 X ')
}

/**
 * While typing: only first letters are raised, so the length never changes
 * and the caret stays where it is. The rest of the rule is applied when the
 * field is left.
 */
export function properTyping(input: string): string {
  return input
    .replace(/(^|[^A-Za-z0-9'’])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase())
    .replace(/(['’])([a-z])([a-z]{2,})/g, (_, quote, first, rest) => quote + first.toUpperCase() + rest)
}

/**
 * One name per unit. "kg" and "Kg" were two entries; "sit" was a sheet, "Bl"
 * a bundle, "cartun" a case — each written its own way by whoever was typing.
 */
const UNITS: Record<string, string> = {
  pc: 'Pc', pcs: 'Pc', piece: 'Pc', pieces: 'Pc', nos: 'Pc', no: 'Pc',
  kg: 'Kg', kgs: 'Kg', kilo: 'Kg',
  g: 'Gm', gm: 'Gm', gms: 'Gm', gram: 'Gm', grams: 'Gm',
  set: 'Set', sets: 'Set',
  sheet: 'Sheet', sheets: 'Sheet', sht: 'Sheet', sit: 'Sheet',
  pkt: 'Pkt', pkts: 'Pkt', packet: 'Pkt', packets: 'Pkt', pack: 'Pkt',
  bl: 'B/L', 'b/l': 'B/L', bundle: 'B/L', bdl: 'B/L',
  'c/s': 'C/s', cs: 'C/s', case: 'C/s', carton: 'C/s', cartun: 'C/s', ctn: 'C/s',
  feet: 'Feet', ft: 'Feet', foot: 'Feet',
  box: 'Box', boxes: 'Box',
  roll: 'Roll', rolls: 'Roll',
  ltr: 'Ltr', litre: 'Ltr', liter: 'Ltr', l: 'Ltr',
  mtr: 'Mtr', meter: 'Mtr', metre: 'Mtr', m: 'Mtr',
  bag: 'Bag', bags: 'Bag',
  dozen: 'Dozen', dz: 'Dozen',
  sqft: 'Sqft', sft: 'Sqft',
  pair: 'Pair', pairs: 'Pair',
  inch: 'Inch', inches: 'Inch',
}

export function canonicalUnit(unit: string | undefined | null): string {
  const clean = String(unit ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return UNITS[clean.toLowerCase().replace(/\.$/, '')] ?? properText(clean)
}

/** The same person written two ways: case, spacing and the "M/s" set aside. */
export const foldName = (name: string | undefined | null) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/^m\/s\.?\s+/, '')
    .replace(/\s+/g, ' ')
