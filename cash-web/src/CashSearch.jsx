import { useMemo, useState } from 'react'
import { searchTransactions } from './search.js'

const money = (amount) => `₹${Number(amount).toLocaleString('en-IN')}`

export default function CashSearch({ store, onPick }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('all')
  const [limit, setLimit] = useState(100)
  const entries = useMemo(() => Object.values(store).flat(), [store])
  const results = useMemo(() => searchTransactions(entries, query, mode), [entries, query, mode])
  return (
    <section className="cash-search" aria-labelledby="cash-search-title">
      <div className="search-heading">
        <h2 id="cash-search-title">Search transactions</h2>
      </div>
      <input autoFocus type="search" value={query} aria-label="Search all transactions"
        placeholder="Name, amount, date or note…"
        onChange={(event) => { setQuery(event.target.value); setLimit(100) }} />
      <div className="search-filters" role="group" aria-label="Payment mode">
        {['all', 'cash', 'online'].map((value) => <button key={value} aria-pressed={mode === value}
          onClick={() => { setMode(value); setLimit(100) }}>{value === 'all' ? 'All modes' : value === 'cash' ? 'Cash' : 'Online'}</button>)}
      </div>
      <p className="search-summary" role="status">{results.length} transaction{results.length === 1 ? '' : 's'} · all dates</p>
      <div className="search-results">
        {!results.length && <p>No transactions found. Try a name, amount or another date.</p>}
        {results.slice(0, limit).map((entry) => (
          <button className="search-result" key={entry.id} onClick={() => onPick(entry)}>
            <span><strong>{entry.name || 'No note'}</strong><small>{entry.date} · {entry.mode} · {entry.kind === 'in' ? 'Received' : 'Paid'}{entry.dealer ? ' · Dealer' : ''}</small></span>
            <b>{entry.kind === 'in' ? '+' : '−'}{money(entry.amount)}</b>
          </button>
        ))}
        {results.length > limit && <button className="search-more" onClick={() => setLimit((value) => value + 100)}>Show more transactions</button>}
      </div>
    </section>
  )
}
