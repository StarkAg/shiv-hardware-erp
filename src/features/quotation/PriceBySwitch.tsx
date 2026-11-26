import { productOf, type PriceMode } from '../../lib/aluCosting'
import { saveAluCosting, useAluCosting } from '../../lib/aluCostingStore'
import type { ProductCategory } from '../../lib/types'

const MODES: { id: PriceMode; label: string }[] = [
  { id: 'costing', label: 'Costing' },
  { id: 'sheet', label: 'Sheet price' },
]

/**
 * How this aluminium product is priced, switched from the quotation's own bar.
 * It is the same setting as on the Aluminium rates screen (one saved copy, sent
 * to every counter), so flipping it here flips it there too.
 */
export function PriceBySwitch({ category }: { category: ProductCategory }) {
  const costing = useAluCosting()
  const product = productOf(category)
  const mode = costing.priceBy[product]
  return (
    <div
      role="group"
      aria-label="Price by"
      className="flex shrink-0 overflow-hidden rounded-lg border border-stone-300 bg-white dark:border-white/15 dark:bg-stone-950"
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={mode === m.id}
          onClick={() => {
            if (mode === m.id) return
            const next = structuredClone(costing)
            next.priceBy[product] = m.id
            saveAluCosting(next)
          }}
          className={`h-11 whitespace-nowrap px-3 text-sm font-semibold ${
            mode === m.id
              ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900'
              : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-white/10'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
