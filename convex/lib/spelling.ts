/**
 * The shop's spelling of the goods it sells.
 *
 * The same item arrives spelled by whoever was holding the pen or the
 * keyboard: "Abbro", "Aabro", "Aboro" for Abro; "Sanmica", "Sanmaica",
 * "Sonmica" for Sunmica; "Ghuja", "Ghuza", "Ghuga" for Gujja. Each wrong word
 * here maps to the one spelling the shop chose, and item names are corrected
 * word by word wherever they are saved. Only whole words are changed, so
 * "Sonrisa" (a brand) and "Discounted" are left alone.
 *
 * To add a spelling: the wrong word in lower case on the left, the right one
 * on the right as it should be written.
 */
const FIXES: Record<string, string> = {
  // Abro tape
  abbro: 'Abro', aabro: 'Abro', aboro: 'Abro', abhro: 'Abro', abbao: 'Abro',
  // Sunmica laminate — chosen over the more common "Sanmica"
  sanmica: 'Sunmica', sanmaica: 'Sunmica', sanvica: 'Sunmica', sonmica: 'Sunmica',
  sonrica: 'Sunmica', sunmaica: 'Sunmica', sanmika: 'Sunmica', sunmika: 'Sunmica',
  // Gujja — chosen over "Ghuja"
  ghuja: 'Gujja', ghuza: 'Gujja', ghuga: 'Gujja', guja: 'Gujja', gujaa: 'Gujja',
  // Chowkhat, the door frame
  chowket: 'Chowkhat', chowkat: 'Chowkhat', chaukhat: 'Chowkhat', choukhat: 'Chowkhat',
  chowkath: 'Chowkhat', chokhat: 'Chowkhat',
  // Brands
  talascopic: 'Telescopic', talescopic: 'Telescopic', telscopic: 'Telescopic',
  centyry: 'Century', centuary: 'Century',
  bosh: 'Bosch',
  asion: 'Asian',
  headx: 'HeatX',
  manfa: 'Marfa', maria: 'Marfa',
  jazu: 'Jazz',
  albihar: 'Albihari',
  // Words
  liping: 'Lipping',
  marbel: 'Marble',
  stel: 'Steel',
  hydrolic: 'Hydraulic',
  baffer: 'Buffer',
  clozer: 'Closer',
  specor: 'Spacer',
  screo: 'Screw',
  deewan: 'Dewan',
  bedjoin: 'Bedjoint',
}

/** An item name with every known misspelling put right. */
export function fixSpelling(text: string | undefined | null): string {
  return String(text ?? '').replace(/[A-Za-z]+/g, (word) => FIXES[word.toLowerCase()] ?? word)
}
