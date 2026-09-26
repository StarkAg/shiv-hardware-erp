// ── Every job, and what it is waiting for ───────────────────────────────────
// The pad's weakness is that it only sorts by the order things were written.
// A job waiting to be measured, one waiting for a customer to agree a number,
// and one due out of the workshop on Saturday all look the same on paper. Here
// the filter is the state, because the state is what anybody is actually
// looking for.

import { useMemo, useState } from 'react'
import { StatusPill } from './ui.jsx'
import { useHotkeys } from './keys.js'
import { inr } from './rates.js'
import { fmtDate } from './store.js'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'estimate', label: 'To measure' },
  { id: 'measured', label: 'To confirm' },
  { id: 'ordered', label: 'In workshop' },
  { id: 'delivered', label: 'Delivered' },
]

const totalOf = (job) => job.order?.total ?? job.estimate?.total ?? 0

export default function JobList({ jobs, onOpen, onNew }) {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return jobs
      .filter((j) => !j.deleted)
      .filter((j) => (filter === 'all' ? true : j.status === filter))
      .filter((j) => !needle
        || String(j.number).includes(needle)
        || (j.customer?.name || '').toLowerCase().includes(needle)
        || (j.customer?.mobile || '').includes(needle))
      .sort((a, b) => (b.at || 0) - (a.at || 0))
  }, [jobs, filter, q])

  const counts = useMemo(() => {
    const c = {}
    for (const j of jobs) if (!j.deleted) c[j.status] = (c[j.status] || 0) + 1
    return c
  }, [jobs])

  // The search box holds the keyboard, because finding a job with a customer
  // on the phone is the common thing. So Enter reads the box rather than
  // needing a second key: with something typed it opens what the search found,
  // and on an empty box it starts a new job. Escape clears.
  useHotkeys({
    Enter: {
      run: () => {
        if (!q.trim()) { onNew(); return true }
        if (!shown.length) return false
        onOpen(shown[0].id)
        return true
      },
      inInputs: true,
    },
    Escape: { run: () => { if (!q) return false; setQ(''); return true }, inInputs: true },
  })

  return (
    <>
      <input
        className="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Order number, name or mobile — or ⏎ for a new job" autoFocus
      />

      <div className="chips scroll">
        {FILTERS.map((f) => (
          <button
            key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id !== 'all' && counts[f.id] ? <em>{counts[f.id]}</em> : null}
          </button>
        ))}
      </div>

      <div className="joblist">
        {shown.length === 0 && (
          <div className="empty">
            {jobs.length === 0
              ? 'No jobs yet. Start one when a customer asks for a price.'
              : 'Nothing here.'}
          </div>
        )}

        {shown.map((j) => (
          <button className="jobcard" key={j.id} onClick={() => onOpen(j.id)}>
            <div className="jcturn">
              <span className="jcnum">#{j.number}</span>
              <StatusPill status={j.status} />
            </div>
            <div className="jcname">{j.customer?.name || 'No name'}</div>
            <div className="jcfoot">
              <span>{j.customer?.mobile || ''}</span>
              <b>{inr(totalOf(j))}</b>
            </div>
            {j.order?.deliveryDate && j.status === 'ordered' && (
              <div className="jcdue">Due {fmtDate(j.order.deliveryDate)}</div>
            )}
            {j.status === 'measured' && (
              <div className="jcdue warn">Waiting for the customer to agree the new figure</div>
            )}
          </button>
        ))}
      </div>

      <button className="fab" onClick={onNew} aria-label="New job (n)" title="New job — n">+</button>
    </>
  )
}
