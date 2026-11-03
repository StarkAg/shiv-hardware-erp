import { useEffect, useMemo, useState } from 'react'
import { WorkingDate } from './WorkingDate'
import { noteVisit } from '../lib/trail'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useShortcuts } from '../lib/useShortcuts'
import { isDarkMode, toggleTheme } from '../lib/theme'
import { assetPath } from '../lib/assets'
import {
  ChevronLeft,
  Moon,
  Trash2, MonitorSmartphone,
  Users,
  ReceiptText,
  Sun,
  Wrench,
  type LucideIcon,
  PanelLeft,
  PanelLeftClose,
  BookOpen,
  Wallet,
  LayoutDashboard,
  NotebookPen,
  Scale,
  TrendingUp, HandCoins, Coins, CalendarClock, PackageCheck,
  ReceiptIndianRupee, MessageCircle, PackagePlus, PackageX, BanknoteArrowDown, BanknoteArrowUp, FileText, FileStack, ScrollText, Inbox, ShieldCheck, ClipboardList, Truck } from 'lucide-react'
import { ClaimsBadge } from '../features/guarantee/GuaranteeClaims'
import { UpdateBanner } from './UpdateBanner'
import { Toaster } from './Toast'
import { BUILD_ID, CURRENT_VERSION } from '../lib/appUpdate'

// Guarantee claims (and their menu badge) read the cloud, so they only mount when it is configured.
const CONVEX_READY = Boolean(import.meta.env.VITE_CONVEX_URL)

// The page you are on is solid green; the entries used most are a light
// green, so the everyday ones stand out from the rest of a long menu.
const FREQUENT = 'bg-shiv-green/15 font-semibold text-stone-950 hover:bg-shiv-green/25 dark:bg-shiv-green/15 dark:text-white dark:hover:bg-shiv-green/25'
const PLAIN = 'text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white'

const linkClass = ({ isActive, frequent = false }: { isActive: boolean; frequent?: boolean }) =>
  `-mx-3 flex items-center gap-3 whitespace-nowrap px-6 py-2 text-sm font-medium transition focus-visible:outline-offset-[-2px] ${
    isActive
      ? 'bg-shiv-green text-stone-950 shadow-sm shadow-black/20'
      : frequent ? FREQUENT : PLAIN
  }`

/**
 * Which menu entries are used most, counted on this computer.
 *
 * Every page opened adds one to its entry. Until there have been enough
 * visits to go by, the everyday vouchers and the accounts stand in.
 */
const USE_KEY = 'shiv-panel:nav-use'
const FREQUENT_COUNT = 6
const STARTERS = ['/day', '/bills?new=sale', '/bills?new=purchase', '/bills?new=receipt', '/bills?new=payment', '/ledger']

function readUse(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(USE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function mostUsed(use: Record<string, number>): Set<string> {
  const total = Object.values(use).reduce((t, n) => t + n, 0)
  if (total < 30) return new Set(STARTERS)
  return new Set(
    Object.entries(use)
      .filter(([to]) => to !== '/home')
      .sort((a, b) => b[1] - a[1])
      .slice(0, FREQUENT_COUNT)
      .map(([to]) => to),
  )
}

/** The same, one level in. It was written out by hand six times. */

/**
 * The menu, by the work being done rather than by which of the two apps used
 * to own the screen.
 *
 * It listed "Ledger" and "Ledgers" next to each other — one the party
 * accounts, the other the list of accounts — and "Day Book" apart from both,
 * while the bill scanner, the quote history, the customer list and the print
 * queue had no entry at all and could only be reached by typing the address.
 * Names here say what the thing is to the shop, not what it was called in
 * whichever app it came from.
 */
type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Function key printed beside it, working from anywhere in the panel. */
  key?: string
  /** Paths that light this entry up. Defaults to its own, and anything under it. */
  match?: string[]
  /** …except these, which belong to an entry of their own. */
  except?: string[]
  /** Shows the count of guarantee claims waiting on the shop. */
  badge?: boolean
}

const AREAS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Home',
    items: [{ to: '/home', label: 'Home', icon: LayoutDashboard }],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/ledger', label: 'Party Accounts', icon: BookOpen, except: ['/ledger/trial', '/ledger/monthly', '/ledger/tocome', '/ledger/bills', '/ledger/advances'] },
      { to: '/ledger/monthly', label: 'Salary & Rent', icon: CalendarClock },
      { to: '/ledgers', label: 'Account Masters', icon: Users },
      { to: '/ledger/trial', label: 'Trial Balance', icon: Scale },
      { to: '/profit', label: 'Profit', icon: TrendingUp },
    ],
  },
  {
    label: 'Transactions',
    items: [
      { to: '/paper', label: 'Day Paper', icon: NotebookPen },
      { to: '/day', label: 'Day Book', icon: ReceiptText },
      /**
       * Three families, so a glance tells you what a line is about before you
       * read it: a receipt is a bill, a box is goods, a banknote is money. The
       * pairs that are opposites are the same drawing with the sign reversed —
       * money in and money out are one note with the arrow turned over, goods
       * counted in and goods sent back are one box with a tick or a cross.
       *
       * What this replaced was three visual languages in one column: a bare ₹
       * glyph beside a credit card beside a plain undo arrow, and Sale wearing
       * the very icon Day Book already had.
       */
      { to: '/bills?new=sale', label: 'Sale', icon: ReceiptIndianRupee, key: 'F8' },
      { to: '/bills?new=purchase', label: 'Purchase', icon: PackagePlus, key: 'F9' },
      { to: '/bills?new=receipt', label: 'Receipt', icon: BanknoteArrowDown, key: 'F6' },
      // A card, in a shop that deals in cash, was the odd one out twice over.
      { to: '/bills?new=payment', label: 'Payment', icon: BanknoteArrowUp, key: 'F5' },
      /**
       * Alt on the key of the voucher each one belongs to.
       *
       * F4, F7 and F10 are free in this panel but not in the shop's head —
       * they are Contra, Journal and Other in Tally, and this menu already
       * matches Tally exactly on F5, F6, F8 and F9. Handing a Tally-trained
       * hand F7 for a goods return would be teaching it a second meaning for a
       * key it already knows.
       *
       * So the base key stays the voucher it goes with and Alt says "the goods
       * side of it": a purchase is F9, the goods arriving against it Alt+F9; a
       * sale is F8, goods coming back Alt+F8; a receipt is F6, money handed
       * back Alt+F6. Alt+F4 is never used — on Windows it closes the panel.
       */
      { to: '/bills?new=grn', label: 'Goods Received', icon: PackageCheck, key: 'Alt+F9' },
      { to: '/bills?new=return', label: 'Goods Return', icon: PackageX, key: 'Alt+F8' },
      { to: '/bills?new=refund', label: 'Refund', icon: HandCoins, key: 'Alt+F6' },
      // Money ahead of the goods. Alt of Payment, F5: Alt+F6 is already the
      // refund, and an advance is money moving before any bill, like both.
      { to: '/bills?new=advance', label: 'Advance', icon: Coins, key: 'Alt+F5' },
      // A price given, not a sale: kept with the bills, never in the books.
      // Alt+F10 — F10 is Tally's "Other Vouchers", and a quotation is one.
      { to: '/bills?new=quotation', label: 'Quotation', icon: FileText, key: 'Alt+F10' },
      // The handwritten slip, for the customer: nothing goes in the books.
      { to: '/slip', label: 'Slip', icon: ScrollText },
    ],
  },
  {
    // Kept apart on purpose: the drawer is its own job, not a voucher.
    label: 'Cash',
    items: [{ to: '/cash-review', label: 'Cash', icon: Wallet }],
  },
  {
    // Every running list in one place: what is waiting to be
    // made, quoted, delivered or settled. They were spread across
    // three headings, and Advances sat far enough down to be missed.
    label: 'Lists',
    items: [
      { to: '/work-list', label: 'Work List', icon: ClipboardList },
      { to: '/quotations', label: 'Quotations', icon: FileStack },
      { to: '/ledger/advances', label: 'Advances', icon: Coins },
      { to: '/guarantee/list', label: 'Guarantee List', icon: ShieldCheck },
      { to: '/delivery', label: 'Delivery', icon: Truck },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/bill-flow', label: 'Bill Flow', icon: PackageCheck },
      { to: '/guarantee/claims', label: 'Guarantee Claims', icon: Inbox, badge: true },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/trash', label: 'Trash', icon: Trash2 },
      { to: '/whatsapp', label: 'WhatsApp Bills', icon: MessageCircle },
      { to: '/devices', label: 'Trusted Devices', icon: MonitorSmartphone },
      /*
       * Bill Scanner and Printer Queue are not listed.
       *
       * Both are shop-machine tools that only work with the print server
       * running on the shop's own network, and neither is part of anybody's
       * day. They kept their addresses — /scan and /printer-queue — so the one
       * person who needs them can still get there.
       */
    ],
  },
]

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
  // The goods and refund side of the four above — see the note in AREAS for
  // why these are Alt of their own voucher's key rather than F4, F7 and F10.
  { to: '/bills?new=grn',      label: 'Goods Received', key: 'alt+F9', kind: 'grn' },
  { to: '/bills?new=return',   label: 'Goods Return',   key: 'alt+F8', kind: 'return' },
  { to: '/bills?new=refund',   label: 'Refund',         key: 'alt+F6', kind: 'refund' },
  { to: '/bills?new=advance',  label: 'Advance',        key: 'alt+F5', kind: 'advance' },
  { to: '/bills?new=quotation', label: 'Quotation',     key: 'alt+F10', kind: 'quotation' },
] as const

/**
 * The phone's bar, on the same five areas as the menu. There were six items in
 * a five-column grid, so the sixth dropped onto a row of its own.
 */
const MOBILE_NAV_ITEMS = [
  { to: '/home', label: 'Home', icon: LayoutDashboard, match: ['/home'] },
  { to: '/bill-flow', label: 'Bill Flow', icon: PackageCheck, match: ['/bill-flow'] },
  { to: '/day', label: 'Day Book', icon: ReceiptText, match: ['/day', '/bills', '/cash-review'] },
  { to: '/ledger', label: 'Accounts', icon: BookOpen, match: ['/ledger', '/ledgers'] },
  { to: '/cash-review', label: 'Cash', icon: Wallet, match: ['/cash-review'] },
] as const

/**
 * Which menu entry the current address belongs to.
 *
 * `NavLink` matches on the path alone, and the four voucher entries are all
 * `/bills` with a different query — so opening a sale lit up Day Book, Sale,
 * Purchase, Receipt and Payment at once. The query is the difference here, so
 * it is what this compares.
 */
function isCurrent(item: NavItem, pathname: string, search: string): boolean {
  const [path, query] = item.to.split('?')
  if (query) return pathname === path && search === `?${query}`
  if (item.except?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false
  const paths = item.match ?? [path]
  // A voucher being written is not the day book. They had to share /bills
  // once, and this told them apart by the query; the day book has its own
  // address now, so only the voucher's own path is left to exclude here.
  if (path === '/day' && search.startsWith('?new=')) return false
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

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

  // Nothing to go back from on the screen the panel opens on.
  if (pathname === '/' || pathname === '/home') return null

  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0

  return (
    <div className="back-bar no-print px-3 sm:px-4 md:px-6">
      <button
        onClick={() => (idx > 0 ? navigate(-1) : navigate('/home'))}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <ChevronLeft size={15} /> Back
      </button>
    </div>
  )
}

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  // Where the panel has been, so Back on an account returns there (lib/trail).
  useEffect(() => { noteVisit(location.pathname + location.search) }, [location.pathname, location.search])

  // The keys printed beside the menu, working from anywhere in the panel —
  // the hook allows a function key through even with the cursor in a field.
  useShortcuts(
    Object.fromEntries(VOUCHERS.map((v) => [v.key, () => navigate(v.to)])),
  )
  // Count the entry this page belongs to, for the shading of the most used.
  const [use, setUse] = useState(readUse)
  useEffect(() => {
    const item = AREAS.flatMap((a) => a.items).find((i) => isCurrent(i, location.pathname, location.search))
    if (!item) return
    setUse((prev) => {
      const next = { ...prev, [item.to]: (prev[item.to] ?? 0) + 1 }
      try { localStorage.setItem(USE_KEY, JSON.stringify(next)) } catch { /* private window: not remembered */ }
      return next
    })
  }, [location.pathname, location.search])
  const frequent = useMemo(() => mostUsed(use), [use])
  // Every row runs the full width of the sidebar, square. The most-used rows
  // (and the page you are on) are shaded bands with a thin rule between
  // neighbours, so a run of them reads as one block, not a stack of pills.
  const banded = (item: NavItem) => frequent.has(item.to) || isCurrent(item, location.pathname, location.search)
  const joins = (items: NavItem[], i: number) => {
    return i > 0 && banded(items[i]) && banded(items[i - 1]) ? ' border-t border-stone-300/70 dark:border-white/10' : ''
  }

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


  const sidebar = (
    <>
      <div className={`border-b border-stone-200/80 py-5 dark:border-white/10 ${railed ? "px-2" : "px-5"}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleRail}
            aria-label={railed ? 'Open sidebar' : 'Collapse sidebar'}
            className={`flex shrink-0 items-center justify-center text-muted hover:bg-stone-200/70 hover:text-stone-800 dark:hover:bg-white/10 dark:hover:text-white ${railed ? 'mx-auto h-10 w-10' : 'ml-auto order-last h-8 w-8'}`}
          >
            {railed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <div className={`h-10 w-10 shrink-0 items-center justify-center border border-white/10 bg-white shadow-inner shadow-stone-400/30 ${railed ? 'hidden' : 'flex'}`}>
            <img src={assetPath('assets/letterhead/shiv-logo.png')} alt="" className="h-9 w-9 object-contain" />
          </div>
          <div className={`min-w-0 flex-1 ${railed ? 'hidden' : ''}`}>
            <div className="text-sm font-bold leading-tight tracking-tight text-stone-950 dark:text-white">
              Shiv Hardware Store
            </div>
            <div className="text-xs font-medium text-shiv-green">Panel</div>
          </div>
        </div>
        {!railed && <WorkingDate />}
      </div>

      <nav className={`flex-1 overflow-y-auto py-3 ${railed ? "space-y-1.5 px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>div]:space-y-1.5" : "space-y-1 px-3"}`}>
        {AREAS.map((area) => (
          <div key={area.label} className={area.label === 'Home' ? '' : 'pt-2'}>
            {area.label !== 'Home' && !railed && (
              <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                {area.label}
              </div>
            )}
            {area.label !== 'Home' && railed && <div className="mx-auto mb-2 w-8 border-t border-stone-200/80 dark:border-white/10" />}

            {area.items.map((item, i) => (
              // Collapsed, a row is its icon and nothing else: the name and
              // the F-key squeezed the icon smaller than its neighbours and
              // pushed it off the rail's centre line. Both are in the tooltip.
              railed ? (
                <Link
                  key={item.to}
                  to={item.to}
                  title={item.key ? `${item.label}  ${item.key}` : item.label}
                  aria-label={item.label}
                  className={`relative mx-auto flex h-10 w-10 items-center justify-center transition focus-visible:outline-offset-[-2px] ${
                    isCurrent(item, location.pathname, location.search)
                      ? 'bg-shiv-green text-stone-950 shadow-sm shadow-black/20'
                      : frequent.has(item.to) ? FREQUENT : PLAIN
                  }`}
                >
                  <item.icon size={18} className="shrink-0" />
                  {item.badge && CONVEX_READY && (
                    <span className="absolute -right-1 -top-1 scale-75"><ClaimsBadge /></span>
                  )}
                </Link>
              ) : (
                <Link
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={`${linkClass({ isActive: isCurrent(item, location.pathname, location.search), frequent: frequent.has(item.to) })}${joins(area.items, i)}`}
                >
                  <item.icon size={18} className="shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && CONVEX_READY && <ClaimsBadge />}
                  {item.key && (
                    <span className="text-[11px] font-semibold text-muted">{item.key}</span>
                  )}
                </Link>
              )
            ))}

            {/* Quotations open onto the shop's own product list — the fastest
                way into a quote is picking what it is for. */}
          </div>
        ))}
      </nav>
      <div className={`border-t border-stone-200/80 py-3 dark:border-white/10 space-y-2 ${railed ? "px-2" : "px-3"}`}>
        <button
          onClick={() => setDark(toggleTheme())}
          title={dark ? 'Light mode' : 'Dark mode'}
          className={`flex items-center text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white transition ${
            railed ? 'mx-auto h-10 w-10 justify-center' : 'w-full gap-2 px-3 py-2'
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
            className="flex items-center gap-2 text-xs text-muted transition hover:text-stone-950 dark:hover:text-white"
          >
            <Wrench size={13} />
            By Harsh
          </a>
          <span
            title={BUILD_ID ? `Build ${BUILD_ID}` : undefined}
            className="bg-stone-200/70 px-2 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10"
          >
            v{CURRENT_VERSION}{BUILD_ID && <span className="font-normal"> · {BUILD_ID.split(' · ')[0]}</span>}
          </span>
        </div>
      </div>
    </>
  )

  return (
    <div className="min-h-screen md:flex">
      <UpdateBanner />
      <Toaster />
      <div className="no-print fixed inset-x-0 top-0 z-50 flex items-center border-b border-stone-200/80 bg-stone-50/95 px-3 py-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-stone-950/95 md:hidden" style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))', willChange: 'transform', transform: 'translateZ(0)' }}>
        <div className="flex items-center gap-2">
          <img src={assetPath('assets/letterhead/shiv-logo.png')} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-1" />
          <div>
            <div className="whitespace-nowrap text-sm font-bold leading-tight text-stone-950 dark:text-white">Shiv Hardware Store</div>
            <div className="text-xs font-medium text-shiv-green">Panel</div>
          </div>
        </div>
        {/* The sidebar's theme toggle is desktop-only (hidden md:flex), so the
            phone header carries its own. */}
        <button
          onClick={() => setDark(toggleTheme())}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="ml-auto rounded-lg p-2 text-muted hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white transition"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <aside className={`no-print sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-stone-200/80 bg-stone-50 text-stone-800 shadow-sm shadow-stone-900/5 transition-[width] duration-200 dark:border-white/10 dark:bg-[linear-gradient(180deg,#151515_0%,#24211d_58%,#171514_100%)] dark:text-stone-100 md:flex ${railed ? "w-16" : "w-64"}`}>
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
                  : 'text-muted'
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
