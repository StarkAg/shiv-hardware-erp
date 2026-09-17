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
  alaldite: 'Araldite',
  vaccum: 'Vacuum',
}

/** An item name with every known misspelling put right. */
export function fixSpelling(text: string | undefined | null): string {
  return String(text ?? '').replace(/[A-Za-z]+/g, (word) => FIXES[word.toLowerCase()] ?? word)
}

/**
 * Whole items the shop settled on one name for, where one item was on the
 * list twice written two ways ("19 X 6 SS Screw (+)" and "19 X 6 Screw SS
 * (+)"), or a laminate was "Mica", "HR Lam" or a bare code. Matched on the
 * whole name, ignoring case, spacing and '' against ", so it only ever moves
 * these items and never a word inside another name.
 *
 * To add one: the old name as `nameKey` gives it on the left, the shop's name
 * on the right.
 */
const NAMES: Record<string, string> = {
  '19 x 6 ss screw (+)': '19 X 6 Screw SS (+)',
  '30" screw ss (+)': '3" Screw SS (+)',
  '4" cutter blade': '4" Cutter Blade Bosch',
  '4" cutter blade bosch': '4" Cutter Blade Bosch',
  'sunmica linear offwhite': 'Sunmica Linear Off White',
  'mica 9441': 'Sunmica 9441 SHG',
  'mica 9441 - shg': 'Sunmica 9441 SHG',
  '9441-shg': 'Sunmica 9441 SHG',
  'mica 3419 century': 'Sunmica Century 3419 SU',
  'mica 3419 su century': 'Sunmica Century 3419 SU',
  'hr lam 8207-st': 'Sunmica HR 8207 ST',
  'mica hr 8207 st': 'Sunmica HR 8207 ST',
  'hr lam 8247 fr': 'Sunmica HR 8247 FR',
  'h.r. lam 8221 sf': 'Sunmica HR 8221 SF',
  'mica hr 8211 hg': 'Sunmica HR 8211 HG',
  'mica hr 8224 sf': 'Sunmica HR 8224 SF',
  '111 hdg': 'Sunmica HT 111 HDG',
  '4284 ngn': 'Sunmica HT 4284 NGN',
  'sunmica ht 4284': 'Sunmica HT 4284 NGN',
  'c gst 9%': 'CGST 9%',
  's gst 9%': 'SGST 9%',
  '1/1/2 nail': '1 1/2" Nail',
  '20no 3/4" hl nail': '20 No 3/4" HL Nail',
  'l vacuum ss 3/4"': '3/4" L Vacuum SS',
  '6" t/b acer jazz': '6" TB Acer Jazz',
  '6mm s 8 x 4 pcs': '6mm S 8 X 4',
  'fevicol relam 430 g': 'Fevicol Relam 430 Gm',
  // Laminates written as a bare code, or as "Mica".
  '240 hdg': 'Sunmica HT 240 HDG',
  '0.8 lw 8340': 'Sunmica 0.8mm LW 8340',
  '0.8mm lw 8340': 'Sunmica 0.8mm LW 8340',
  '0.8mm hg 8008': 'Sunmica 0.8mm HG 8008',
  'sunmica lpol 1402': 'Sunmica LP/OL 1402',
  'mica': 'Sunmica',
  'mica 3 pcs': 'Sunmica',
  'mica hg': 'Sunmica HG',
  // A vague copy of an item that has its full name on the list.
  '19mm l hinges': '19mm L Hinges SS',
  '9" bed joint': '9" Bed Joint H',
  '5" x 2.5" wpc chowkhat': `5" X 2.5" WPC Chowkhat 7'`,
  '1 1/2" x 3/4" dhal pvc': '1 1/2" X 3/4" Dhal PVC 7 1/4"',
  "35 x 10 lipping teak 250'": '35 X 10 Lipping Teak',
  'glass runner': 'Glass Runner Prakash',
}

export const nameKey = (text: string) =>
  text.toLowerCase().replace(/''|″/g, '"').replace(/′/g, "'").replace(/\s+/g, ' ').trim()

/** The shop's name for an item it renamed, or the name as it came. */
export function shopName(text: string): string {
  return NAMES[nameKey(text)] ?? text
}
