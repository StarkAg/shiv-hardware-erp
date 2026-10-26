import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AppWindow, DoorClosed, Layers, type LucideIcon } from 'lucide-react'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  GROUP_ORDER,
  type CategoryIcon,
} from '../../lib/types'

const CATEGORY_ICONS: Record<CategoryIcon, LucideIcon> = {
  door: DoorClosed,
  board: Layers,
  window: AppWindow,
}

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
          {GROUP_ORDER.map((group) => {
            const items = CATEGORY_ORDER.filter((category) => CATEGORY_META[category].group === group)
            const span = items.length >= 3 ? 'col-span-3' : items.length === 2 ? 'col-span-2' : 'col-span-1'
            return (
              <section key={group} className={span}>
                <h2 className="mb-2 border-b-2 border-stone-900 pb-0.5 text-sm font-extrabold uppercase tracking-wider text-stone-900 sm:text-base">
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
                        className="flex h-[5.25rem] flex-col justify-between border-2 border-stone-200 bg-white p-2.5 text-stone-900 active:translate-y-0.5 active:border-shiv-green hover:border-stone-900 sm:h-32 sm:p-4"
                      >
                        <Icon size={22} strokeWidth={2.2} className="sm:h-8 sm:w-8" />
                        <span className="line-clamp-2 font-[family-name:var(--sign)] text-[15px] font-bold uppercase leading-[1.05] sm:text-xl">{meta.short}</span>
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
