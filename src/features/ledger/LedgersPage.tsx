import { useNavigate, useParams } from 'react-router-dom'
// The ledger app is plain JSX, ported across as-is (allowJs).
import LedgersList from './components/Ledgers.jsx'
import './ledger.css'
import { useLedgerTheme } from './useLedgerTheme'

/**
 * The masters list, on its own page rather than inside the ledger's tabs.
 *
 * It is a different job from reading the books: this is where an account is
 * renamed, given the phone number it was opened without, or removed when it
 * turns out to be a second spelling of someone already there.
 */
export function LedgersPage() {
  const dark = useLedgerTheme()
  const navigate = useNavigate()
  const { tab } = useParams<{ tab?: string }>()

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <LedgersList
          tab={tab ?? 'customers'}
          onTab={(next: string) => navigate(`/ledgers/${next}`, { replace: true })}
          onOpenLedger={(path: string) => navigate(path)}
        />
      </div>
    </div>
  )
}
