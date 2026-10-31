import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { cameFrom, pageName } from '../../lib/trail'
// The ledger app is plain JSX, ported across as-is (allowJs).
import LedgerApp from './LedgerApp.jsx'
import './ledger.css'
import { useLedgerTheme } from './useLedgerTheme'

/**
 * The ledger app, running inside the panel.
 *
 * Its own source, not a rewrite — the components, the voucher forms, the day
 * book, all of it. Two things make it safe to host here:
 *
 *  - its stylesheet is scoped under .ledger-root, so the global selectors it
 *    relies on (`:root` tokens, `* { scrollbar-width: none }`) apply to this
 *    subtree instead of the whole panel
 *  - it reads the same Convex deployment as everything else, so the books it
 *    shows are the books the bills post into
 */
/** The tabs Party Accounts covers; Trial Balance and the rest have their own links. */
const PARTY_TABS = ['all', 'customers', 'suppliers']
const KEPT = 'shiv-panel:ledger-open'
// Kept for this window only, and a private window may refuse it.
function keepOpen(path: string) {
  try { sessionStorage.setItem(KEPT, path) } catch { /* not kept; the list opens instead */ }
}
function openKept() {
  try { return sessionStorage.getItem(KEPT) } catch { return null }
}

export function Ledger() {
  const dark = useLedgerTheme()

  // Every tab and every account gets its own address: /ledger/customers,
  // /ledger/customers/<id>. Replace rather than push, so moving between tabs
  // doesn't bury the rest of the panel under a stack of back steps.
  const { tab, partyId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // `?new=sale` opens that voucher form — how the sidebar's Vouchers menu and
  // the phone's home-screen shortcuts both get in. Cleared once it has opened,
  // so a refresh or a back step doesn't pop the form up again.
  const [params, setParams] = useSearchParams()

  // The ledger's own day book was the same vouchers in the same table, one tab
  // deep. It is the panel's Day Book now, so old links go there.
  useEffect(() => {
    if (tab === 'daybook') navigate('/day', { replace: true })
  }, [tab, navigate])
  const onRoute = useCallback((nextTab: string, nextParty: string | null) => {
    const path = `/ledger/${nextTab}${nextParty ? `/${nextParty}` : ''}`
    if (PARTY_TABS.includes(nextTab)) keepOpen(path)
    if (path !== window.location.hash.replace(/^#/, '')) navigate(path, { replace: true })
  }, [navigate])

  // Party Accounts in the sidebar is the bare /ledger: it comes back to the
  // account that was open, so a look at Home or a bill does not lose it. A link
  // to a tab or an account still lands where it says, and Back closes it.
  const kept = !tab && !partyId && !params.toString() ? openKept() : null
  useEffect(() => {
    if (kept) navigate(kept, { replace: true })
  }, [kept, navigate])
  const newVoucher = params.get('new')
  const consumeNew = useCallback(() => {
    setParams({}, { replace: true })
  }, [setParams])

  /**
   * "+ Sale" and "+ Receipt" on an account open the voucher screen the rest of
   * the panel writes on, with the account already filled in — not the ledger's
   * own cut-down form in a modal. One voucher screen, wherever it is reached
   * from, which is the same rule the function keys already follow.
   */
  const openVoucher = useCallback((kind: string, party?: string, extra?: { grn?: string }) => {
    const query = new URLSearchParams({
      new: kind,
      ...(party ? { party } : {}),
      // "Enter bill" on a delivery: the purchase is written against it.
      ...(extra?.grn ? { grn: extra.grn } : {}),
    })
    navigate(`/bills?${query}`)
  }, [navigate])

  // Not drawn on the way back: it would open on its first tab and write that
  // over what was kept.
  if (kept) return null

  // An open account goes Back to the page it was opened from — Advances, the
  // Day Book — rather than always to the list of its side.
  const from = partyId ? cameFrom(location.pathname + location.search) : null
  const back = from ? { label: pageName(from), go: () => navigate(from) } : null

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <LedgerApp
        back={back}
        route={{ tab, partyId }}
        onRoute={onRoute}
        newVoucher={newVoucher}
        onConsumeNew={consumeNew}
        onOpenVoucher={openVoucher}
      />
    </div>
  )
}
