// ── Work orders ─────────────────────────────────────────────────────────────
// One job, one number, six states. On paper this is three sheets written weeks
// apart — a letterhead estimate, the mechanic's site measurements, the pink
// order pad — and the money moves between them without anybody having to agree
// to it. Here the jump is a screen somebody has to press.
//
// Screens are a stack rather than tabs: a job is a thing you go into and come
// out of, and the state it is in decides which screen opens.

import { useCallback, useEffect, useMemo, useState } from 'react'
import JobList from './JobList.jsx'
import Estimate from './Estimate.jsx'
import Measure from './Measure.jsx'
import Delta from './Delta.jsx'
import WorkOrder from './WorkOrder.jsx'
import RatesScreen from './RatesScreen.jsx'
import { BackBar, StatusPill, Confirm } from './ui.jsx'
import { useHotkeys } from './keys.js'
import { readMaterial, inr, lineTotal, EXTRAS } from './rates.js'
import {
  readJobs, writeJobs, queue, flush, pendingCount, mergeJobs,
  uid, todayKey, postAdvance, nextNumberFromServer,
} from './store.js'
import { CloudIcon, MoonIcon, SunIcon } from './icons.jsx'

const STAGE_FOR = {
  estimate: 'estimate',
  measured: 'delta',
  confirmed: 'order',
  ordered: 'order',
  delivered: 'order',
  billed: 'order',
}

export default function App() {
  const [jobs, setJobs] = useState(() => readJobs())
  const [openId, setOpenId] = useState(null)
  const [stage, setStage] = useState(null)      // overrides the status default
  const [screen, setScreen] = useState('list')  // list | job | rates
  const [sync, setSync] = useState({ busy: false, pending: pendingCount(), at: null, error: null })
  const [material, setMaterial] = useState(() => readMaterial())
  const [confirm, setConfirm] = useState(null)
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('shiv-panel:theme') === 'dark' } catch { return false }
  })

  useEffect(() => { writeJobs(jobs) }, [jobs])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('shiv-panel:theme', next ? 'dark' : 'light') } catch { /* ignore */ }
  }

  const runSync = useCallback(async () => {
    setSync((s) => ({ ...s, busy: true }))
    const r = await flush((incoming) => {
      setJobs((local) => mergeJobs(local, incoming))
    })
    setSync({
      busy: false,
      pending: pendingCount(),
      at: r.ok ? Date.now() : null,
      error: r.ok ? null : (r.error || r.reason),
    })
  }, [])

  // Sync on open, when the network returns, and every few minutes — the same
  // rhythm the cash book keeps.
  useEffect(() => {
    runSync()
    const onOnline = () => runSync()
    window.addEventListener('online', onOnline)
    const t = setInterval(runSync, 3 * 60 * 1000)
    return () => { window.removeEventListener('online', onOnline); clearInterval(t) }
  }, [runSync])

  const job = useMemo(() => jobs.find((j) => j.id === openId) || null, [jobs, openId])

  /** Every write lands here: local first, outbox second, so the two can never
   *  disagree about whether something happened. */
  const saveJob = useCallback((next) => {
    const stamped = { ...next, updatedAt: Date.now() }
    setJobs((all) => {
      const i = all.findIndex((j) => j.id === stamped.id)
      const out = i === -1 ? [stamped, ...all] : all.map((j) => (j.id === stamped.id ? stamped : j))
      return out
    })
    queue({ t: 'job', ...stamped, jobId: stamped.id })
    setSync((s) => ({ ...s, pending: pendingCount() }))
  }, [])

  /**
   * Change one job by a function of its current state.
   *
   * The workshop ticks pieces off one after another, and building the next
   * write from the job this render captured loses whichever tick landed in
   * between. This reads the row at the moment of the write instead.
   */
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

  const newJob = async () => {
    // A number is proposed immediately so the screen is usable offline, and
    // settled against the server when there is signal — a phone that has been
    // out of range must not hand out a number the shop already wrote on a slip.
    const local = String(Math.max(757, ...jobs.map((j) => parseInt(j.number, 10) || 0)) + 1)
    const fresh = {
      id: uid('job'),
      number: local,
      status: 'estimate',
      customer: { name: '', mobile: '', address: '' },
      estimate: { lines: [], total: 0 },
      openings: [],
      order: null,
      variance: null,
      at: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
    }
    saveJob(fresh)
    setOpenId(fresh.id)
    setStage(null)
    setScreen('job')

    const server = await nextNumberFromServer()
    if (server && server !== local) saveJob({ ...fresh, number: server })
  }

  const open = (id) => { setOpenId(id); setStage(null); setScreen('job') }
  const back = () => { setScreen('list'); setOpenId(null); setStage(null) }

  // Escape comes out of whatever is open, so the keyboard can undo a wrong
  // turn without reaching for the ‹ button.
  useHotkeys({
    Escape: { run: () => { if (screen === 'list') return false; back(); return true }, inInputs: true },
  }, !confirm)

  // ── Stage transitions ───────────────────────────────────────────────────
  const sendToMeasure = () => {
    saveJob({ ...job, status: 'estimate', sentToMeasureAt: Date.now() })
    setStage('measure')
  }

  const measurementDone = () => {
    saveJob({ ...job, status: 'measured', measuredAt: Date.now() })
    setStage('delta')
  }

  const accept = (lines, total, variance) => {
    const fare = EXTRAS.find((e) => e.id === 'fare')?.rate || 0
    saveJob({
      ...job,
      status: 'confirmed',
      // The variance is logged, not charged. Twenty of these answer a question
      // nothing else can: whether the nominal size is the right one.
      variance: { ...variance, at: Date.now(), pricedBy: 'nominal' },
      order: {
        lines, fare, total,
        orderDate: todayKey(),
        deliveryDate: job.order?.deliveryDate || '',
        advance: 0,
        balance: total,
      },
    })
    setStage('order')
  }

  const reprice = (lines, total, variance) => {
    const fare = EXTRAS.find((e) => e.id === 'fare')?.rate || 0
    saveJob({
      ...job,
      status: 'confirmed',
      variance: { ...variance, at: Date.now(), pricedBy: 'measured' },
      order: {
        lines, fare, total,
        orderDate: todayKey(),
        deliveryDate: job.order?.deliveryDate || '',
        advance: 0,
        balance: total,
      },
    })
    setStage('order')
  }

  const remeasure = () => {
    saveJob({ ...job, status: 'estimate' })
    setStage('measure')
  }

  const takeAdvance = async (amount) => {
    const total = lineTotal(job.order?.lines) + (job.order?.fare || 0)
    saveJob({
      ...job,
      status: 'ordered',
      order: { ...job.order, advance: amount, total, balance: total - amount },
    })
    return postAdvance({
      jobId: job.id,
      number: job.number,
      date: todayKey(),
      name: job.customer?.name || 'Order',
      amount,
      mode: 'cash',
    })
  }

  const markDelivered = () => setConfirm({
    title: 'Mark delivered?',
    body: `${inr(job.order?.balance || 0)} stays outstanding against ${job.customer?.name || 'this customer'} until it is collected.`,
    confirmLabel: 'Delivered',
    run: () => {
      saveJob({ ...job, status: 'delivered', deliveredAt: Date.now() })
      setConfirm(null)
    },
  })

  const currentStage = stage || (job ? STAGE_FOR[job.status] : null)

  const stageTitle = {
    estimate: 'Estimate',
    measure: 'Measure on site',
    delta: 'Check the change',
    order: 'Work order',
  }[currentStage] || ''

  return (
    <div className={`wrap ${screen}`}>
      <header className="top">
        <div className="brandrow">
          <img className="logo" src="/logo.png" alt="Shiv Hardware" />
          <div>
            <div className="brand">Shiv Hardware</div>
            <div className="sub">Work orders</div>
          </div>
        </div>
        <div className="headbtns">
          <button
            className={`themebtn syncbtn ${sync.busy ? 'busy' : sync.pending ? 'pending' : sync.at ? 'ok' : 'off'}`}
            onClick={runSync}
            title={sync.pending ? `${sync.pending} waiting` : sync.error ? `Offline — ${sync.error}` : 'Saved online'}
            aria-label="Sync"
          >
            <CloudIcon />
            {sync.pending > 0 && <span className="syncdot">{sync.pending > 99 ? '99+' : sync.pending}</span>}
          </button>
          <a
            className="themebtn" href="/workshop.html"
            aria-label="Workshop" title="Open the workshop panel"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4l-2.5 2.5 2.1 2.1 2.5-2.5a4 4 0 0 1-5.1-5.1z" />
            </svg>
          </a>
          <button
            className={`themebtn ${screen === 'rates' ? 'on' : ''}`}
            onClick={() => setScreen(screen === 'rates' ? 'list' : 'rates')}
            aria-label="Rates" title="Rates"
          >₹</button>
          <button className="themebtn" onClick={toggleTheme} aria-label="Theme">{dark ? <SunIcon /> : <MoonIcon />}</button>
        </div>
      </header>

      <div className="card">
        {screen === 'list' && (
          <JobList jobs={jobs} onOpen={open} onNew={newJob} />
        )}

        {screen === 'rates' && (
          <>
            <BackBar onBack={() => setScreen('list')} title="Rates" />
            <RatesScreen onChanged={() => setMaterial(readMaterial())} />
          </>
        )}

        {screen === 'job' && job && (
          <>
            <BackBar
              onBack={back}
              title={<># {job.number} · {stageTitle}</>}
              right={<StatusPill status={job.status} />}
            />

            <div className="stagebar">
              {['estimate', 'measure', 'delta', 'order'].map((s) => (
                <button
                  key={s}
                  className={`stagestep ${currentStage === s ? 'on' : ''}`}
                  onClick={() => setStage(s)}
                  disabled={s === 'delta' && !(job.openings || []).length}
                >
                  {{ estimate: '1 Estimate', measure: '2 Measure', delta: '3 Check', order: '4 Order' }[s]}
                </button>
              ))}
            </div>

            {currentStage === 'estimate' && (
              <Estimate
                job={job} onChange={saveJob}
                onPrint={() => window.print()}
                onSendToMeasure={sendToMeasure}
              />
            )}

            {currentStage === 'measure' && (
              <Measure job={job} onChange={saveJob} onDone={measurementDone} />
            )}

            {currentStage === 'delta' && (
              <Delta
                job={job} material={material}
                onAccept={accept} onReprice={reprice} onRemeasure={remeasure}
              />
            )}

            {currentStage === 'order' && job.order && (
              <WorkOrder
                job={job} onChange={saveJob}
                onPrint={() => window.print()}
                onAdvance={takeAdvance}
                onDelivered={markDelivered}
              />
            )}

            {currentStage === 'order' && !job.order && (
              <div className="empty">
                No order yet — the change has to be checked and accepted first.
              </div>
            )}
          </>
        )}
      </div>

      {confirm && (
        <Confirm
          title={confirm.title} body={confirm.body} confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)} onConfirm={confirm.run}
        />
      )}
    </div>
  )
}
