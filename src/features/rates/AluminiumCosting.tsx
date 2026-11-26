import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button, Card, Page, PageHeader } from '../../components/ui'
import Confirm from '../ledger/components/Confirm'
import { ALU_THICKNESSES } from '../../lib/aluminium'
import {
  CHAUKHAT_MIN_RFT,
  DOOR_MIN_SQFT,
  costOut,
  newId,
  partAmount,
  partQty,
  sectionFeet,
  sectionKg,
  sizeOf,
  type AluCosting,
  type AluPart,
  type AluProduct,
  type AluSection,
  type Margin,
  type PriceMode,
  type Thick3,
} from '../../lib/aluCosting'
import { calcAllThicknessesSheet, sheetSize, type Slab } from '../../lib/aluSheet'
import { resetAluCosting, saveAluCosting, useAluCosting } from '../../lib/aluCostingStore'
import { formatINR } from '../../lib/pricing'

const PRODUCTS: { id: AluProduct; label: string; quote: string }[] = [
  { id: 'door', label: 'Aluminium Door', quote: '/product/aluminium-door' },
  { id: 'win2', label: '2 Track Window', quote: '/product/window-2-track' },
  { id: 'win3', label: '3 Track Window', quote: '/product/window-3-track' },
]

const isProduct = (p?: string): p is AluProduct => p === 'door' || p === 'win2' || p === 'win3'

const n2 = (x: number, d = 2) => x.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })

/**
 * A number box that lets the field be empty while it is being typed over, and
 * hands back a number. An empty box counts as 0.
 */
function Num({
  value, onChange, className = '', label, step = 'any',
}: { value: number; onChange: (v: number) => void; className?: string; label: string; step?: string }) {
  const [text, setText] = useState(String(value ?? 0))
  useEffect(() => {
    if (Number(text || 0) !== value) setText(String(value ?? 0))
    // Only an outside change (another device, a reset) rewrites the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const v = Number(e.target.value)
        onChange(Number.isFinite(v) ? v : 0)
      }}
      className={`w-full min-w-[64px] rounded-md border border-stone-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 ${className}`}
    />
  )
}

function Text({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-[150px] rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20"
    />
  )
}

/** Two or three choices side by side; the one in force is filled in. */
function Choice<T extends string>({
  value, options, onChange,
}: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-stone-300">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`whitespace-nowrap px-2.5 py-1.5 text-xs font-semibold ${
            value === o.id ? 'bg-stone-900 text-white' : 'bg-white text-stone-700 hover:bg-stone-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-3 md:p-4">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{title}</h2>
      <div className="overflow-x-auto">{children}</div>
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </Card>
  )
}

const th = 'px-2 py-1.5 text-left text-[11px] font-bold uppercase text-muted whitespace-nowrap'
const td = 'px-2 py-1 align-middle'

function MarginEditor({ label, unit, margin, onChange }: {
  label: string; unit: string; margin: Margin; onChange: (m: Margin) => void
}) {
  return (
    <tr className="border-t border-stone-100">
      <td className={`${td} font-semibold`}>{label}</td>
      <td className={td}>
        <Choice
          value={margin.mode}
          options={[{ id: 'pct', label: '% of cost' }, { id: 'rs', label: `Rs ${unit}` }]}
          onChange={(mode) => onChange({ ...margin, mode })}
        />
      </td>
      {ALU_THICKNESSES.map((t, i) => (
        <td key={t} className={`${td} w-28`}>
          <Num
            label={`${label} margin ${t}`}
            value={margin.value[i]}
            onChange={(v) => {
              const value = [...margin.value] as Thick3
              value[i] = v
              onChange({ ...margin, value })
            }}
          />
        </td>
      ))}
      <td className={`${td} text-xs text-muted`}>{margin.mode === 'pct' ? '%' : unit}</td>
    </tr>
  )
}

/**
 * Aluminium doors and windows, priced from what they are made of.
 *
 * Section weights, the rate of aluminium per kg, the raw materials and their
 * prices, and the margin are all set here; the quotation works every price
 * out from them (lib/aluCosting). Edits save as they are made and reach the
 * other counters a moment later.
 */
export function AluminiumCosting() {
  const params = useParams<{ product?: string }>()
  const navigate = useNavigate()
  const product: AluProduct = isProduct(params.product) ? params.product : 'door'
  const costing = useAluCosting()
  const [resetting, setResetting] = useState(false)
  const [size, setSize] = useState({ h: 78, w: 30 })

  // A sensible test size for each product.
  useEffect(() => {
    setSize(product === 'door' ? { h: 78, w: 30 } : product === 'win2' ? { h: 48, w: 48 } : { h: 48, w: 36 })
  }, [product])

  const isDoor = product === 'door'
  const spec = isDoor ? costing.door : costing[product]
  const s = sizeOf({ inches: size.h, soot: 0 }, { inches: size.w, soot: 0 })
  const rows = costOut(product, s, costing)

  const bySheet = costing.priceBy[product] === 'sheet'

  const put = (fn: (c: AluCosting) => AluCosting) => saveAluCosting(fn(structuredClone(costing)))
  const putSpec = (fn: (sp: typeof spec) => void) =>
    put((c) => {
      fn(isDoor ? c.door : c[product])
      return c
    })

  const setSection = (i: number, patch: Partial<AluSection>) =>
    putSpec((sp) => { sp.sections[i] = { ...sp.sections[i], ...patch } })
  const setKg = (i: number, t: number, v: number) =>
    putSpec((sp) => {
      const kg = [...sp.sections[i].kg] as Thick3
      kg[t] = v
      sp.sections[i].kg = kg
    })
  const setPart = (i: number, patch: Partial<AluPart>) =>
    putSpec((sp) => { sp.parts[i] = { ...sp.parts[i], ...patch } })

  return (
    <>
      <PageHeader
        title="Aluminium rates"
        subtitle="Price each product from its section kg, aluminium rate, materials and margin, or straight off the selling sheet."
        actions={
          <Link to={PRODUCTS.find((p) => p.id === product)!.quote}>
            <Button variant="outline" className="flex items-center gap-1.5">
              <ArrowLeft size={16} /> Back to quotation
            </Button>
          </Link>
        }
      />
      <Page>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Choice value={product} options={PRODUCTS} onChange={(p) => navigate(`/aluminium-rates/${p}`, { replace: true })} />
          <Button variant="ghost" className="flex items-center gap-1.5 text-danger" onClick={() => setResetting(true)}>
            <RotateCcw size={15} /> Reset all to starting values
          </Button>
        </div>

        <Section
          title={`Price the ${PRODUCTS.find((p) => p.id === product)!.label.toLowerCase()} by`}
          note={bySheet
            ? 'The quotation takes the rates below, as on the selling sheet (Aluminium Rates.xlsm).'
            : 'The quotation works the price out from the section kg, aluminium rate, materials and margin below.'}
        >
          <Choice<PriceMode>
            value={costing.priceBy[product]}
            options={[{ id: 'costing', label: 'Costing' }, { id: 'sheet', label: 'Sheet price' }]}
            onChange={(m) => put((c) => { c.priceBy[product] = m; return c })}
          />
        </Section>

        {bySheet ? (
          <SheetEditor product={product} costing={costing} put={put} />
        ) : (
        <>
        <Section title="Aluminium rate" note="Rs per kg. The same rate for the door and both windows.">
          <table className="text-sm">
            <thead><tr>{ALU_THICKNESSES.map((t) => <th key={t} className={th}>{t}</th>)}</tr></thead>
            <tbody>
              <tr>
                {ALU_THICKNESSES.map((t, i) => (
                  <td key={t} className={`${td} w-32`}>
                    <Num
                      label={`Aluminium rate ${t}`}
                      value={costing.alu[i]}
                      onChange={(v) => put((c) => { c.alu[i] = v; return c })}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </Section>

        <Section
          title="Aluminium sections"
          note={<>Kg = feet used x kg per piece / piece length. Feet used = (x H) heights + (x W) widths of the size.{product === 'win3' && ' These start as the 2-track sections: put in the 3-track ones and the third shutter.'}</>}
        >
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Section</th>
                {isDoor && <th className={th}>Part of</th>}
                <th className={th}>x H</th>
                <th className={th}>x W</th>
                <th className={th}>Piece ft</th>
                {ALU_THICKNESSES.map((t) => <th key={t} className={th}>Kg / piece<br />{t}</th>)}
                <th className={`${th} text-right`}>Ft used</th>
                <th className={`${th} text-right`}>Kg (1.2)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {spec.sections.map((sc, i) => (
                <tr key={sc.id} className="border-t border-stone-100">
                  <td className={td}><Text label="Section name" value={sc.name} onChange={(name) => setSection(i, { name })} /></td>
                  {isDoor && (
                    <td className={td}>
                      <Choice
                        value={sc.grp ?? 'door'}
                        options={[{ id: 'door', label: 'Door' }, { id: 'chk', label: 'Chaukhat' }]}
                        onChange={(grp) => setSection(i, { grp })}
                      />
                    </td>
                  )}
                  <td className={`${td} w-20`}><Num label="Times height" value={sc.xh} onChange={(xh) => setSection(i, { xh })} /></td>
                  <td className={`${td} w-20`}><Num label="Times width" value={sc.xw} onChange={(xw) => setSection(i, { xw })} /></td>
                  <td className={`${td} w-20`}><Num label="Piece length" value={sc.piece} onChange={(piece) => setSection(i, { piece })} /></td>
                  {ALU_THICKNESSES.map((t, ti) => (
                    <td key={t} className={`${td} w-24`}>
                      <Num label={`Kg per piece ${t}`} value={sc.kg[ti]} onChange={(v) => setKg(i, ti, v)} />
                    </td>
                  ))}
                  <td className={`${td} text-right tabular-nums`}>{n2(sectionFeet(sc, s))}</td>
                  <td className={`${td} text-right tabular-nums`}>{n2(sectionKg(sc, s, 0), 3)}</td>
                  <td className={td}>
                    <button
                      type="button"
                      aria-label="Remove section"
                      className="rounded p-1 text-danger hover:bg-red-50"
                      onClick={() => putSpec((sp) => { sp.sections.splice(i, 1) })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            variant="outline"
            className="mt-2 flex items-center gap-1.5"
            onClick={() => putSpec((sp) => {
              sp.sections.push({ id: newId(), name: 'New section', xh: 0, xw: 0, piece: 16, kg: [0, 0, 0], ...(isDoor ? { grp: 'door' as const } : {}) })
            })}
          >
            <Plus size={16} /> Add section
          </Button>
        </Section>

        <Section
          title="Raw materials & labour"
          note="Per sqft: the area, or a share of it (0.5 for half). By length: a x height + b x width, in feet, rounded up. Fixed: that many, whatever the size."
        >
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Material</th>
                {isDoor && <th className={th}>Goes into</th>}
                <th className={th}>Counted</th>
                <th className={th}>Qty</th>
                <th className={th}>Unit</th>
                <th className={th}>Price</th>
                <th className={`${th} text-right`}>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {spec.parts.map((p, i) => (
                <tr key={p.id} className="border-t border-stone-100">
                  <td className={td}><Text label="Material name" value={p.name} onChange={(name) => setPart(i, { name })} /></td>
                  {isDoor && (
                    <td className={td}>
                      <Choice
                        value={p.grp ?? 'door'}
                        options={[{ id: 'door', label: 'Door' }, { id: 'acc', label: 'Accessories' }]}
                        onChange={(grp) => setPart(i, { grp })}
                      />
                    </td>
                  )}
                  <td className={td}>
                    <Choice
                      value={p.kind}
                      options={[{ id: 'area', label: 'Per sqft' }, { id: 'lin', label: 'By length' }, { id: 'fixed', label: 'Fixed' }]}
                      onChange={(kind) => setPart(i, {
                        kind,
                        unit: kind === 'area' ? 'sqft' : kind === 'lin' ? 'ft' : p.kind === 'fixed' ? p.unit : 'pcs',
                        ...(kind === 'lin' && p.a === undefined ? { a: 2, b: 2 } : {}),
                        ...(kind === 'fixed' && p.n === undefined ? { n: 1 } : {}),
                      })}
                    />
                  </td>
                  <td className={td}>
                    {p.kind === 'fixed' ? (
                      <div className="w-20"><Num label="How many" value={p.n ?? 0} onChange={(n) => setPart(i, { n })} /></div>
                    ) : p.kind === 'lin' ? (
                      <div className="flex items-center gap-1 whitespace-nowrap text-xs text-muted">
                        <div className="w-16"><Num label="Times height" value={p.a ?? 0} onChange={(a) => setPart(i, { a })} /></div>H +
                        <div className="w-16"><Num label="Times width" value={p.b ?? 0} onChange={(b) => setPart(i, { b })} /></div>W
                        <span className="ml-1 tabular-nums text-stone-700">= {n2(partQty(p, s), 0)}</span>
                      </div>
                    ) : (
                      // Most cover the whole opening; a half SS net is 0.5 of it.
                      <div className="flex items-center gap-1 whitespace-nowrap text-xs text-muted">
                        <div className="w-16"><Num label="Share of the area" value={p.factor ?? 1} onChange={(factor) => setPart(i, { factor })} /></div>
                        x area
                        <span className="ml-1 tabular-nums text-stone-700">= {n2(partQty(p, s))}</span>
                      </div>
                    )}
                  </td>
                  <td className={`${td} w-24`}>
                    {p.kind === 'fixed'
                      ? <Text label="Unit" value={p.unit} onChange={(unit) => setPart(i, { unit })} />
                      : <span className="text-xs text-muted">{p.unit}</span>}
                  </td>
                  <td className={`${td} w-24`}><Num label="Price" value={p.rate} onChange={(rate) => setPart(i, { rate })} /></td>
                  <td className={`${td} text-right tabular-nums`}>{formatINR(partAmount(p, s))}</td>
                  <td className={td}>
                    <button
                      type="button"
                      aria-label="Remove material"
                      className="rounded p-1 text-danger hover:bg-red-50"
                      onClick={() => putSpec((sp) => { sp.parts.splice(i, 1) })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            variant="outline"
            className="mt-2 flex items-center gap-1.5"
            onClick={() => putSpec((sp) => {
              sp.parts.push({ id: newId(), name: 'New material', kind: 'fixed', n: 1, unit: 'pcs', rate: 0, ...(isDoor ? { grp: 'door' as const } : {}) })
            })}
          >
            <Plus size={16} /> Add material
          </Button>
        </Section>

        <Section
          title="Margin"
          note={<>Added to the making cost, for each thickness: a percentage of the cost, or rupees per unit sold.{isDoor && ` A door is billed as at least ${DOOR_MIN_SQFT} sqft and its chaukhat as at least ${CHAUKHAT_MIN_RFT} rft, as on the selling sheet.`}</>}
        >
          <table className="text-sm">
            <thead>
              <tr>
                <th className={th} />
                <th className={th} />
                {ALU_THICKNESSES.map((t) => <th key={t} className={th}>{t}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {isDoor ? (
                <>
                  <MarginEditor label="Door" unit="per sqft" margin={costing.door.margin.door}
                    onChange={(m) => put((c) => { c.door.margin.door = m; return c })} />
                  <MarginEditor label="Chaukhat" unit="per rft" margin={costing.door.margin.chk}
                    onChange={(m) => put((c) => { c.door.margin.chk = m; return c })} />
                  <MarginEditor label="Accessories" unit="on the set" margin={costing.door.margin.acc}
                    onChange={(m) => put((c) => { c.door.margin.acc = m; return c })} />
                </>
              ) : (
                <MarginEditor label="Window" unit="per sqft" margin={costing[product].margin}
                  onChange={(m) => put((c) => { c[product].margin = m; return c })} />
              )}
            </tbody>
          </table>
        </Section>

        <Section title="Glass & add-ons" note="Add-ons are charged per sqft at these rates, on top of the price.">
          <table className="text-sm">
            <tbody>
              {!isDoor && (
                <tr>
                  <td className={`${td} font-semibold`}>Reflective glass costs extra</td>
                  <td className={`${td} w-28`}>
                    <Num label="Reflective glass extra" value={costing[product].reflectiveExtra}
                      onChange={(v) => put((c) => { c[product].reflectiveExtra = v; return c })} />
                  </td>
                  <td className={`${td} text-xs text-muted`}>Rs per sqft over clear (a cost: the margin goes on top)</td>
                </tr>
              )}
              {(isDoor
                ? [['decorFilm', 'Decor Film'], ['brownCoated', 'Brown Coated']]
                : [...(product === 'win2' ? [['ssNet', 'SS Net']] : []), ['brownCoated', 'Brown Coated']]
              ).map(([key, label]) => (
                <tr key={key} className="border-t border-stone-100">
                  <td className={`${td} font-semibold`}>{label}</td>
                  <td className={`${td} w-28`}>
                    <Num
                      label={label}
                      value={(spec.addons as Record<string, number>)[key] ?? 0}
                      onChange={(v) => putSpec((sp) => { (sp.addons as Record<string, number>)[key] = v })}
                    />
                  </td>
                  <td className={`${td} text-xs text-muted`}>Rs per sqft</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Try a size" note="Prices on the quotation round the rate up to a whole rupee, so the printed rate x size adds up.">
          <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
            <label className="w-28">
              <span className="mb-1 block text-xs font-semibold text-muted">Height (inch)</span>
              <Num label="Height" value={size.h} onChange={(h) => setSize((z) => ({ ...z, h }))} />
            </label>
            <label className="w-28">
              <span className="mb-1 block text-xs font-semibold text-muted">Width (inch)</span>
              <Num label="Width" value={size.w} onChange={(w) => setSize((z) => ({ ...z, w }))} />
            </label>
            <span className="pb-2 text-muted">
              {n2(s.area)} sqft{isDoor && ` · chaukhat ${n2(s.rft)} rft`}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th} />
                {ALU_THICKNESSES.map((t) => <th key={t} className={`${th} text-right`}>{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {(isDoor
                ? [
                    { label: 'Door', unit: 'sqft', get: (r: (typeof rows)[number]) => r.door!.door },
                    { label: 'Chaukhat', unit: 'rft', get: (r: (typeof rows)[number]) => r.door!.chk },
                    { label: 'Accessories', unit: '', get: (r: (typeof rows)[number]) => r.door!.acc },
                  ]
                : [
                    { label: 'Clear & texture glass', unit: 'sqft', get: (r: (typeof rows)[number]) => r.window!.clear },
                    { label: 'Reflective glass', unit: 'sqft', get: (r: (typeof rows)[number]) => r.window!.reflective },
                  ]
              ).map(({ label, unit, get }) => (
                <ResultRows key={label} label={label} unit={unit} items={rows.map(get)} />
              ))}
            </tbody>
          </table>
        </Section>
        </>
        )}
      </Page>

      {resetting && (
        <Confirm
          title="Reset aluminium rates?"
          body="Every section weight, aluminium rate, material, price, margin and sheet rate on all three products goes back to its starting value, and all three go back to Costing, on every counter."
          confirmLabel="Reset"
          danger
          onConfirm={() => resetAluCosting()}
          onClose={() => setResetting(false)}
        />
      )}
    </>
  )
}

function ResultRows({ label, unit, items }: {
  label: string; unit: string; items: { kg: number; cost: number; sell: number; rate: number }[]
}) {
  const cell = `${td} text-right tabular-nums`
  return (
    <>
      <tr className="border-t-2 border-stone-200 bg-stone-100">
        <td colSpan={4} className={`${td} font-bold`}>{label}</td>
      </tr>
      {items.some((x) => x.kg > 0) && (
        <tr><td className={`${td} text-muted`}>Aluminium</td>{items.map((x, i) => <td key={i} className={cell}>{n2(x.kg, 3)} kg</td>)}</tr>
      )}
      <tr><td className={`${td} text-muted`}>Making cost</td>{items.map((x, i) => <td key={i} className={cell}>{formatINR(Math.round(x.cost))}</td>)}</tr>
      <tr><td className={`${td} text-muted`}>Margin</td>{items.map((x, i) => <td key={i} className={cell}>{formatINR(Math.round(x.sell - x.cost))}</td>)}</tr>
      <tr>
        <td className={`${td} font-semibold`}>Price</td>
        {items.map((x, i) => (
          <td key={i} className={`${cell} font-bold text-shiv-green`}>
            {formatINR(x.sell)}
            {unit && x.rate > 0 && <div className="text-xs font-normal text-muted">@{x.rate} / {unit}</div>}
          </td>
        ))}
      </tr>
    </>
  )
}

type DoorSheetKey = 'door' | 'chaukhat' | 'accessories' | 'decorFilm' | 'brownCoated'

/** One row of the sheet's Control Panel: a rate for each thickness. */
function ThickRow({ label, unit, value, onChange }: {
  label: string; unit: string; value: Thick3; onChange: (v: Thick3) => void
}) {
  return (
    <tr className="border-t border-stone-100">
      <td className={`${td} font-semibold`}>{label}</td>
      {ALU_THICKNESSES.map((t, i) => (
        <td key={t} className={`${td} w-28`}>
          <Num
            label={`${label} ${t}`}
            value={value[i]}
            onChange={(v) => {
              const next = [...value] as Thick3
              next[i] = v
              onChange(next)
            }}
          />
        </td>
      ))}
      <td className={`${td} text-xs text-muted`}>{unit}</td>
    </tr>
  )
}

interface TryRow { label: string; key: string; rate?: string; bold?: boolean }

/**
 * The selling sheet's rates, edited where the sheet keeps them: the door's
 * Control Panel, or a window's Rates According To Area and the thickness and
 * glass steps on top of it.
 */
function SheetEditor({ product, costing, put }: {
  product: AluProduct
  costing: AluCosting
  put: (fn: (c: AluCosting) => AluCosting) => void
}) {
  const [size, setSize] = useState({ h: 39, w: 48 })
  useEffect(() => {
    setSize(product === 'door' ? { h: 72, w: 30 } : product === 'win2' ? { h: 36, w: 30 } : { h: 39, w: 48 })
  }, [product])

  const category = product === 'door' ? 'aluminium-door' : product === 'win2' ? 'window-2-track' : 'window-3-track'
  const h = { inches: size.h, soot: 0 }
  const w = { inches: size.w, soot: 0 }
  const s = sheetSize(h, w)
  const addons = { chaukhat: true, accessories: true, decorFilm: true, ssNet: true, brownCoated: true, glassType: 'clear' as const }
  const rows = calcAllThicknessesSheet(category, h, w, addons, costing.sheet)

  const tryRows: TryRow[] = product === 'door'
    ? [
        { label: 'Door', key: 'doorCost', rate: 'doorRate' },
        { label: 'Chaukhat', key: 'chaukhatCost', rate: 'chaukhatRate' },
        { label: 'Accessories', key: 'accessories' },
        { label: 'Total', key: 'total', bold: true },
        { label: 'Decor Film', key: 'decorFilm', rate: 'decorFilmRate' },
        { label: 'Brown Coated', key: 'brownCoated', rate: 'brownCoatedRate' },
      ]
    : [
        { label: '4 MM Clear & Texture Glass', key: 'glassCost', rate: 'glassRate', bold: true },
        { label: '4 MM Reflective Glass', key: 'reflectiveCost', rate: 'reflectiveRate', bold: true },
        ...(product === 'win2' ? [{ label: 'SS Net', key: 'accessories', rate: 'ssNetRate' }] : []),
        { label: 'Brown Coated', key: 'brownCoated', rate: 'brownCoatedRate' },
      ]

  const tryIt = (
    <Section title="Try a size" note="Rate x area, as on the sheet. The quotation shows the same.">
      <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="w-28">
          <span className="mb-1 block text-xs font-semibold text-muted">Height (inch)</span>
          <Num label="Height" value={size.h} onChange={(v) => setSize((z) => ({ ...z, h: v }))} />
        </label>
        <label className="w-28">
          <span className="mb-1 block text-xs font-semibold text-muted">Width (inch)</span>
          <Num label="Width" value={size.w} onChange={(v) => setSize((z) => ({ ...z, w: v }))} />
        </label>
        <span className="pb-2 text-muted">
          {n2(s.area)} sqft{product === 'door' && ` · chaukhat ${n2(s.rft)} rft`}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={th} />
            {ALU_THICKNESSES.map((t) => <th key={t} className={`${th} text-right`}>{t}</th>)}
          </tr>
        </thead>
        <tbody>
          {tryRows.map(({ label, key, rate, bold }) => (
            <tr key={key} className="border-t border-stone-100">
              <td className={`${td} ${bold ? 'font-semibold' : 'text-muted'}`}>{label}</td>
              {rows.map((r, i) => {
                const rec = r as Record<string, unknown>
                return (
                  <td key={i} className={`${td} text-right tabular-nums ${bold ? 'font-bold text-shiv-green' : ''}`}>
                    {formatINR(Number(rec[key] ?? 0))}
                    {rate && <div className="text-xs font-normal text-muted">@{Number(rec[rate] ?? 0)}</div>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )

  if (product === 'door') {
    const d = costing.sheet.door
    const set = (k: DoorSheetKey) => (v: Thick3) => put((c) => { c.sheet.door[k] = v; return c })
    return (
      <>
        <Section title="Control panel" note="Door: rate x area. Chaukhat: rate x (2 heights + width) in feet. Accessories: the set, once.">
          <table className="text-sm">
            <thead>
              <tr>
                <th className={th} />
                {ALU_THICKNESSES.map((t) => <th key={t} className={th}>{t}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              <ThickRow label="Door" unit="Rs per sqft" value={d.door} onChange={set('door')} />
              <ThickRow label="Chaukhat" unit="Rs per rft" value={d.chaukhat} onChange={set('chaukhat')} />
              <ThickRow label="Accessories" unit="Rs the set" value={d.accessories} onChange={set('accessories')} />
              <ThickRow label="Decor Film" unit="Rs per sqft" value={d.decorFilm} onChange={set('decorFilm')} />
              <ThickRow label="Brown Coated" unit="Rs per sqft" value={d.brownCoated} onChange={set('brownCoated')} />
            </tbody>
          </table>
        </Section>
        <Section title="Minimum bill size" note="A smaller door is charged as this size. 0 for none.">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="w-32">
              <span className="mb-1 block text-xs font-semibold text-muted">Area (sqft)</span>
              <Num label="Minimum area" value={d.minSqft} onChange={(v) => put((c) => { c.sheet.door.minSqft = v; return c })} />
            </label>
            <label className="w-32">
              <span className="mb-1 block text-xs font-semibold text-muted">Chaukhat (rft)</span>
              <Num label="Minimum chaukhat" value={d.minRft} onChange={(v) => put((c) => { c.sheet.door.minRft = v; return c })} />
            </label>
          </div>
        </Section>
        {tryIt}
      </>
    )
  }

  const win = costing.sheet[product]
  const putWin = (fn: (x: typeof win) => void) => put((c) => { fn(c.sheet[product]); return c })
  const setSlab = (i: number, patch: Partial<Slab>) => putWin((x) => { x.slabs[i] = { ...x.slabs[i], ...patch } })

  return (
    <>
      <Section
        title="Rates according to area"
        note="The 1.2 mm clear rate, per sqft. A size takes the row with the biggest area not over its own; under the first row it takes the first."
      >
        <table className="text-sm">
          <thead>
            <tr>
              <th className={th}>From sqft</th>
              <th className={th}>Rate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {win.slabs.map((sl, i) => (
              <tr key={i} className="border-t border-stone-100">
                <td className={`${td} w-28`}><Num label="From sqft" value={sl.area} onChange={(area) => setSlab(i, { area })} /></td>
                <td className={`${td} w-28`}><Num label="Rate per sqft" value={sl.rate} onChange={(rate) => setSlab(i, { rate })} /></td>
                <td className={td}>
                  <button
                    type="button"
                    aria-label="Remove row"
                    className="rounded p-1 text-danger hover:bg-red-50 disabled:opacity-30"
                    disabled={win.slabs.length <= 1}
                    onClick={() => putWin((x) => { x.slabs.splice(i, 1) })}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button
          variant="outline"
          className="mt-2 flex items-center gap-1.5"
          onClick={() => putWin((x) => {
            const last = x.slabs[x.slabs.length - 1]
            x.slabs.push({ area: (last?.area ?? 0) + 4, rate: last?.rate ?? 0 })
          })}
        >
          <Plus size={16} /> Add row
        </Button>
      </Section>

      <Section title="Control panel" note="Added to the rate by area. Reflective glass is the clear rate plus its extra.">
        <table className="text-sm">
          <thead>
            <tr>
              <th className={th} />
              {ALU_THICKNESSES.map((t) => <th key={t} className={th}>{t}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            <ThickRow label="Thickness extra" unit="Rs per sqft over the rate by area" value={win.extra}
              onChange={(v) => putWin((x) => { x.extra = v })} />
            {product === 'win2' && (
              <ThickRow label="SS Net" unit="Rs per sqft" value={win.ssNet} onChange={(v) => putWin((x) => { x.ssNet = v })} />
            )}
            <ThickRow label="Brown Coated" unit="Rs per sqft" value={win.brownCoated}
              onChange={(v) => putWin((x) => { x.brownCoated = v })} />
          </tbody>
        </table>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="font-semibold">Reflective glass extra</span>
          <div className="w-28">
            <Num label="Reflective glass extra" value={win.reflective} onChange={(v) => putWin((x) => { x.reflective = v })} />
          </div>
          <span className="text-xs text-muted">Rs per sqft over clear</span>
        </div>
      </Section>

      {tryIt}
    </>
  )
}
