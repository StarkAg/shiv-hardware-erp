import { useCallback, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
export function Ledger() {
  const dark = useLedgerTheme()

  // Every tab and every account gets its own address: /ledger/customers,
  // /ledger/customers/<id>. Replace rather than push, so moving between tabs
  // doesn't bury the rest of the panel under a stack of back steps.
  const { tab, partyId } = useParams()
  const navigate = useNavigate()

  // The ledger's own day book was the same vouchers in the same table, one tab
  // deep. It is the panel's Day Book now, so old links go there.
  useEffect(() => {
    if (tab === 'daybook') navigate('/bills', { replace: true })
  }, [tab, navigate])
  const onRoute = useCallback((nextTab: string, nextParty: string | null) => {
    const path = `/ledger/${nextTab}${nextParty ? `/${nextParty}` : ''}`
    if (path !== window.location.hash.replace(/^#/, '')) navigate(path, { replace: true })
  }, [navigate])

  // `?new=sale` opens that voucher form — how the sidebar's Vouchers menu and
  // the phone's home-screen shortcuts both get in. Cleared once it has opened,
  // so a refresh or a back step doesn't pop the form up again.
  const [params, setParams] = useSearchParams()
  const newVoucher = params.get('new')
  const consumeNew = useCallback(() => {
    setParams({}, { replace: true })
  }, [setParams])

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <LedgerApp
        route={{ tab, partyId }}
        onRoute={onRoute}
        newVoucher={newVoucher}
        onConsumeNew={consumeNew}
      />
    </div>
  )
}
