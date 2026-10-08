import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AppWindow, DoorClosed, Layers, type LucideIcon } from 'lucide-react'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  GROUP_ORDER,
  type CategoryIcon,
  type ProductGroup,
} from '../../lib/types'

const CATEGORY_ICONS: Record<CategoryIcon, LucideIcon> = {
  door: DoorClosed,
  board: Layers,
  window: AppWindow,
}

/** Each group's own colour, so a section is found at a glance. */
const GROUP_TONE: Record<ProductGroup, { chip: string; dot: string }> = {
  Doors: { chip: 'bg-[#b9924b]/15 text-[#8a6a2f] dark:text-[#d9b46e]', dot: 'bg-[#b9924b]' },
  Plywoods: { chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  Aluminium: { chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300', dot: 'bg-slate-500' },
  UPVC: { chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
  WPC: { chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
}

/**
 * What to quote for: every product, grouped, on one screen.
 *
 * The groups flow into a three-column grid, each as wide as it has products
 * (up to the full row), packed densely — so the one-product groups share a
 * row instead of each leaving two empty columns. Small, even tiles keep the
 * whole list in view on a phone; a phone too short for it scrolls the list
 * rather than cutting the last ones off.
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
          {GROUP_ORDER.map((group) => {
            const items = CATEGORY_ORDER.filter((category) => CATEGORY_META[category].group === group)
            const tone = GROUP_TONE[group]
            const span = items.length >= 3 ? 'col-span-3' : items.length === 2 ? 'col-span-2' : 'col-span-1'
            return (
              <section key={group} className={span}>
                <h2 className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-bold uppercase tracking-wider text-muted sm:mb-2 sm:text-xs">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                  {group}
                </h2>
                <div className={`grid gap-2 sm:gap-4 ${span === 'col-span-3' ? 'grid-cols-3' : span === 'col-span-2' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {items.map((category) => {
                    const meta = CATEGORY_META[category]
                    const Icon = CATEGORY_ICONS[meta.icon]
                    return (
                      <Link
                        key={category}
                        to={`/product/${category}`}
                        className="flex h-[5.25rem] flex-col justify-between rounded-2xl border border-stone-200/90 bg-white/90 p-2.5 text-stone-900 shadow-sm shadow-stone-900/5 transition active:scale-[0.97] active:border-shiv-green dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 sm:h-32 sm:p-4"
                      >
                        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone.chip} sm:h-11 sm:w-11 sm:rounded-xl`}>
                          <Icon size={16} className="sm:h-6 sm:w-6" />
                        </span>
                        <span className="line-clamp-2 text-[12.5px] font-semibold leading-[1.15] sm:text-base">{meta.short}</span>
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
