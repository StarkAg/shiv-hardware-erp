import { useState } from 'react'
import { ChevronDown, ChevronRight, IndianRupee, Package, Plus, Trash2, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../lib/store'
import type { CatalogField, ProductCategory } from '../../lib/types'
import { CATEGORY_META } from '../../lib/types'
import { RateManager } from '../rates/RateManager'

const fieldUid = () => Math.random().toString(36).slice(2, 10)

const HARDWARE_CATS: ProductCategory[] = [
  'hinge', 'screw', 'aldrop', 'handle', 'tb', 'fevicol', 'mica', 'tape',
]

const CAT_LABEL: Record<string, string> = {
  hinge: 'Hinges', screw: 'Screw', aldrop: 'Aldrop', handle: 'Handle',
  tb: 'Tower Bolt', fevicol: 'Fevicol', mica: 'Mica', tape: 'Abro Tape',
}

// Categories that hide the Sizes group (brands only)
const NO_SIZES: Partial<Record<ProductCategory, true>> = {
  fevicol: true,
}

/** A labeled list of chips with a + to add and (optionally) a × to delete the whole group. */
function ChipList({
  label,
  items,
  onRemove,
  onAdd,
  onDeleteGroup,
  placeholder,
}: {
  label: string
  items: string[]
  onRemove: (v: string) => void
  onAdd: (v: string) => void
  onDeleteGroup?: () => void
  placeholder: string
}) {
  const [adding, setAdding] = useState(false)
  const [val, setVal] = useState('')

  function commit() {
    const v = val.trim()
    if (v && !items.includes(v)) onAdd(v)
    setVal('')
    setAdding(false)
  }

  return (
    <div className="flex items-start gap-2 py-2">
      <span className="group flex w-16 shrink-0 items-center gap-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span className="truncate">{label}</span>
        {onDeleteGroup && (
          <button
            onClick={onDeleteGroup}
            title="Delete this field"
            className="text-stone-300 hover:text-red-400"
          >
            <X size={11} />
          </button>
        )}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((v) => (
          <span
            key={v}
            className="flex items-center gap-1 rounded-full border border-stone-200 bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700 dark:border-white/10 dark:bg-stone-800 dark:text-stone-200"
          >
            {v}
            <button
              onClick={() => onRemove(v)}
              className="ml-0.5 text-muted hover:text-red-400"
            >
              <X size={11} />
            </button>
          </span>
        ))}

        {adding ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              placeholder={placeholder}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setAdding(false) }}
              className="h-7 w-24 rounded-full border border-shiv-green bg-white px-2.5 text-xs dark:bg-stone-900 dark:text-white"
            />
            <button
              onClick={commit}
              className="h-7 rounded-full bg-shiv-green px-2.5 text-xs font-semibold text-stone-950"
            >
              Add
            </button>
            <button
              onClick={() => { setVal(''); setAdding(false) }}
              className="text-muted hover:text-stone-600"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-stone-300 text-muted hover:border-shiv-green hover:text-shiv-green dark:border-white/20"
          >
            <Plus size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Inline "+ Add field" button → expands to a name input for a new custom field group. */
function AddFieldButton({ onAdd }: { onAdd: (label: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')

  function commit() {
    const l = label.trim()
    if (l) onAdd(l)
    setLabel('')
    setAdding(false)
  }

  if (!adding) {
    return (
      <div className="py-2">
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-shiv-green"
        >
          <Plus size={13} /> Add field
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 py-2">
      <input
        autoFocus
        type="text"
        placeholder="Field name (e.g. Colors)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setAdding(false) }}
        className="h-7 w-44 rounded-lg border border-shiv-green bg-white px-2.5 text-xs dark:bg-stone-900 dark:text-white"
      />
      <button
        onClick={commit}
        className="h-7 rounded-lg bg-shiv-green px-2.5 text-xs font-semibold text-stone-950"
      >
        Add
      </button>
      <button onClick={() => { setLabel(''); setAdding(false) }} className="text-muted hover:text-stone-600">
        <X size={14} />
      </button>
    </div>
  )
}

interface EntryData { sizes: string[]; brands: string[]; fields?: CatalogField[] }

/** One collapsible catalog card with Sizes, Brands, and custom field groups. */
function CatalogCard({
  title,
  isOpen,
  onToggle,
  data,
  showSizes,
  onPatch,
  onRemoveItem,
}: {
  title: string
  isOpen: boolean
  onToggle: () => void
  data: EntryData
  showSizes: boolean
  onPatch: (patch: Partial<EntryData>) => void
  onRemoveItem?: () => void
}) {
  const sizes = data.sizes ?? []
  const brands = data.brands ?? []
  const fields = data.fields ?? []

  function addField(label: string) {
    onPatch({ fields: [...fields, { id: fieldUid(), label, values: [] }] })
  }
  function removeField(id: string) {
    onPatch({ fields: fields.filter((f) => f.id !== id) })
  }
  function addValue(id: string, v: string) {
    onPatch({ fields: fields.map((f) => (f.id === id ? { ...f, values: [...f.values, v] } : f)) })
  }
  function removeValue(id: string, v: string) {
    onPatch({ fields: fields.map((f) => (f.id === id ? { ...f, values: f.values.filter((x) => x !== v) } : f)) })
  }

  const summary = [
    showSizes && sizes.length > 0 ? `${sizes.length} size${sizes.length !== 1 ? 's' : ''}` : null,
    brands.length > 0 ? `${brands.length} brand${brands.length !== 1 ? 's' : ''}` : null,
    fields.length > 0 ? `${fields.length} field${fields.length !== 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900">
      <button className="flex w-full items-center justify-between px-4 py-3" onClick={onToggle}>
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-stone-800 dark:text-white">{title}</span>
          <span className="text-xs text-muted">{summary}</span>
        </div>
        {isOpen
          ? <ChevronDown size={16} className="shrink-0 text-muted" />
          : <ChevronRight size={16} className="shrink-0 text-muted" />
        }
      </button>

      {isOpen && (
        <div className="divide-y divide-stone-50 border-t border-stone-100 px-4 dark:divide-white/5 dark:border-white/10">
          {showSizes && (
            <ChipList
              label="Sizes"
              items={sizes}
              placeholder='e.g. 4"'
              onAdd={(v) => onPatch({ sizes: [...sizes, v] })}
              onRemove={(v) => onPatch({ sizes: sizes.filter((s) => s !== v) })}
            />
          )}
          <ChipList
            label="Brands"
            items={brands}
            placeholder="e.g. Dorset"
            onAdd={(v) => onPatch({ brands: [...brands, v] })}
            onRemove={(v) => onPatch({ brands: brands.filter((b) => b !== v) })}
          />
          {fields.map((f) => (
            <ChipList
              key={f.id}
              label={f.label}
              items={f.values}
              placeholder="Add value"
              onAdd={(v) => addValue(f.id, v)}
              onRemove={(v) => removeValue(f.id, v)}
              onDeleteGroup={() => removeField(f.id)}
            />
          ))}
          <AddFieldButton onAdd={addField} />
          {onRemoveItem && (
            <div className="flex justify-end py-2.5">
              <button
                onClick={onRemoveItem}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600"
              >
                <Trash2 size={13} /> Remove item
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Inventory() {
  const { hardwareCatalog, setHardwareCatalog, customCatalog, addCustomEntry, updateCustomEntry, removeCustomEntry } = useStore()
  const navigate = useNavigate()
  const params = useParams<{ tab?: string; openId?: string }>()
  const tab: 'catalog' | 'rates' = params.tab === 'rates' ? 'rates' : 'catalog'
  // The open row is the third path segment. A hardware row is keyed by its
  // category; anything else is a custom entry id, so the two can share a slot.
  const openId = params.openId ?? null
  const isHardware = !!openId && openId in CATEGORY_META
  const openCat = (isHardware ? openId : null) as ProductCategory | null
  const openCustomId = isHardware ? null : openId
  const setTab = (t: 'catalog' | 'rates') => navigate(`/inventory/${t}`)
  const setOpenCat = (cat: ProductCategory | null) =>
    navigate(cat ? `/inventory/${tab}/${cat}` : `/inventory/${tab}`)
  const setOpenCustomId = (id: string | null) =>
    navigate(id ? `/inventory/${tab}/${id}` : `/inventory/${tab}`)
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')

  function patchCat(cat: ProductCategory, patch: Partial<EntryData>) {
    const current = hardwareCatalog[cat] ?? { sizes: [], brands: [] }
    setHardwareCatalog({ ...hardwareCatalog, [cat]: { ...current, ...patch } })
  }

  function addNewItem() {
    const n = newName.trim()
    if (n) addCustomEntry(n)
    setNewName('')
    setAddingNew(false)
  }

  return (
    <div className="min-h-screen">
      {/* Tabs */}
      <div className="sticky top-[var(--mobile-topbar-height)] md:top-0 z-10 flex border-b border-stone-200 bg-stone-50/95 backdrop-blur dark:border-white/10 dark:bg-stone-950/95">
        <button
          onClick={() => setTab('catalog')}
          className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'catalog'
              ? 'border-shiv-green text-stone-900 dark:text-white'
              : 'border-transparent text-muted hover:text-stone-700  dark:hover:text-stone-200'
          }`}
        >
          <Package size={16} /> Hardware
        </button>
        <button
          onClick={() => setTab('rates')}
          className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'rates'
              ? 'border-shiv-green text-stone-900 dark:text-white'
              : 'border-transparent text-muted hover:text-stone-700  dark:hover:text-stone-200'
          }`}
        >
          <IndianRupee size={16} /> Rates
        </button>
      </div>

      {tab === 'rates' && <RateManager basePath="/inventory/rates" />}

      {tab === 'catalog' && (
        <div className="mx-auto max-w-2xl space-y-3 px-4 pb-24 pt-4">
          <p className="text-xs text-muted">
            Manage sizes, brands and custom fields for each item. Changes reflect instantly in bill making.
          </p>

          {/* Built-in categories */}
          {HARDWARE_CATS.map((cat) => (
            <CatalogCard
              key={cat}
              title={CAT_LABEL[cat]}
              isOpen={openCat === cat}
              onToggle={() => setOpenCat(openCat === cat ? null : cat)}
              data={hardwareCatalog[cat] ?? { sizes: [], brands: [] }}
              showSizes={!NO_SIZES[cat]}
              onPatch={(patch) => patchCat(cat, patch)}
            />
          ))}

          {/* Custom items */}
          {customCatalog.map((entry) => (
            <CatalogCard
              key={entry.id}
              title={entry.name}
              isOpen={openCustomId === entry.id}
              onToggle={() => setOpenCustomId(openCustomId === entry.id ? null : entry.id)}
              data={entry}
              showSizes
              onPatch={(patch) => updateCustomEntry(entry.id, patch)}
              onRemoveItem={() => removeCustomEntry(entry.id)}
            />
          ))}

          {/* Add new item */}
          {addingNew ? (
            <div className="flex items-center gap-2 rounded-xl border border-shiv-green bg-white px-4 py-3 dark:bg-stone-900">
              <input
                autoFocus
                type="text"
                placeholder="Item name (e.g. Drawer Channel)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addNewItem()
                  if (e.key === 'Escape') { setNewName(''); setAddingNew(false) }
                }}
                className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted dark:text-white"
              />
              <button
                onClick={addNewItem}
                className="rounded-lg bg-shiv-green px-3 py-1.5 text-xs font-semibold text-stone-950"
              >
                Add
              </button>
              <button onClick={() => { setNewName(''); setAddingNew(false) }} className="text-muted hover:text-stone-600">
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingNew(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 py-3 text-sm font-medium text-muted hover:border-shiv-green hover:text-shiv-green dark:border-white/20"
            >
              <Plus size={16} /> Add Item
            </button>
          )}
        </div>
      )}
    </div>
  )
}
