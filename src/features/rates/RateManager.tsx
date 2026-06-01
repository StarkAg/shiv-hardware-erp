import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Minus, Plus, Save, Trash2 } from 'lucide-react'
import { useStore } from '../../lib/store'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Brand,
  type BrandSet,
  type GuaranteeYears,
  type ProductCategory,
} from '../../lib/types'
import { Button, Card, PageHeader } from '../../components/ui'

const GUARANTEE_OPTIONS: GuaranteeYears[] = [0, 1, 3, 5, 7, 10, 15, 20, 25]
const uid = () => Math.random().toString(36).slice(2, 10)

// Brand-based categories only (aluminium is calculated, not brand-listed).
const BRAND_CATEGORIES = CATEGORY_ORDER.filter(
  (c) =>
    c === 'readymade-door' ||
    c === 'flush-door' ||
    c === 'plywood-6' ||
    c === 'block-board-12' ||
    c === 'block-board-19',
)

function clone(set: BrandSet, name: string): BrandSet {
  return { id: uid(), name, brands: set.brands.map((b) => ({ ...b, id: uid() })) }
}

export function RateManager() {
  const { sets, setSets } = useStore()
  // Edits are held in a local draft until "Save" is pressed.
  const [draft, setDraft] = useState<BrandSet[]>(() => structuredClone(sets))
  const [activeIdx, setActiveIdx] = useState(0)
  const [openCat, setOpenCat] = useState<ProductCategory>('readymade-door')

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(sets), [draft, sets])
  const active = draft[activeIdx] ?? draft[0]

  function patchActive(mut: (s: BrandSet) => BrandSet) {
    setDraft((d) => d.map((s, i) => (i === activeIdx ? mut(s) : s)))
  }
  const updateBrand = (id: string, patch: Partial<Brand>) =>
    patchActive((s) => ({ ...s, brands: s.brands.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  const removeBrand = (id: string) =>
    patchActive((s) => ({ ...s, brands: s.brands.filter((b) => b.id !== id) }))
  const addBrand = (category: ProductCategory) =>
    patchActive((s) => ({
      ...s,
      brands: [...s.brands, { id: uid(), category, name: 'New Brand', rate: 0, guaranteeYears: 0 }],
    }))

  function addSet() {
    const name = `Set ${String.fromCharCode(65 + draft.length)}` // Set B, C, …
    setDraft((d) => [...d, clone(d[activeIdx] ?? d[0], name)])
    setActiveIdx(draft.length)
  }
  function removeSet(idx: number) {
    if (draft.length <= 1) return
    if (!confirm(`Delete ${draft[idx].name}?`)) return
    setDraft((d) => d.filter((_, i) => i !== idx))
    setActiveIdx((i) => Math.max(0, i >= idx ? i - 1 : i))
  }
  const renameSet = (idx: number, name: string) =>
    setDraft((d) => d.map((s, i) => (i === idx ? { ...s, name } : s)))

  function save() {
    setSets(structuredClone(draft))
    alert('Price sets saved')
  }
  function reset() {
    setDraft(structuredClone(sets))
    setActiveIdx(0)
  }

  return (
    <div>
      <PageHeader
        title="Rate Manager"
        subtitle="Maintain price sets — rates are ₹ per sqft"
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={reset}>
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty} className="flex items-center gap-1.5">
              <Save size={16} /> Save{dirty ? ' *' : ''}
            </Button>
          </>
        }
      />

      <div className="p-6 space-y-4">
        {/* Set tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {draft.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setActiveIdx(i)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                i === activeIdx
                  ? 'border-shiv-green bg-shiv-green text-stone-950 shadow-sm'
                  : 'border-stone-300 bg-white/80 text-stone-600 hover:border-shiv-green hover:bg-white'
              }`}
            >
              {s.name}
            </button>
          ))}
          <button
            onClick={addSet}
            title="Add a set (copy of current)"
            className="flex items-center gap-1 rounded-lg border border-dashed border-stone-400 px-3 py-2 text-sm font-medium text-stone-500 hover:border-shiv-green hover:bg-white"
          >
            <Plus size={16} /> Add Set
          </button>
        </div>

        {/* Active set toolbar */}
        <Card className="flex items-center justify-between p-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-stone-500">Set name</span>
            <input
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold"
              value={active?.name ?? ''}
              onChange={(e) => renameSet(activeIdx, e.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addSet} className="flex items-center gap-1.5">
              <Copy size={15} /> Duplicate to new set
            </Button>
            <Button
              variant="ghost"
              onClick={() => removeSet(activeIdx)}
              disabled={draft.length <= 1}
              className="flex items-center gap-1.5 text-red-500"
            >
              <Trash2 size={15} /> Delete set
            </Button>
          </div>
        </Card>

        {/* Per-category brand editor */}
        {BRAND_CATEGORIES.map((cat) => {
          const list = active?.brands.filter((b) => b.category === cat) ?? []
          const isOpen = openCat === cat
          return (
            <Card key={cat} className="overflow-hidden">
              <button
                className="flex w-full items-center justify-between bg-stone-50 px-4 py-3 text-left font-semibold"
                onClick={() => setOpenCat(isOpen ? ('' as ProductCategory) : cat)}
              >
                <span>
                  {CATEGORY_LABELS[cat]} <span className="text-sm text-stone-400">({list.length})</span>
                </span>
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {isOpen && (
                <div className="p-4">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-slate-400">
                      <tr>
                        <th className="py-1">Brand</th>
                        <th className="py-1 w-32">Rate ₹/sqft</th>
                        <th className="py-1 w-40">Guarantee</th>
                        <th className="py-1 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((b) => (
                        <tr key={b.id} className="border-t border-slate-100">
                          <td className="py-1 pr-2">
                            <input
                              className="w-full rounded border border-slate-200 px-2 py-1"
                              value={b.name}
                              onChange={(e) => updateBrand(b.id, { name: e.target.value })}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              type="number"
                              className="w-full rounded border border-slate-200 px-2 py-1"
                              value={b.rate}
                              onChange={(e) => updateBrand(b.id, { rate: Number(e.target.value) })}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <select
                              className="w-full rounded border border-slate-200 px-2 py-1"
                              value={b.guaranteeYears}
                              onChange={(e) =>
                                updateBrand(b.id, { guaranteeYears: Number(e.target.value) as GuaranteeYears })
                              }
                            >
                              {GUARANTEE_OPTIONS.map((g) => (
                                <option key={g} value={g}>
                                  {g === 0 ? 'None' : `${g} Years`}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 text-right">
                            <button
                              className="rounded p-1 text-red-500 hover:bg-red-50"
                              onClick={() => removeBrand(b.id)}
                              title="Remove brand"
                            >
                              <Minus size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Button variant="outline" className="mt-3 flex items-center gap-1.5" onClick={() => addBrand(cat)}>
                    <Plus size={16} /> Add brand
                  </Button>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
