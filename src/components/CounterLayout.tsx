import { useEffect, useRef, type CSSProperties } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Calculator, CarTaxiFront, ClipboardList, CreditCard, FileText, History, IndianRupee, Inbox, Package, ScrollText, ShieldCheck, UserPlus,
} from 'lucide-react'
import { ClaimsBadge } from '../features/guarantee/GuaranteeClaims'
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
 *
 * It wears the Signs look (DESIGN.md, src/counter-signs.css): a white menu
 * ruled off in black, the page you are on in black, no dark mode.
 */

const NAV = [
  {
    label: 'Quotations',
    items: [
      { to: '/quote-options', label: 'Quote', icon: FileText },
      { to: '/history', label: 'Quote history', icon: History },
      // The handwritten slip, for the customer: nothing goes in the books.
      { to: '/slip', label: 'Slip', icon: ScrollText },
    ],
  },
  {
    label: 'Guarantee',
    items: [
      { to: '/guarantee/card', label: 'Card', icon: ShieldCheck },
      { to: '/guarantee/backs', label: 'Card backs', icon: CreditCard },
      { to: '/guarantee/list', label: 'To make', icon: ClipboardList },
      { to: '/guarantee/history', label: 'Card history', icon: History },
      { to: '/guarantee/claims', label: 'Claims', icon: Inbox, badge: true },
    ],
  },
  {
    label: 'Shop',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/rates', label: 'Rates', icon: IndianRupee },
      { to: '/aluminium-rates', label: 'Aluminium rates', icon: Calculator },
      { to: '/transport', label: 'Toto', icon: CarTaxiFront },
      { to: '/intro', label: 'Shiv Intro', icon: UserPlus },
    ],
  },
]

// The phone's bottom bar shows four rows before a swipe: Quote, its history,
// Card, and the card history moved up beside it. Slip follows them.
const CARD = '/guarantee/card'
const CARD_HISTORY = '/guarantee/history'
const SLIP = '/slip'
const ALL_ROWS = NAV.flatMap((area) => area.items)
const PHONE_FIRST = ['/quote-options', '/history', CARD, CARD_HISTORY, SLIP]
const PHONE_ROWS = [
  ...PHONE_FIRST.flatMap((to) => ALL_ROWS.filter((item) => item.to === to)),
  ...ALL_ROWS.filter((item) => !PHONE_FIRST.includes(item.to)),
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
    // The counter is one screen high and never scrolls as a page: the screen
    // in use fills what is left above the tab bar (counter-signs.css gives
    // .mobile-panel-screen the whole of <main>) and scrolls inside itself.
    // Worked out from the panel's tab bar instead, it stopped short of the
    // counter's, and an iPhone could slide the page up, leaving a grey band.
    <div
      className="flex h-[100dvh] overflow-hidden bg-stone-100"
      style={{ '--mobile-topbar-height': 'env(safe-area-inset-top, 0px)' } as CSSProperties}
    >
      <aside className="no-print hidden w-56 shrink-0 flex-col border-r-2 border-stone-900 bg-white md:flex">
        <div className="border-b-4 border-stone-900 px-4 py-4">
          <p className="font-[family-name:var(--sign)] text-2xl font-extrabold uppercase leading-none tracking-wide text-stone-900">
            Shiv Hardware
          </p>
          <p className="mt-1 font-[family-name:var(--sign)] text-base font-bold uppercase leading-none tracking-[0.18em] text-muted">Counter</p>
        </div>

        <nav className="flex-1 overflow-y-auto pb-3">
          {NAV.map((area) => (
            <div key={area.label} className="pt-3">
              <p className="px-4 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-muted">
                {area.label}
              </p>
              {area.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`flex min-h-12 items-center gap-3 border-l-[6px] px-3 text-lg font-bold uppercase ${
                    owns(item.to, pathname)
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-transparent text-stone-900 hover:bg-stone-100'
                  }`}
                >
                  <item.icon size={20} strokeWidth={2.4} />
                  <span className="flex-1">{item.label}</span>
                  {'badge' in item && item.badge && convexReady && <ClaimsBadge />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pt-[env(safe-area-inset-top,0px)] md:pt-0">
        <Outlet />
      </main>

      {/* Every row across the bottom on a phone, four in view and the rest a
          swipe away; the page in use is scrolled into view. The tabs run to
          the foot of the screen, over the iPhone's home bar strip, with only
          part of that strip kept clear under their labels: the bar used to sit
          on an empty white band. */}
      <nav
        ref={bar}
        className="no-print flex flex-none snap-x snap-mandatory overflow-x-auto overscroll-x-contain border-t-4 border-stone-900 bg-white [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
      >
        {PHONE_ROWS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            aria-label={item.label}
            data-on={owns(item.to, pathname) ? '1' : undefined}
            style={{ touchAction: 'manipulation' }}
            className={`flex min-h-[3.75rem] w-1/4 shrink-0 snap-start flex-col items-center justify-center gap-1 px-0.5 pb-[calc(env(safe-area-inset-bottom)*0.5)] text-xs font-bold uppercase leading-tight ${
              owns(item.to, pathname)
                ? 'bg-stone-900 text-white'
                : 'text-stone-900'
            }`}
          >
            <item.icon size={22} strokeWidth={2.4} />
            <span className="text-center">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      </div>

      <Toaster />
    </div>
  )
}
