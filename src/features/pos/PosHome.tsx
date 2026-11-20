import { Link } from 'react-router-dom'
import { ReceiptIndianRupee } from 'lucide-react'
import { ClaimsBadge } from '../guarantee/GuaranteeClaims'
import { ALL_ROWS, NAV, type NavItem } from '../../components/counterNav'

/**
 * The Android app's first screen: every Counter page as a big tile, like the
 * keys of a counter machine. One tap opens a page; the Home bar at its foot
 * (CounterLayout) comes back here.
 *
 * In the Signs look (DESIGN.md): the three jobs done for a waiting customer —
 * a quotation, a guarantee card, a slip — are blue, because blue is "do this".
 * The rest are quiet white keys in their groups, ruled in black.
 */

const MAKE = ['/quote-options', '/guarantee/card', '/slip']
const makeTiles = MAKE.map((to) => ALL_ROWS.find((item) => item.to === to)!).filter(Boolean)

// Claims (and their badge) read the cloud, so the badge only mounts when it is configured.
const convexReady = Boolean(import.meta.env.VITE_CONVEX_URL)

function Badge({ item }: { item: NavItem }) {
  return 'badge' in item && item.badge && convexReady ? <ClaimsBadge /> : null
}

export function PosHome() {
  return (
    <div className="mobile-panel-screen flex flex-col overflow-y-auto bg-white">
      <header className="border-b-4 border-stone-900 px-4 pb-3 pt-4">
        <p className="font-[family-name:var(--sign)] text-3xl font-extrabold uppercase leading-none tracking-wide text-stone-900">
          Shiv Hardware
        </p>
        <p className="mt-1 font-[family-name:var(--sign)] text-lg font-bold uppercase leading-none tracking-[0.18em] text-muted">
          Counter
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2 p-3">
        {/* The sale bill: the PC's own bill form, saving to the same books (counter.tsx). */}
        <Link
          to="/bills?new=sale"
          style={{ touchAction: 'manipulation' }}
          className="col-span-3 flex min-h-[7rem] items-center justify-center gap-4 bg-shiv-green text-white active:translate-y-0.5"
        >
          <ReceiptIndianRupee size={48} strokeWidth={2.4} />
          <span className="font-[family-name:var(--sign)] text-4xl font-extrabold uppercase leading-none tracking-wide">Bill</span>
        </Link>
        {makeTiles.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            style={{ touchAction: 'manipulation' }}
            className="flex aspect-square flex-col items-center justify-center gap-2 bg-shiv-green text-white active:translate-y-0.5"
          >
            <item.icon size={40} strokeWidth={2.4} />
            <span className="font-[family-name:var(--sign)] text-xl font-extrabold uppercase leading-none tracking-wide">{item.label}</span>
          </Link>
        ))}
      </div>

      {NAV.map((area) => {
        const rest = area.items.filter((item) => !MAKE.includes(item.to))
        if (!rest.length) return null
        return (
          <section key={area.label} className="px-3 pb-3">
            <h2 className="border-b-2 border-stone-900 pb-1 text-sm font-bold uppercase tracking-[0.14em] text-muted">
              {area.label}
            </h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {rest.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{ touchAction: 'manipulation', boxShadow: 'inset 0 -4px 0 #c9cfd5' }}
                  className="relative flex min-h-[5.5rem] items-center gap-3 border-2 border-stone-900 bg-white px-3 text-stone-900 active:translate-y-0.5"
                >
                  <item.icon size={28} strokeWidth={2.4} className="shrink-0" />
                  <span className="flex-1 font-[family-name:var(--sign)] text-xl font-bold uppercase leading-tight">{item.label}</span>
                  <Badge item={item} />
                </Link>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
