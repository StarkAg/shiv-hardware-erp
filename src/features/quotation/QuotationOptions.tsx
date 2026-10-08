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
      <div className="flex h-full flex-col overflow-hidden p-2 sm:p-4 md:p-6">
        {/* Every product, three to a row on a phone, so the whole list is one
            look; on a phone too short for it the list scrolls rather than
            cutting the last ones off. */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain sm:space-y-4">
          {GROUP_ORDER.map((group) => (
          <section key={group} className="min-h-0">
            <h2 className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wider text-muted sm:mb-2 sm:text-xs">
              {group}
            </h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {CATEGORY_ORDER.filter((category) => CATEGORY_META[category].group === group).map((category) => {
                const meta = CATEGORY_META[category]
                const Icon = CATEGORY_ICONS[meta.icon]
                return (
                  <Link
                    key={category}
                    to={`/product/${category}`}
                    className="flex h-[clamp(4.5rem,9.5dvh,5.75rem)] flex-col justify-between rounded-xl border border-stone-200/90 bg-stone-50 p-2.5 text-stone-800 shadow-sm shadow-stone-900/5 transition active:scale-[0.98] active:border-shiv-green dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 sm:h-32 sm:p-4"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-shiv-green/20 text-shiv-green sm:h-12 sm:w-12 sm:rounded-xl">
                      <Icon size={16} className="sm:h-6 sm:w-6" />
                    </span>
                    <span className="mt-1.5 text-[12px] font-bold leading-tight sm:mt-3 sm:text-base">{meta.short}</span>
                  </Link>
                )
              })}
            </div>
          </section>
          ))}
        </div>
      </div>
    </div>
  )
}
