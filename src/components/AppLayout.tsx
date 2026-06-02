import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { isDarkMode, toggleTheme } from '../lib/theme'
import { assetPath } from '../lib/assets'
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  CreditCard,
  DoorClosed,
  FileText,
  FolderOpen,
  IndianRupee,
  Layers,
  Moon,
  Plus,
  ShieldCheck,
  Sun,
  Wrench,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { CATEGORY_META, CATEGORY_ORDER, GROUP_ORDER, type CategoryIcon } from '../lib/types'

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

export function AppLayout() {
  const location = useLocation()
  const [open, setOpen] = useState(
    location.pathname.startsWith('/quote') || location.pathname.startsWith('/product'),
  )
  const [guaranteeOpen, setGuaranteeOpen] = useState(location.pathname.startsWith('/guarantee'))
  // dark: just a re-render trigger — the real source of truth is the DOM class.
  const [dark, setDark] = useState(isDarkMode)

  return (
    <div className="flex min-h-screen">
      <aside className="no-print flex w-64 shrink-0 flex-col border-r border-stone-200/80 bg-stone-50 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-[linear-gradient(180deg,#151515_0%,#24211d_58%,#171514_100%)] dark:text-stone-100">
        <div className="border-b border-stone-200/80 px-5 py-5 dark:border-white/10">
          <div className="flex items-center gap-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white shadow-inner shadow-stone-400/30">
              <img src={assetPath('assets/letterhead/shiv-logo.png')} alt="" className="h-9 w-9 object-contain" />
            </div>
            <div>
              <div className="font-bold leading-tight text-stone-950 dark:text-white">Shiv Hardware</div>
              <div className="text-xs font-medium text-shiv-green">Panel</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
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
              </div>
            )}
          </div>

          <NavLink to="/history" className={linkClass}>
            <FolderOpen size={18} /> Quote History
          </NavLink>
          <NavLink to="/rates" className={linkClass}>
            <IndianRupee size={18} /> Rate Manager
          </NavLink>
          <NavLink to="/customers" className={linkClass}>
            <Users size={18} /> Customers
          </NavLink>
        </nav>

        <div className="border-t border-stone-200/80 p-3 dark:border-white/10 space-y-2">
          <button
            onClick={() => setDark(toggleTheme())}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white transition"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <a
            href="https://www.linkedin.com/in/harshxagarwal"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-3 text-xs text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"
          >
            <Wrench size={13} />
            By Harsh
          </a>
        </div>
      </aside>

      <main className="min-w-0 flex-1 bg-transparent">
        <Outlet />
      </main>
    </div>
  )
}
