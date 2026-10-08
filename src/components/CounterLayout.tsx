import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  CarTaxiFront, FileText, History, IndianRupee, Inbox, Moon, Package, ShieldCheck, Sun,
} from 'lucide-react'
import { ClaimsBadge } from '../features/guarantee/GuaranteeClaims'
import { isDarkMode, toggleTheme } from '../lib/theme'
import { Toaster } from './Toast'

/**
 * The counter's own shell.
 *
 * Quotations, guarantee cards, rates and the toto are one job — done facing a
 * customer, usually while they wait — and they touched the books in exactly one
 * place: a confirmation dialog. So they are their own site, and this is a
 * deliberately smaller shell than the panel's: no function keys, no voucher
 * shortcuts, no day book. Nothing here writes to an account.
 *
 * It is a second entry point of the same project rather than a separate app, so
 * every screen and helper is the one file the panel already uses. A copied
 * codebase drifts — the sorting site reimplemented name matching within a week
 * of being split off, and this is how that is avoided.
 */

const NAV = [
  {
    label: 'Quotations',
    items: [
      { to: '/quote-options', label: 'Quote', icon: FileText },
    ],
  },
  {
    label: 'Guarantee',
    items: [
      { to: '/guarantee/card', label: 'Card', icon: ShieldCheck },
      { to: '/guarantee/history', label: 'History', icon: History },
      { to: '/guarantee/claims', label: 'Claims', icon: Inbox, badge: true },
    ],
  },
  {
    label: 'Shop',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/rates', label: 'Rates', icon: IndianRupee },
      { to: '/transport', label: 'Toto', icon: CarTaxiFront },
    ],
  },
]

/** Which entry the address belongs to, so a deep link still lights its row. */
const owns = (to: string, pathname: string) => {
  if (to === '/quote-options') return /^\/(quote|product)/.test(pathname)
  if (to === '/history') return pathname.startsWith('/history')
  return pathname.startsWith(to)
}

// Claims (and their badge) read the cloud, so they only mount when it is configured.
const convexReady = Boolean(import.meta.env.VITE_CONVEX_URL)

export function CounterLayout() {
  const { pathname } = useLocation()
  const [dark, setDark] = useState(isDarkMode)

  const rows = NAV.flatMap((area) => area.items)
  // Keep the page in use visible in the bottom bar, wherever it scrolled to.
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('[data-on]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [pathname])

  // Installed on an iPhone, the page itself never needs to scroll: each screen
  // scrolls inside its own box. But when the keyboard closes, iOS can leave the
  // whole page shifted up, which opens a gap between a screen's bottom buttons
  // (Generate / Print) and the tab bar. Put it back whenever that happens.
  useEffect(() => {
    const settle = () => {
      const typing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')
      const keyboardUp = (window.visualViewport?.height ?? window.innerHeight) < window.innerHeight - 120
      if (typing || keyboardUp) return                                    // moving between fields: leave iOS alone
      const page = document.scrollingElement ?? document.documentElement
      if (window.scrollY > 0 && page.scrollHeight <= window.innerHeight + 2) window.scrollTo(0, 0)
    }
    const later = () => window.setTimeout(settle, 60)
    window.visualViewport?.addEventListener('resize', later)
    window.addEventListener('focusout', later)
    window.addEventListener('orientationchange', later)
    return () => {
      window.visualViewport?.removeEventListener('resize', later)
      window.removeEventListener('focusout', later)
      window.removeEventListener('orientationchange', later)
    }
  }, [])

  return (
    // The counter has no top bar on a phone, only the bottom tabs: the screen
    // heights shared with the panel must not hold back the panel's 57px bar,
    // just the phone's own status bar when installed full screen.
    <div
      className="flex min-h-screen bg-stone-100 dark:bg-stone-950"
      style={{ '--mobile-topbar-height': 'env(safe-area-inset-top, 0px)' } as CSSProperties}
    >
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-stone-200/80 bg-stone-50 dark:border-white/10 dark:bg-stone-900 md:flex">
        <div className="flex items-center gap-3 border-b border-stone-200/80 px-5 py-5 dark:border-white/10">
          <img src="./counter/icon.svg" alt="" className="h-10 w-10 shrink-0 rounded-xl shadow-sm" />
          <div>
            <p className="text-sm font-bold leading-tight text-stone-950 dark:text-stone-50">
              Shiv Hardware
            </p>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Counter</p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV.map((area) => (
            <div key={area.label}>
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                {area.label}
              </p>
              {area.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    owns(item.to, pathname)
                      ? 'bg-shiv-green text-stone-950'
                      : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10'
                  }`}
                >
                  <item.icon size={18} />
                  <span className="flex-1">{item.label}</span>
                  {'badge' in item && item.badge && convexReady && <ClaimsBadge />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <button
          onClick={() => setDark(toggleTheme())}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="m-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
          {dark ? 'Light' : 'Dark'}
        </button>
      </aside>

      <main className="min-w-0 flex-1 pt-[env(safe-area-inset-top,0px)] pb-20 md:pb-0 md:pt-0">
        <Outlet />
      </main>

      {/* Every row across the bottom on a phone, four in view and the rest a
          swipe away; the page in use is scrolled into view. */}
      <nav
        ref={bar}
        className="no-print fixed inset-x-0 bottom-0 z-40 flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain border-t border-stone-200/90 bg-stone-50/95 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-lg [scrollbar-width:none] dark:border-white/10 dark:bg-stone-950/95 md:hidden [&::-webkit-scrollbar]:hidden"
      >
        {rows.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            aria-label={item.label}
            data-on={owns(item.to, pathname) ? '1' : undefined}
            style={{ touchAction: 'manipulation' }}
            className={`flex min-h-[3.5rem] w-[calc((100vw-1.25rem)/4)] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-[9px] font-semibold leading-tight ${
              owns(item.to, pathname)
                ? 'bg-shiv-green/20 text-stone-950 dark:text-shiv-green'
                : 'text-muted'
            }`}
          >
            <item.icon size={19} />
            <span className="text-center">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <Toaster />
    </div>
  )
}
