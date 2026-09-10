import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useShortcuts } from '../lib/useShortcuts'
import { isDarkMode, toggleTheme } from '../lib/theme'
import { assetPath } from '../lib/assets'
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  CreditCard,
  DoorClosed,
  FileText,
  History,
  Layers,
  Moon,
  Package,
  Trash2,
  Users,
  NotebookPen,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sun,
  Wrench,
  type LucideIcon,
  CarTaxiFront,
  PanelLeft,
  PanelLeftClose,
  BookOpen,
} from 'lucide-react'
import { CATEGORY_META, CATEGORY_ORDER, GROUP_ORDER, type CategoryIcon } from '../lib/types'
import { UpdateBanner } from './UpdateBanner'
import { CURRENT_VERSION } from '../lib/appUpdate'

const CATEGORY_ICONS: Record<CategoryIcon, LucideIcon> = {
  door: DoorClosed,
  board: Layers,
  window: AppWindow,
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
    isActive
      ? 'bg-shiv-green text-stone-950 shadow-sm shadow-black/20'
      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white'
  }`

// Each lands on the side of the books its voucher belongs to, so closing the
// form leaves you among the right accounts rather than somewhere unrelated.
// Straight into the bill builder, which writes any of the four and takes the
// bill photograph itself. There was a chooser here — quick entry against the
// full bill format — and once the builder could hold the photo too there was
// nothing left to choose between.
const VOUCHERS = [
  { to: '/bills?new=payment',  label: 'Payment',  key: 'F5', kind: 'payment' },
  { to: '/bills?new=receipt',  label: 'Receipt',  key: 'F6', kind: 'receipt' },
  { to: '/bills?new=sale',     label: 'Sales',    key: 'F8', kind: 'sale' },
  { to: '/bills?new=purchase', label: 'Purchase', key: 'F9', kind: 'purchase' },
] as const

const MOBILE_NAV_ITEMS = [
  { to: '/quote-options', label: 'New Quotation', icon: FileText, match: ['/quote', '/product'] },
  { to: '/guarantee/card', label: 'Guarantee Card', icon: ShieldCheck, match: ['/guarantee'] },
  { to: '/bills', label: 'Day Book', icon: ReceiptText, match: ['/bills'] },
  { to: '/transport', label: 'Toto', icon: CarTaxiFront, match: ['/transport'] },
  { to: '/ledger', label: 'Ledger', icon: BookOpen, match: ['/ledger'] },
  { to: '/inventory', label: 'Inventory', icon: Package, match: ['/inventory', '/rates'] },
] as const

/**
 * One back button for every page, rather than one written into each.
 *
 * `navigate(-1)` alone is not safe here: the panel is opened on deep links —
 * a bill sent to the other counter, a party's ledger from the phone — and
 * there is nothing behind those. React Router keeps an index in the history
 * state, so when this is the first page of the session the button goes to the
 * shop's home screen instead of stepping out of the app.
 */
function BackBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Nothing to go back from on the landing page.
  if (pathname === '/' || pathname === '/quote-options') return null

  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0

  return (
    <div className="back-bar no-print px-3 sm:px-4 md:px-6">
      <button
        onClick={() => (idx > 0 ? navigate(-1) : navigate('/quote-options'))}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <ChevronLeft size={15} /> Back
      </button>
    </div>
  )
}

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  // The keys printed beside the menu, working from anywhere in the panel —
  // the hook allows a function key through even with the cursor in a field.
  useShortcuts(
    Object.fromEntries(VOUCHERS.map((v) => [v.key, () => navigate(v.to)])),
  )
  const [open, setOpen] = useState(
    location.pathname.startsWith('/quote') || location.pathname.startsWith('/product'),
  )
  const [guaranteeOpen, setGuaranteeOpen] = useState(location.pathname.startsWith('/guarantee'))
  // dark: just a re-render trigger — the real source of truth is the DOM class.
  const [dark, setDark] = useState(isDarkMode)
  // Desktop sidebar collapse, remembered so the shop's laptop keeps its choice.
  const [railed, setRailed] = useState(() => {
    try { return localStorage.getItem('shiv-panel:sidebar') === 'closed' } catch { return false }
  })
  const toggleRail = () => {
    setRailed((v) => {
      const next = !v
      try { localStorage.setItem('shiv-panel:sidebar', next ? 'closed' : 'open') } catch { /* ignore */ }
      return next
    })
  }

  useEffect(() => {
    if (location.pathname.startsWith('/quote') || location.pathname.startsWith('/product')) setOpen(true)
    if (location.pathname.startsWith('/guarantee')) setGuaranteeOpen(true)
  }, [location.pathname])

  const sidebar = (
    <>
      <div className={`border-b border-stone-200/80 py-5 dark:border-white/10 ${railed ? "px-2" : "px-5"}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleRail}
            aria-label={railed ? 'Open sidebar' : 'Collapse sidebar'}
            className={`rounded-lg p-1.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-800 dark:hover:bg-white/10 dark:hover:text-white ${railed ? 'mx-auto' : 'ml-auto order-last'}`}
          >
            {railed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <div className={`h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white shadow-inner shadow-stone-400/30 ${railed ? 'hidden' : 'flex'}`}>
            <img src={assetPath('assets/letterhead/shiv-logo.png')} alt="" className="h-9 w-9 object-contain" />
          </div>
          <div className={railed ? 'hidden' : ''}>
            <div className="font-bold leading-tight text-stone-950 dark:text-white">Shiv Hardware Store</div>
            <div className="text-xs font-medium text-shiv-green">Panel</div>
          </div>
        </div>
      </div>

      <nav className={`flex-1 overflow-y-auto py-3 space-y-1 ${railed ? "px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "px-3"}`}>
        {/* New Quotation (expandable) */}
        <div>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <span className="flex items-center gap-3">
              <FileText size={18} /> New Quotation
            </span>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {open && (
            <div className="mt-1 ml-3 space-y-2 border-l border-stone-200 pl-2 py-1 dark:border-white/10">
              <NavLink
                to="/quote"
                end
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium ${
                    isActive
                      ? 'bg-stone-100 text-stone-950 dark:bg-white/10 dark:text-white'
                      : 'text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-white'
                  }`
                }
              >
                <Plus size={14} /> Blank quotation
              </NavLink>

              {GROUP_ORDER.map((g) => (
                <div key={g}>
                  <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    {g}
                  </div>
                  {CATEGORY_ORDER.filter((c) => CATEGORY_META[c].group === g).map((c) => {
                    const Icon = CATEGORY_ICONS[CATEGORY_META[c].icon]
                    return (
                      <NavLink
                        key={c}
                        to={`/product/${c}`}
                        className={({ isActive }) =>
                          `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium ${
                            isActive
                              ? 'bg-shiv-green text-stone-950 shadow-sm shadow-black/20'
                              : 'text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white'
                          }`
                        }
                      >
                        <Icon size={14} />
                        {CATEGORY_META[c].short}
                      </NavLink>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <button
            onClick={() => setGuaranteeOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <span className="flex items-center gap-3">
              <ShieldCheck size={18} /> Guarantee Card
            </span>
            {guaranteeOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {guaranteeOpen && (
            <div className="mt-1 ml-3 space-y-1 border-l border-stone-200 pl-2 py-1 dark:border-white/10">
              <NavLink
                to="/guarantee/card"
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium ${
                    isActive
                      ? 'bg-shiv-green text-stone-950 shadow-sm shadow-black/20'
                      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white'
                  }`
                }
              >
                <CreditCard size={14} />
                Card
              </NavLink>
              <NavLink
                to="/guarantee/a4"
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium ${
                    isActive
                      ? 'bg-shiv-green text-stone-950 shadow-sm shadow-black/20'
                      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white'
                  }`
                }
              >
                <FileText size={14} />
                A4 Sheet
              </NavLink>
              <NavLink
                to="/guarantee/history"
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium ${
                    isActive
                      ? 'bg-shiv-green text-stone-950 shadow-sm shadow-black/20'
                      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white'
                  }`
                }
              >
                <History size={14} />
                History
              </NavLink>
            </div>
          )}
        </div>

        <NavLink to="/transport" className={linkClass}>
          <CarTaxiFront size={18} /> Toto
        </NavLink>

        {/* The shop's own working pages, kept together at the foot of the menu
            and away from the customer-facing quotation and guarantee flow. */}
        <div className={`mt-2 border-t border-stone-200/80 pt-2 space-y-1 dark:border-white/10 ${railed ? '' : '-mx-3 px-3'}`}>
          <NavLink to="/bills" className={linkClass}>
            <ReceiptText size={18} /> Day Book
          </NavLink>

          {/* Vouchers, the way Tally lists them — same names, same F-keys,
              which work from anywhere in the ledger, not just from this menu.
              Always open: four entries are not worth a fold. */}
          <div>
            <div
              className={`flex items-center gap-3 py-2 text-sm font-medium text-stone-600 dark:text-stone-300 ${
                railed ? 'justify-center px-0' : 'px-3'
              }`}
            >
              <NotebookPen size={18} /> {!railed && 'Vouchers'}
            </div>

            {!railed && (
              <div className="ml-3 space-y-0.5 border-l border-stone-200 pl-2 py-1 dark:border-white/10">
                {VOUCHERS.map((v) => (
                  <NavLink
                    key={v.to}
                    to={v.to}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <span className="flex items-center gap-2"><Plus size={13} /> {v.label}</span>
                    <span className="text-[10px] font-semibold text-stone-400 dark:text-stone-600">{v.key}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>

          <NavLink to="/ledger" className={linkClass}>
            <BookOpen size={18} /> Ledger
          </NavLink>
          {/* The accounts themselves, as against the books they hold. */}
          <NavLink to="/ledgers" className={linkClass}>
            <Users size={18} /> Ledgers
          </NavLink>
          <NavLink to="/inventory" className={linkClass}>
            <Package size={18} /> Inventory
          </NavLink>
          <NavLink to="/trash" className={linkClass}>
            <Trash2 size={18} /> Trash
          </NavLink>
        </div>
      </nav>

      <div className={`border-t border-stone-200/80 py-3 dark:border-white/10 space-y-2 ${railed ? "px-2" : "px-3"}`}>
        <button
          onClick={() => setDark(toggleTheme())}
          title={dark ? 'Light mode' : 'Dark mode'}
          className={`flex w-full items-center rounded-lg py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white transition ${
            railed ? 'justify-center px-0' : 'gap-2 px-3'
          }`}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
          {!railed && (dark ? 'Light mode' : 'Dark mode')}
        </button>
        <div className={`items-center justify-between px-3 ${railed ? 'hidden' : 'flex'}`}>
          <a
            href="https://www.linkedin.com/in/harshxagarwal"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-xs text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"
          >
            <Wrench size={13} />
            By Harsh
          </a>
          <span className="rounded-full bg-stone-200/70 px-2 py-0.5 text-[10px] font-semibold text-stone-500 dark:bg-white/10 dark:text-stone-400">
            v{CURRENT_VERSION}
          </span>
        </div>
      </div>
    </>
  )

  return (
    <div className="min-h-screen md:flex">
      <UpdateBanner />
      <div className="no-print fixed inset-x-0 top-0 z-50 flex items-center border-b border-stone-200/80 bg-stone-50/95 px-3 py-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-stone-950/95 md:hidden" style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))', willChange: 'transform', transform: 'translateZ(0)' }}>
        <div className="flex items-center gap-2">
          <img src={assetPath('assets/letterhead/shiv-logo.png')} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-1" />
          <div>
            <div className="text-sm font-bold leading-tight text-stone-950 dark:text-white">Shiv Hardware Store</div>
            <div className="text-xs font-medium text-shiv-green">Panel</div>
          </div>
        </div>
        {/* The sidebar's theme toggle is desktop-only (hidden md:flex), so the
            phone header carries its own. */}
        <button
          onClick={() => setDark(toggleTheme())}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="ml-auto rounded-lg p-2 text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white transition"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <aside className={`no-print sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-stone-200/80 bg-stone-50 text-stone-800 shadow-sm shadow-stone-900/5 transition-[width] duration-200 dark:border-white/10 dark:bg-[linear-gradient(180deg,#151515_0%,#24211d_58%,#171514_100%)] dark:text-stone-100 md:flex ${railed ? "w-16 [&_nav_a]:!mx-auto [&_nav_a]:!w-11 [&_nav_a]:!justify-center [&_nav_a]:!gap-0 [&_nav_a]:!px-0 [&_nav_a]:text-[0px] [&_nav_button]:!mx-auto [&_nav_button]:!w-11 [&_nav_button]:!justify-center [&_nav_button]:!gap-0 [&_nav_button]:!px-0 [&_nav_button]:text-[0px] [&_nav_button>span]:!gap-0 [&_nav>div>button>svg:last-child]:hidden [&_nav_div]:!ml-0 [&_nav_div]:!pl-0 [&_nav_div]:!border-l-0" : "w-64"}`}>
        {sidebar}
      </aside>

      <main className="mobile-main min-w-0 flex-1 bg-transparent">
        <BackBar />
        <div className="page-area">
          <Outlet />
        </div>
      </main>

      <nav
        className="mobile-bottom-nav no-print fixed inset-x-0 z-40 grid grid-cols-5 gap-1 border-t border-stone-200/90 bg-stone-50/95 px-2 pt-1.5 shadow-[0_-4px_18px_rgba(28,25,23,0.12)] backdrop-blur-lg dark:border-white/10 dark:bg-stone-950/95 md:hidden"
        aria-label="Primary navigation"
      >
        {MOBILE_NAV_ITEMS.map(({ to, label, icon: Icon, match }) => {
          const active = match.some((prefix) => location.pathname.startsWith(prefix))
          return (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              title={label}
              className={`flex min-h-[3.75rem] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-1 text-[8px] font-semibold leading-tight select-none
                active:scale-90 active:opacity-70
                ${active
                  ? 'bg-shiv-green/20 text-stone-950 dark:bg-shiv-green/20 dark:text-shiv-green'
                  : 'text-stone-500 dark:text-stone-400'
                }`}
              style={{ transition: 'transform 80ms ease, opacity 80ms ease' }}
            >
              <Icon size={19} strokeWidth={active ? 2.5 : 2} />
              <span className="w-full whitespace-normal text-center">{label}</span>
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
