import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button, Card, Page, PageHeader } from '../../components/ui'
import Confirm from '../ledger/components/Confirm'
import { ALU_THICKNESSES } from '../../lib/aluminium'
import {
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
  type Thick3,
} from '../../lib/aluCosting'
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
      <td className={`${td} w-28`}>
        <Num label={`${label} margin`} value={margin.value} onChange={(value) => onChange({ ...margin, value })} />
      </td>
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
        subtitle="Section kg, aluminium rate, raw materials and margin. Every quotation price is worked out from these."
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

        <Section title="Aluminium rate" note="Rs per kg. One rate for the door and both windows.">
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
          note="Per sqft: counted on the area. By length: a x height + b x width, in feet, rounded up. Fixed: that many, whatever the size."
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
                      <span className="tabular-nums">{n2(partQty(p, s))}</span>
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

        <Section title="Margin" note="Added to the making cost. A percentage of the cost, or rupees per unit sold.">
          <table className="text-sm">
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
      </Page>

      {resetting && (
        <Confirm
          title="Reset aluminium rates?"
          body="Every section weight, aluminium rate, material, price and margin on all three products goes back to its starting value, on every counter."
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
