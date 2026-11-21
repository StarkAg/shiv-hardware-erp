// ── What a visit order can ask for: the fixed tiles ─────────────────────────
//
// The counter runs on a touch screen with no keyboard, so a visit order's
// items are tapped, not typed. The names and choices are the quotation's own
// (src/lib/data/brands.ts, src/lib/aluminium.ts, src/lib/upvc.ts,
// src/lib/data/fixedCards.ts), so a visit order says what the quotation
// will price; and the slips the shop wrote by hand (Nov 2026) decided which
// come first and what is picked to start:
//
//   Alum Door 1.6mm with film 2 Pc          Aluminium Door 1.2MM 2 Pc
//   Flush Door 3 Pc, 1" WPC Door 1 Pc       1.6mm Alum Door 1 Pc
//   DDSM 9161 WA 2 Pc / Fitting, Slide, Hinges   (DDSM: DDoor Sunmica)
//   Openable Window 16mm Blue Texture Glass 2 Pc
//   4"x2½" WPC Chowkhat 3 Pc / with Screw   DDSM 9165 CU 3 Pc
//
// Only the doors and windows the shop fits: no railing, ceiling, flooring,
// wall paper, panel, ACP or glass work (Tony, 21 Nov 2026).
//
// An item with `options` opens them as rows of buttons, and the line is
// written from what was picked: "Aluminium Door 1.6mm With Film". An option
// marked `lead` names the item itself ("DDoor Sunmica" + `suffix` " Door");
// `default` is what is picked to start; an option with `none` may be left
// unpicked, and its words are what that button says. Anything not here goes
// in by Other.

const READYMADE = [
  'DDoor Sunmica', 'DDoor Sunmica PM', 'DDoor 3D Lamination', 'DDoor Melamine', 'DDoor Melamine PM',
  'DDoor WPC', 'DDoor Meranti Wooden', 'Arya Membrane', 'Arya 3D Lamination', 'Arya Sunmica', 'EkoTimber WPC',
]
const ALU_THICK = ['1.2mm', '1.6mm', '1.2mm Hindalco']
const UPVC_BRANDS = ['Prominance', 'DDoor', 'Simta']

export const VISIT_ITEMS = [
  {
    group: 'Doors',
    items: [
      {
        text: 'Aluminium Door', unit: 'Pc',
        options: [
          { label: 'Thickness', choices: ALU_THICK, default: '1.6mm' },
          { label: 'Finish', choices: ['With Film', 'Brown Coated'], none: 'Plain' },
          { label: 'With', choices: ['SS Net'], none: 'No net' },
        ],
      },
      {
        text: 'Readymade Door', unit: 'Pc', suffix: ' Door',
        options: [
          { label: 'Brand', lead: true, choices: READYMADE, default: 'DDoor Sunmica' },
          // About a thousand designs (9161 WA, 9165 CU, ...): tapped in on a keypad, the last few used kept as buttons.
          { label: 'Design no.', custom: true, choices: [], none: 'Not said' },
          { label: 'With', choices: ['Fitting (Slide, Hinges)'], none: 'Door only' },
        ],
      },
      // Plain: the brand is the quotation's business, not the visit's (Tony, 21 Nov).
      { text: 'Flush Door', unit: 'Pc' },
      // Always 1", so nothing to pick.
      { text: 'WPC Door', unit: 'Pc' },
      // Plain for now; its rows are kept below (`later`) to bring back once settled.
      {
        text: 'WPC Chowkhat', unit: 'Pc',
        later: [
          { label: 'Size', choices: ['3"x2"', '4"x2½"', '5"x2½"'], default: '4"x2½"' },
          { label: 'Brand', choices: ['Ekotimber', 'Signature', 'Signature Gold'], none: 'Not said' },
          { label: 'With', choices: ['Screw'], none: 'No screw' },
        ],
      },
      {
        text: 'Wooden Chaukhat', unit: 'Pc',
        options: [{ label: 'Size', choices: ['4"x3"'], none: 'Not said', default: '4"x3"' }],
      },
      { text: 'UPVC Door', unit: 'Pc' },
    ],
  },
  {
    group: 'Windows',
    items: [
      // Openable is one of the aluminium window's kinds, beside the tracks
      // ("Openable Window 16mm Blue Texture Glass", 18 Nov: the 16mm written
      // there is the 1.6mm thickness, the same three as every aluminium window).
      {
        text: 'Aluminium Window', unit: 'Pc',
        options: [
          { label: 'Track', choices: ['2 Track', '3 Track', 'Openable'], default: '2 Track' },
          { label: 'Thickness', choices: ALU_THICK, default: '1.2mm' },
          { label: 'Glass', choices: ['Clear & Texture Glass', 'Blue Texture Glass', 'Reflective Glass', 'Frosted Glass'], default: 'Clear & Texture Glass' },
          { label: 'With', choices: ['SS Net'], none: 'No net' },
        ],
      },
      {
        text: 'UPVC Window', unit: 'Pc',
        options: [
          { label: 'Track', choices: ['2 Track', '2.5 Track', '3 Track'], default: '2 Track' },
          { label: 'Brand', choices: UPVC_BRANDS, none: 'Not said' },
          { label: 'Glass', choices: ['Clear Glass', 'Reflective Glass'], default: 'Clear Glass' },
        ],
      },
      { text: 'Ventilator', unit: 'Pc' },
      { text: 'Mosquito Net Window', unit: 'Pc' },
    ],
  },
]

const ALL = VISIT_ITEMS.flatMap((g) => g.items)

/**
 * The design numbers this counter has used lately, newest first: a custom
 * option's quick buttons, so the same design again is one tap.
 */
const RECENT_KEY = 'workshop:recent-designs'
export function recentDesigns() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6) } catch { return [] }
}
export function rememberDesign(no) {
  if (!no) return
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([no, ...recentDesigns().filter((d) => d !== no)].slice(0, 6))) } catch { /* kept for this visit only */ }
}

/** One tap of + on a line: its item's own step, else one. */
export const stepOf = (base) => ALL.find((i) => i.text === base)?.step ?? 1

/** Whether an option is in play: one with `showIf` only while another option has that pick. */
export const shown = (o, picks) => !o.showIf || picks[o.showIf.option] === o.showIf.is

/** What an item starts with picked: each option's default, or nothing where it may be left. */
export const startPicks = (item) => (item.options ?? []).map((o) => o.default ?? (o.none ? '' : o.choices[0]))

/**
 * The line as the slip writes it, from the item and what was picked for each
 * option: "Aluminium Door 1.6mm With Film", "DDoor Sunmica Door 9161 WA With
 * Fitting (Slide, Hinges)", "WPC Chowkhat 4"x2½" Signature With Screw".
 */
export function lineText(item, picks) {
  const opts = item.options ?? []
  const lead = opts.findIndex((o) => o.lead)
  const parts = [lead >= 0 && picks[lead] ? `${picks[lead]}${item.suffix ?? ''}` : item.text]
  opts.forEach((o, i) => {
    const p = picks[i]
    if (!p || i === lead || !shown(o, picks)) return
    parts.push(o.label === 'With' ? `With ${p}` : p)
  })
  return parts.join(' ')
}
