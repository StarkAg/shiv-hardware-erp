// ── The workshop's own panel ────────────────────────────────────────────────
//
// A separate app from the counter's, on its own address, with its own icon on
// the karigar's phone. It shares the counter's data and nothing else: no
// rates, no deltas, no advances, no balances. None of that is any use at a
// cutting table, and a screen that shows what the shop charges is a screen
// somebody will eventually hold up in front of a customer.
//
// Two things per order. What to make — every piece, with its size and a box
// to tick. And what to make it out of — how many 12 ft sections to pull and
// where to cut them.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Materials from './Materials.jsx'
import Rack from './Rack.jsx'
import { Opening, longestSide } from './sketch.jsx'
import { StatusPill, BackBar } from './ui.jsx'
import { FORMS, FILLS, productShort } from './rates.js'
import { fmtSize, sqftOf, inchesOf } from './dims.js'
import {
  readJobs, writeJobs, queue, flush, pendingCount, mergeJobs, fmtDate, todayKey,
} from './store.js'

function daysTo(date) {
  if (!date) return null
  const a = new Date(`${todayKey()}T00:00:00`)
  const b = new Date(`${date}T00:00:00`)
  return Math.round((b - a) / 86400000)
}

function Due({ date }) {
  const d = daysTo(date)
  if (d == null) return <span className="due none">No date</span>
  if (d < 0) return <span className="due late">{-d} day{d === -1 ? '' : 's'} late</span>
  if (d === 0) return <span className="due today">Due today</span>
  if (d === 1) return <span className="due soon">Tomorrow</span>
  return <span className="due">{fmtDate(date)} · {d} days</span>
}

const madeCount = (job) => (job.openings || []).filter((o) => o.made).length

export default function WorkshopApp() {
  const [jobs, setJobs] = useState(() => readJobs())
  const [openId, setOpenId] = useState(null)
  const [tab, setTab] = useState('make')          // make | material
  const [screen, setScreen] = useState('queue')   // queue | rack
  const [sync, setSync] = useState({ busy: false, pending: pendingCount(), error: null })
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('shiv-panel:theme') === 'dark' } catch { return false }
  })

  useEffect(() => { writeJobs(jobs) }, [jobs])

  // The counter writes on its own screen; this picks the change up without
  // anybody reloading. Same device, so it is a storage event; across devices
  // it is the sync below.
  useEffect(() => {
    const onStore = (e) => { if (e.key === 'shiv-orders:jobs') setJobs(readJobs()) }
    window.addEventListener('storage', onStore)
    return () => window.removeEventListener('storage', onStore)
  }, [])

  const runSync = useCallback(async () => {
    setSync((s) => ({ ...s, busy: true }))
    const r = await flush((incoming) => setJobs((local) => mergeJobs(local, incoming)))
    setSync({ busy: false, pending: pendingCount(), error: r.ok ? null : (r.error || r.reason) })
  }, [])

  useEffect(() => {
    runSync()
    const t = setInterval(runSync, 3 * 60 * 1000)
    window.addEventListener('online', runSync)
    return () => { clearInterval(t); window.removeEventListener('online', runSync) }
  }, [runSync])

  const updateJob = useCallback((id, fn) => {
    setJobs((all) => {
      const cur = all.find((j) => j.id === id)
      if (!cur) return all
      const next = { ...fn(cur), updatedAt: Date.now() }
      queue({ t: 'job', ...next, jobId: next.id })
      return all.map((j) => (j.id === id ? next : j))
    })
    setSync((s) => ({ ...s, pending: pendingCount() }))
  }, [])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('shiv-panel:theme', next ? 'dark' : 'light') } catch { /* ignore */ }
  }

  const queueJobs = useMemo(() => jobs
    .filter((j) => !j.deleted && (j.status === 'confirmed' || j.status === 'ordered'))
    .sort((a, b) => {
      const da = a.order?.deliveryDate || '9999-99-99'
      const db = b.order?.deliveryDate || '9999-99-99'
      return da < db ? -1 : da > db ? 1 : 0
    }), [jobs])

  const gone = useMemo(() => jobs
    .filter((j) => !j.deleted && (j.status === 'delivered' || j.status === 'billed'))
    .sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0))
    .slice(0, 10), [jobs])

  const job = openId ? jobs.find((j) => j.id === openId) : null
  const longest = useMemo(() => longestSide(job?.openings || []), [job])

  const rows = useMemo(() => [...(job?.openings || [])].sort((a, b) => {
    const ah = inchesOf(a.h) > inchesOf(a.w) ? 0 : 1
    const bh = inchesOf(b.h) > inchesOf(b.w) ? 0 : 1
    return ah - bh
  }), [job])

  const summary = useMemo(() => {
    const m = new Map()
    for (const o of job?.openings || []) {
      const k = `${o.form}:${o.fill}`
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].map(([k, n]) => {
      const [form, fill] = k.split(':')
      return { k, n, label: productShort(form, fill) }
    })
  }, [job])

  const header = (
    <header className="top">
      <div className="brandrow">
        <img className="logo" src="/logo.png" alt="Shiv Hardware" />
        <div>
          <div className="brand">Workshop</div>
          <div className="sub">Shiv Hardware</div>
        </div>
      </div>
      <div className="headbtns">
        <button
          className={`themebtn syncbtn ${sync.busy ? 'busy' : sync.pending ? 'pending' : sync.error ? 'off' : 'ok'}`}
          onClick={runSync}
          title={sync.error ? `Not syncing — ${sync.error}` : 'Saved online'}
          aria-label="Sync"
        >
          ☁{sync.pending > 0 && <span className="syncdot">{sync.pending > 99 ? '99+' : sync.pending}</span>}
        </button>
        <button
          className={`themebtn ${screen === 'rack' ? 'on' : ''}`}
          onClick={() => { setOpenId(null); setScreen(screen === 'rack' ? 'queue' : 'rack') }}
          aria-label="Rack" title="Offcut rack"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h12M3 18h7" />
          </svg>
        </button>
        <button className="themebtn" onClick={toggleTheme} aria-label="Theme">{dark ? '☀' : '☾'}</button>
      </div>
    </header>
  )

  // ── One order ─────────────────────────────────────────────────────────
  if (job) {
    const openings = job.openings || []
    const made = madeCount(job)
    const all = openings.length
    const allMade = all > 0 && made === all

    const toggle = (id) => updateJob(job.id, (cur) => ({
      ...cur,
      openings: (cur.openings || []).map((o) => (
        o.id === id ? { ...o, made: !o.made, madeAt: o.made ? null : Date.now() } : o
      )),
    }))

    return (
      <div className="wrap workshop">
        {header}
        <div className="card">
          <BackBar
            onBack={() => { setOpenId(null); setTab('make') }}
            title={<># {job.number} · {job.customer?.name || ''}</>}
            right={<Due date={job.order?.deliveryDate} />}
          />

          <div className="stagebar two">
            <button className={`stagestep ${tab === 'make' ? 'on' : ''}`} onClick={() => setTab('make')}>
              What to make
            </button>
            <button className={`stagestep ${tab === 'material' ? 'on' : ''}`} onClick={() => setTab('material')}>
              What to cut
            </button>
          </div>

          {tab === 'make' ? (
            <>
              <div className="wsbar">
                <div className="wsprog">
                  <div className="wsfill" style={{ width: `${all ? (made / all) * 100 : 0}%` }} />
                </div>
                <span className="wscount">{made} of {all} made</span>
              </div>

              <div className="block">
                <div className="blocktitle">On this order</div>
                <div className="wssum">
                  {summary.map((s) => <span className="wschip" key={s.k}>{s.n} × {s.label}</span>)}
                </div>
              </div>

              <div className="wslist">
                {rows.map((o, i) => (
                  <button
                    key={o.id}
                    className={`wsrow ${o.made ? 'made' : ''}`}
                    onClick={() => toggle(o.id)}
                  >
                    <span className="wstick" aria-hidden="true">{o.made ? '✓' : ''}</span>
                    <span className="wsn">{i + 1}</span>
                    <span className="wsdraw"><Opening o={o} n={null} longest={longest} /></span>
                    <span className="wsmeta">
                      <b className="wssize">{fmtSize(o.w, o.h)}</b>
                      <span className="wswhat">
                        {FORMS[o.form]?.label} · {FILLS[o.fill]?.label}
                        {(o.leaves ?? 1) >= 2 ? ' · 2 leaves' : ''}
                      </span>
                      {o.note && <span className="wsnote">{o.note}</span>}
                      <span className="wssqft">{sqftOf(o.w, o.h).toFixed(2)} sqft</span>
                    </span>
                  </button>
                ))}
              </div>

              {allMade && (
                <div className="wsdone">
                  Everything on this order is made. The counter can hand it over.
                </div>
              )}
            </>
          ) : (
            <Materials
              job={job}
              onRecorded={() => updateJob(job.id, (cur) => ({ ...cur, cutRunAt: Date.now() }))}
            />
          )}
        </div>
      </div>
    )
  }

  // ── The rack ──────────────────────────────────────────────────────────
  if (screen === 'rack') {
    return (
      <div className="wrap workshop">
        {header}
        <div className="card">
          <BackBar onBack={() => setScreen('queue')} title="Offcut rack" />
          <Rack />
        </div>
      </div>
    )
  }

  // ── The queue ─────────────────────────────────────────────────────────
  return (
    <div className="wrap workshop">
      {header}
      <div className="card">
        {queueJobs.length === 0 && (
          <div className="empty">
            Nothing to make. Orders appear here once the counter has confirmed
            the measurements.
          </div>
        )}

        <div className="joblist">
          {queueJobs.map((j) => {
            const all = (j.openings || []).length
            const made = madeCount(j)
            return (
              <button className="jobcard ws" key={j.id} onClick={() => { setOpenId(j.id); setTab('make') }}>
                <div className="jcturn">
                  <span className="jcnum">#{j.number}</span>
                  <Due date={j.order?.deliveryDate} />
                </div>
                <div className="jcname">{j.customer?.name || 'No name'}</div>
                <div className="wsbar tight">
                  <div className="wsprog">
                    <div className="wsfill" style={{ width: `${all ? (made / all) * 100 : 0}%` }} />
                  </div>
                  <span className="wscount">{made}/{all}</span>
                </div>
              </button>
            )
          })}
        </div>

        {gone.length > 0 && (
          <div className="block">
            <div className="blocktitle">Gone out</div>
            <div className="wsgone">
              {gone.map((j) => (
                <div className="wsgonerow" key={j.id}>
                  <span>#{j.number} · {j.customer?.name}</span>
                  <StatusPill status={j.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
