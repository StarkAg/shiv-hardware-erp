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

const GUARANTEE_OPTIONS: GuaranteeYears[] = [0, 1, 3, 5, 7, 8, 10, 15, 20, 21, 25, 30]
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

const codeSets = (sets: BrandSet[]): BrandSet[] => sets.map((s, i) => ({ ...s, name: `C${i + 1}` }))

function clone(set: BrandSet, name: string): BrandSet {
  return { id: uid(), name, brands: set.brands.map((b) => ({ ...b, id: uid() })) }
}

export function RateManager() {
  const { sets, setSets } = useStore()
  // Edits are held in a local draft until "Save" is pressed.
  const [draft, setDraft] = useState<BrandSet[]>(() => codeSets(structuredClone(sets)))
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
    const name = `C${draft.length + 1}`
    setDraft((d) => [...d, clone(d[activeIdx] ?? d[0], name)])
    setActiveIdx(draft.length)
  }
  function removeSet(idx: number) {
    if (draft.length <= 1) return
    if (!confirm(`Delete ${draft[idx].name}?`)) return
    setDraft((d) => codeSets(d.filter((_, i) => i !== idx)))
    setActiveIdx((i) => Math.max(0, i >= idx ? i - 1 : i))
  }

  function save() {
    setSets(codeSets(structuredClone(draft)))
    alert('Price sets saved')
  }
  function reset() {
    setDraft(codeSets(structuredClone(sets)))
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

      <div className="space-y-4 p-3 sm:p-4 md:p-6">
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
        <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-stone-700 dark:text-stone-200">
            Active set: <span className="text-shiv-green">{active?.name ?? 'C1'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                className="flex w-full items-center justify-between bg-stone-50 px-4 py-3 text-left font-semibold dark:bg-white/5"
                onClick={() => setOpenCat(isOpen ? ('' as ProductCategory) : cat)}
              >
                <span>
                  {CATEGORY_LABELS[cat]} <span className="text-sm text-stone-400">({list.length})</span>
                </span>
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {isOpen && (
                <div className="p-2 md:p-4">
                  <table className="w-full table-fixed text-[11px] leading-tight md:text-sm">
                    <colgroup>
                      <col className="w-[56%]" />
                      <col className="w-[18%]" />
                      <col className="w-[18%]" />
                      <col className="w-[8%]" />
                    </colgroup>
                    <thead className="text-left text-[9px] uppercase text-slate-400 dark:text-stone-500 md:text-xs">
                      <tr>
                        <th className="px-1 py-0.5 md:px-2 md:py-1">Brand</th>
                        <th className="px-0.5 py-0.5 text-right md:px-2 md:py-1">
                          <span className="md:hidden">Rate</span>
                          <span className="hidden md:inline">Rate ₹/sqft</span>
                        </th>
                        <th className="px-0.5 py-0.5 text-center md:px-2 md:py-1">
                          <span className="md:hidden">Gty</span>
                          <span className="hidden md:inline">Guarantee</span>
                        </th>
                        <th className="px-0.5 py-0.5 md:py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((b) => (
                        <tr key={b.id} className="border-t border-slate-100 dark:border-white/10">
                          <td className="px-1 py-0.5 md:px-2 md:py-1">
                            <input
                              className="h-7 w-full min-w-0 rounded border border-slate-200 px-1 text-[10px] leading-none dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:px-2 md:py-1 md:text-sm"
                              value={b.name}
                              onChange={(e) => updateBrand(b.id, { name: e.target.value })}
                            />
                          </td>
                          <td className="px-0.5 py-0.5 md:px-2 md:py-1">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              className="h-7 w-full min-w-0 rounded border border-slate-200 px-0.5 text-right text-[10px] leading-none dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:px-2 md:py-1 md:text-sm"
                              value={b.rate}
                              onChange={(e) => updateBrand(b.id, { rate: Number(e.target.value.replace(/\D/g, '')) })}
                            />
                          </td>
                          <td className="px-0.5 py-0.5 md:px-2 md:py-1">
                            <div className="relative">
                              <div className="flex h-7 w-full min-w-0 items-center justify-center rounded border border-stone-300 bg-stone-50 px-0.5 text-center text-[10px] font-medium leading-none text-stone-800 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:px-3 md:py-2 md:text-sm">
                                {b.guaranteeYears === 0 ? '-' : `${b.guaranteeYears}y`}
                              </div>
                              <select
                                aria-label="Guarantee"
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                value={b.guaranteeYears}
                                onChange={(e) =>
                                  updateBrand(b.id, { guaranteeYears: Number(e.target.value) as GuaranteeYears })
                                }
                              >
                                {GUARANTEE_OPTIONS.map((g) => (
                                  <option key={g} value={g}>
                                    {g === 0 ? '-' : `${g}y`}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="px-0.5 py-0.5 text-right md:py-1">
                            <button
                              className="rounded p-0.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 md:p-1"
                              onClick={() => removeBrand(b.id)}
                              title="Remove brand"
                            >
                              <Minus size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Button variant="outline" className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs md:px-4 md:py-2 md:text-sm" onClick={() => addBrand(cat)}>
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
