import type { AluAddons } from '../../lib/aluminium'
import { slabRate, windowRates, type AluSheet, type WindowSheet } from '../../lib/aluSheet'
import { formatINR } from '../../lib/pricing'
import type { ProductCategory } from '../../lib/types'

/** A thickness's costs, as lib/aluSheet calcAllThicknessesSheet works them out. */
interface Row {
  name: string
  doorCost?: number
  chaukhatCost?: number
  accessories?: number
  total?: number
  decorFilm?: number
  brownCoated?: number
  reflectiveCost?: number
}
type T3 = [number, number, number]

/**
 * The aluminium cost on the quotation screen when it is priced by the selling
 * sheet: each cost with the sheet rate it comes from under it, and in "Edit
 * set" those rates are boxes to type in, here, for the price set picked below
 * (owner, 28 Nov 2026: "show the sheet rates here, edits too, not inside").
 * In Edit set every row shows, ticked or not, so any rate can be changed.
 */
export function AluSheetCostTable({ cat, addons, rows, sheet, area, hasSize, editMode, onChange }: {
  cat: ProductCategory
  addons: AluAddons
  rows: Row[]
  sheet: AluSheet
  /** The size's sqft as the sheet rounds it (lib/aluSheet sheetSize). */
  area: number
  hasSize: boolean
  editMode: boolean
  onChange: (next: AluSheet) => void
}) {
  const cost = (n: number | undefined) => (hasSize ? formatINR(n ?? 0) : '—')

  // One row: its name, then for each thickness the cost and the rate under it.
  const line = (label: string, costs: (r: Row) => number | undefined, rates: T3, unit: string, set: (t: number, v: number) => void, opts: { on?: boolean; strong?: boolean } = {}) => {
    if (opts.on === false && !editMode) return null
    return (
      <tr key={label} className={opts.strong ? 'border-t-2 border-stone-200 bg-stone-50 dark:border-white/20 dark:bg-white/5' : 'border-t border-stone-100 dark:border-white/10'}>
        <td className={`break-words px-2 py-1.5 md:px-4 md:py-2 ${opts.on === false ? 'text-stone-400 dark:text-stone-500' : 'text-muted'}`}>{label}</td>
        {rows.map((r, t) => (
          <td key={r.name} className="px-1.5 py-1.5 text-right align-top md:px-4 md:py-2">
            <div className={opts.on === false ? 'text-stone-400 dark:text-stone-500' : ''}>{opts.on === false ? '—' : cost(costs(r))}</div>
            {editMode ? (
              <label className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted md:text-xs">
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label={`${label} rate, ${r.name}`}
                  value={rates[t]}
                  onChange={(e) => set(t, Number(e.target.value))}
                  className="h-8 w-16 min-w-0 rounded border border-line px-1.5 text-right text-xs text-stone-900 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:w-20 md:text-sm"
                />
                {unit && <span className="w-8 text-left">{unit}</span>}
              </label>
            ) : unit ? (
              <div className="text-[10px] text-muted md:text-xs">₹{rates[t]}{unit}</div>
            ) : null}
          </td>
        ))}
      </tr>
    )
  }

  const t3 = (list: T3, t: number, v: number): T3 => list.map((x, i) => (i === t ? v : x)) as T3

  let body
  if (cat === 'aluminium-door') {
    const d = sheet.door
    const door = (key: keyof typeof d) => (t: number, v: number) => onChange({ ...sheet, door: { ...d, [key]: t3(d[key], t, v) } })
    body = (
      <>
        {line('Door', (r) => r.doorCost, d.door, '/sqft', door('door'))}
        {line('Chaukhat', (r) => r.chaukhatCost, d.chaukhat, '/rft', door('chaukhat'), { on: addons.chaukhat })}
        {line('Accessories', (r) => r.accessories, d.accessories, '', door('accessories'), { on: addons.accessories })}
        <tr className="border-t-2 border-stone-200 bg-stone-50 dark:border-white/20 dark:bg-white/5">
          <td className="break-words px-2 py-1.5 font-bold md:px-4 md:py-2.5">Total</td>
          {rows.map((r) => (
            <td key={r.name} className="px-1.5 py-1.5 text-right font-bold text-shiv-green md:px-4 md:py-2.5">{cost(r.total)}</td>
          ))}
        </tr>
        {line('Decor Film', (r) => r.decorFilm, d.decorFilm, '/sqft', door('decorFilm'), { on: addons.decorFilm })}
        {line('Brown Coated', (r) => r.brownCoated, d.brownCoated, '/sqft', door('brownCoated'), { on: addons.brownCoated })}
      </>
    )
  } else {
    const key = cat === 'window-3-track' ? 'win3' : 'win2'
    const w = sheet[key]
    const put = (next: WindowSheet) => onChange({ ...sheet, [key]: next })
    const rates = windowRates(area, w)
    const base = slabRate(area, w.slabs)
    // The slab this size falls in: the biggest not over its area, else the smallest.
    const sorted = w.slabs.map((s, i) => ({ ...s, i })).sort((a, b) => a.area - b.area)
    const slab = sorted.reduce((got, s) => (area >= s.area ? s : got), sorted[0])
    // 1.2 MM clear is that slab's rate; 1.6 MM and Hindalco are it plus their extra;
    // reflective is clear plus one extra for all three, as on the sheet.
    const setClear = (t: number, v: number) =>
      t === 0 && slab
        ? put({ ...w, slabs: w.slabs.map((s, i) => (i === slab.i ? { ...s, rate: v - w.extra[0] } : s)) })
        : put({ ...w, extra: t3(w.extra, t, v - base) })
    const setReflective = (t: number, v: number) => put({ ...w, reflective: v - rates[t].clear })
    body = (
      <>
        {line('Clear & Texture Glass', (r) => r.doorCost, rates.map((x) => x.clear) as T3, '/sqft', setClear)}
        {line('Reflective Glass', (r) => r.reflectiveCost, rates.map((x) => x.reflective) as T3, '/sqft', setReflective)}
        {cat === 'window-2-track' && line('SS Net', (r) => r.accessories, w.ssNet, '/sqft', (t, v) => put({ ...w, ssNet: t3(w.ssNet, t, v) }), { on: addons.ssNet })}
        {line('Brown Coated', (r) => r.brownCoated, w.brownCoated, '/sqft', (t, v) => put({ ...w, brownCoated: t3(w.brownCoated, t, v) }), { on: addons.brownCoated })}
        {editMode && slab && (
          <tr className="border-t border-stone-100 dark:border-white/10">
            <td colSpan={4} className="px-2 py-1.5 text-[11px] text-muted md:px-4 md:text-xs">
              Glass rates are for {slab.area} sqft and up. 1.6 MM and Hindalco move with 1.2 MM; reflective is the same amount over clear for all three.
            </td>
          </tr>
        )}
      </>
    )
  }

  return (
    <table className="w-full table-fixed text-[11px] leading-tight md:text-sm">
      <colgroup>
        <col className="w-[28%]" />
        <col className="w-[24%]" />
        <col className="w-[24%]" />
        <col className="w-[24%]" />
      </colgroup>
      <thead className="bg-stone-50 text-left text-[11px] uppercase text-muted dark:bg-white/5 dark:text-muted md:text-xs">
        <tr>
          <th className="px-2 py-1.5 md:px-4 md:py-2">Item</th>
          {rows.map((r) => (
            <th key={r.name} className="break-words px-1.5 py-1.5 text-right md:px-4 md:py-2">{r.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>{body}</tbody>
    </table>
  )
}
