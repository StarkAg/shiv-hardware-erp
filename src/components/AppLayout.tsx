import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  DoorClosed,
  FileText,
  FolderOpen,
  IndianRupee,
  Layers,
  Plus,
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
      : 'text-stone-300 hover:bg-white/10 hover:text-white'
  }`

export function AppLayout() {
  const location = useLocation()
  const [open, setOpen] = useState(
    location.pathname.startsWith('/quote') || location.pathname.startsWith('/product'),
  )

  return (
    <div className="flex min-h-screen">
      <aside className="no-print flex w-64 shrink-0 flex-col bg-[linear-gradient(180deg,#151515_0%,#24211d_58%,#171514_100%)] text-stone-100">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white shadow-inner shadow-stone-400/30">
              <img src="/assets/letterhead/shiv-logo.png" alt="" className="h-9 w-9 object-contain" />
            </div>
            <div>
              <div className="font-bold leading-tight text-white">Shiv Hardware</div>
              <div className="text-xs font-medium text-shiv-green">Panel</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {/* New Quotation (expandable) */}
          <div>
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-stone-300 hover:bg-white/10 hover:text-white"
            >
              <span className="flex items-center gap-3">
                <FileText size={18} /> New Quotation
              </span>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {open && (
              <div className="mt-1 ml-3 border-l border-white/10 pl-2 space-y-2 py-1">
                <NavLink
                  to="/quote"
                  end
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium ${
                      isActive ? 'bg-white/10 text-white' : 'text-stone-400 hover:text-white'
                    }`
                  }
                >
                  <Plus size={14} /> Blank quotation
                </NavLink>

                {GROUP_ORDER.map((g) => (
                  <div key={g}>
                    <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
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
                                : 'text-stone-300 hover:bg-white/10 hover:text-white'
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

        <div className="border-t border-white/10 p-4 text-[11px] text-stone-500">
          <a
            href="https://www.linkedin.com/in/harshxagarwal"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-stone-300 transition hover:text-white"
          >
            <Wrench size={14} />
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
