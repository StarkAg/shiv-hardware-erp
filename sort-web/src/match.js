/**
 * Matching a name off a slip to an account in the books.
 *
 * These are handwritten, so the same customer arrives spelled several ways —
 * Nilesh and Nitesh are one pen-stroke apart, and "M/s Pappu jee, Naisarai"
 * and "Pappu Jee" are the same man. Exact matching finds none of it, so this
 * strips the parts that carry no identity and then allows for a few letters
 * being read wrong.
 */

// Written on nearly every slip; they say nothing about who it is.
const NOISE = /\b(m\/s|mrs|messrs|shri|sri|smt|jee|ji|sahab|saheb|and|&|the)\b/g;

// Letter pairs a hand confuses: l/t, n/m, b/v, i/e, s/sh, d/dh, u/o.
const FOLD = [
  [/[ln]/g, 'n'], [/[tl]/g, 'l'], [/[mn]/g, 'n'], [/[bv]/g, 'b'],
  [/[ie]/g, 'i'], [/[uo]/g, 'u'], [/kh|k/g, 'k'], [/sh|s/g, 's'],
  [/dh|d/g, 'd'], [/th|t/g, 't'], [/ph|f/g, 'f'], [/[aeiou]+/g, 'a'],
];

/**
 * Text off a slip, in a state fit to compare.
 *
 * Readings sometimes arrive HTML-escaped through the gateway, so "&lt;UNKNOWN&gt;"
 * has to become "<UNKNOWN>" before anything looks at it.
 */
export function clean(raw) {
  return String(raw ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * The shop itself, in the spellings it turns up in.
 *
 * Our own name is on our letterhead and on the customer line of every supplier
 * slip, and it is never the party to a voucher. Left to itself the matcher
 * happily pairs "Shiv Hardware" with "M/s 4 Cube Hardware" — both are hardware
 * shops, most of the letters agree — and the bill lands on a stranger's ledger.
 */
const OURSELVES = /\bshiv\b.*\b(h(ard)?w(are)?|h\/?ware|hdw)\b|\bshiv\s*hardware\b/i;

export const isOwnShop = (raw) => OURSELVES.test(normalise(clean(raw)));

export function normalise(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .split(',')[0]                       // the locality after the comma is not the name
    .replace(/&lt;|&gt;|&amp;/g, ' ')
    .replace(/[^a-z\s/&]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A spelling-insensitive skeleton of a name, for comparing hands. */
function skeleton(name) {
  let out = normalise(name).replace(/\s/g, '');
  for (const [pattern, to] of FOLD) out = out.replace(pattern, to);
  return out;
}

function distance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}

const ratio = (a, b) =>
  !a.length && !b.length ? 1 : 1 - distance(a, b) / Math.max(a.length, b.length);

/** 0 to 1. Anything above ~0.8 is the same customer in a different hand. */
export function similarity(a, b) {
  const plainA = normalise(a);
  const plainB = normalise(b);
  if (!plainA || !plainB) return 0;
  if (plainA === plainB) return 1;

  const direct = ratio(plainA.replace(/\s/g, ''), plainB.replace(/\s/g, ''));
  const folded = ratio(skeleton(a), skeleton(b));

  // A slip often carries only the first name of a longer account.
  const wordsA = plainA.split(' ').filter(Boolean);
  const wordsB = plainB.split(' ').filter(Boolean);
  const shared = wordsA.filter((w) => w.length > 2 && wordsB.includes(w)).length;
  const overlap = shared / Math.max(1, Math.min(wordsA.length, wordsB.length));

  return Math.max(direct, folded * 0.97, overlap * 0.9);
}

/**
 * The account this name most likely belongs to, or null.
 *
 * Returns the score with it so the screen can say how sure it is — a close
 * match is offered, never applied silently.
 */
export function bestMatch(name, ledgers, floor = 0.72) {
  // Our own name is not a party, and guessing an account for it is worse than
  // guessing nothing — it puts somebody else's slip on a real customer.
  if (!name || isOwnShop(name)) return null;

  let best = null;
  for (const ledger of ledgers) {
    const score = Math.max(
      similarity(name, ledger.name),
      ledger.alias ? similarity(name, ledger.alias) : 0
    );
    if (!best || score > best.score) best = { ledger, score };
  }
  return best && best.score >= floor ? best : null;
}
