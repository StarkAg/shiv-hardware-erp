import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AppWindow, DoorClosed, Layers, type LucideIcon } from 'lucide-react'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  GROUP_ORDER,
  type CategoryIcon,
  type ProductCategory,
} from '../../lib/types'

const CATEGORY_ICONS: Record<CategoryIcon, LucideIcon> = {
  door: DoorClosed,
  board: Layers,
  window: AppWindow,
}

/**
 * Quoted most often, most first: the top row, ruled in blue so they are found
 * first. From the saved quotations (1 Nov 2026: 30, 14, 10, 7; the next has 2),
 * then Bed Inner Ply, new that day, at the owner's ask.
 */
const TOP_ROW: ProductCategory[] = ['readymade-door', 'flush-door', 'block-board-19', 'aluminium-door', 'bed-inner-ply']

/**
 * A product's other name, on its own tile. Flush door and plain ply are one
 * thing (its quotation already reads "Flush Door (Plain Door)"), so the tile
 * says both. Owner's ask, 2 Nov 2026.
 */
const ALSO_AS: Partial<Record<ProductCategory, string>> = { 'flush-door': 'Plain Ply' }

const SECTIONS = [
  { name: 'Most Quoted', items: TOP_ROW },
  ...GROUP_ORDER.map((group) => ({
    name: group,
    items: CATEGORY_ORDER.filter((category) => CATEGORY_META[category].group === group && !TOP_ROW.includes(category)),
  })),
].filter((section) => section.items.length > 0)

/**
 * What to quote for: every product, grouped, on one screen.
 *
 * The groups flow into a three-column grid, each as wide as it has products
 * (up to the full row), packed densely — so the one-product groups share a
 * row instead of each leaving two empty columns. Small, even tiles keep the
 * whole list in view on a phone; a phone too short for it scrolls the list
 * rather than cutting the last ones off.
 *
 * Signs (DESIGN.md): a group is found by its heading, ruled off in black, not
 * by a colour of its own — colour on the counter only ever means do, done,
 * wait or delete.
 */
export function QuotationOptions() {
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [])

  return (
    <div className="mobile-panel-screen overflow-hidden">
      <div className="h-full overflow-y-auto overscroll-contain px-3 pb-3 pt-4 sm:p-6">
        <div className="grid grid-flow-row-dense grid-cols-3 gap-x-2 gap-y-4 sm:gap-x-4 sm:gap-y-6">
          {SECTIONS.map(({ name, items }) => {
            const span = items.length >= 3 ? 'col-span-3' : items.length === 2 ? 'col-span-2' : 'col-span-1'
            return (
              <section key={name} className={span}>
                <h2 className="mb-2 border-b-2 border-stone-900 pb-0.5 text-sm font-extrabold uppercase tracking-wider text-stone-900 sm:text-base">
                  {name}
                </h2>
                <div className={`grid gap-2 sm:gap-4 ${items === TOP_ROW ? 'grid-cols-3 sm:grid-cols-5' : span === 'col-span-3' ? 'grid-cols-3' : span === 'col-span-2' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {items.map((category) => {
                    const meta = CATEGORY_META[category]
                    const Icon = CATEGORY_ICONS[meta.icon]
                    const short = ALSO_AS[category] ? `${meta.short} / ${ALSO_AS[category]}` : meta.short
                    return (
                      <Link
                        key={category}
                        to={`/product/${category}`}
                        className={`flex h-[5.25rem] flex-col justify-between border-2 p-2.5 text-stone-900 active:translate-y-0.5 active:border-shiv-green sm:h-32 sm:p-4 ${
                          TOP_ROW.includes(category)
                            ? 'border-shiv-green bg-shiv-green/10 hover:bg-shiv-green/20'
                            : 'border-stone-200 bg-white hover:border-stone-900'
                        }`}
                      >
                        <Icon size={22} strokeWidth={2.2} className="sm:h-8 sm:w-8" />
                        <span className="line-clamp-2 font-[family-name:var(--sign)] text-[15px] font-bold uppercase leading-[1.05] sm:text-xl">{short}</span>
                      </Link>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
