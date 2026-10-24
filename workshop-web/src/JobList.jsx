import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { APP_NAME, ICON, SIDE } from './side.js'
import { SMALL } from './offline.js'
import { STAGES, addressOf, api, finished, lineOf, myTurn, nameOf, newIn, stageId, stageNo, stageOf, titleOf, whenOf } from './flow.js'
import { atOnce, deliver, discard, useOutbox } from './outbox.js'
import { AllIcon, CloseIcon, DeleteSheet, FlagIcon, LiveLight, Pieces, PlusIcon, STEP_ICONS, Saving, Shot, StepTracker, TickIcon, TodoIcon, useHold } from './ui.jsx'

/**
 * The jobs, a row each.
 *
 * A row opens with the job's sign: a blue circle with the step's number when
 * the step is this side's to do, a yellow square when it is with the other
 * side, a green tick once it is finished. Then who it is for and where, the
 * five steps as bars, and what is waiting. While a job is being assembled its
 * row carries the pieces made, so the counter reads the progress without
 * opening anything.
 *
 * It opens on To do: the jobs waiting on this side and any with something new
 * from the other, so the list a phone opens on is the work in hand.
 */
export default function JobList({ jobs, onOpen, onNew, saving }) {
  const [q, setQ] = useState('')
  const FILTERS = [
    { id: 'todo', label: 'To do', icon: TodoIcon, test: (j) => myTurn(j) || newIn(j) > 0 },
    { id: 'all', label: 'All', icon: AllIcon, test: () => true },
    ...STAGES.map((st) => ({ id: st.id, label: st.short, full: st.id === 'assemble' ? 'Assemble or order in' : st.label, icon: STEP_ICONS[st.id], test: (j) => !finished(j) && stageId(j) === st.id })),
  ]
  const [filter, setFilter] = useState('todo')
  const showing = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]
  const rows = useMemo(() => (jobs ?? [])
    .filter((j) => showing.test(j))
    .filter((j) => !q.trim() || `${titleOf(j)} ${j.number}`.toLowerCase().includes(q.trim().toLowerCase()))
    // Open priority jobs first, then the latest first.
    .sort((a, b) => Number(!!b.priority && !finished(b)) - Number(!!a.priority && !finished(a)) || b.updatedAt - a.updatedAt), [jobs, q, filter])
  // New orders still on their way: shown at the head of the list from the moment they are sent.
  const sending = useOutbox().filter((item) => !item.jobId)
  const remove = useMutation(api.workshop.remove).withOptimisticUpdate(atOnce.remove)
  // The work order about to be deleted, once a finger has been held on it.
  const [deleting, setDeleting] = useState(null)
  const holdToDelete = useHold(setDeleting)
  const photosIn = (job) => job.messages.reduce((n, m) => n + m.photos.length, 0)

  return (
    <div className="app">
      <header className="top">
        <div className="brandrow">
          <img src={ICON} alt="" />
          <div className="brand">{APP_NAME}</div>
          <LiveLight />
        </div>
        <Saving saving={saving} />
      </header>
      <div className="searchbar">
        <input type="search" placeholder="Search" aria-label="Search the jobs" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="filters" role="group" aria-label="Which jobs to show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`${filter === f.id ? 'on' : ''} ${f.id === 'todo' ? 'todo' : ''}`} aria-pressed={filter === f.id} aria-label={f.full ?? f.label} title={f.full ?? f.label} onClick={() => setFilter(f.id)}>
            <f.icon size={20} />
            <span>{f.label}</span>
            {jobs && jobs.filter(f.test).length > 0 && <b>{jobs.filter(f.test).length}</b>}
          </button>
        ))}
      </div>

      <ul className="jobs">
        {sending.map((item) => (
          <li key={item.id} className={`card outgoing ${item.state}`}>
            <button type="button" className="open" onClick={() => { if (item.state === 'failed') void deliver(item) }}>
              <span className="sign wait"><span className="spin" /></span>
              <span className="body">
                <span className="head"><b>{item.title || 'New work order'}</b></span>
                <small className={item.state === 'failed' ? 'bad' : 'addr'}>
                  {item.state === 'failed' ? `Not sent. Tap to try again. ${item.error}` : `Sending ${item.files.length > 1 ? `${item.files.length} photos` : 'the photo'}`}
                </small>
              </span>
              <span className="thumb"><img src={item.previews[0]} alt="" /></span>
            </button>
            {item.state === 'failed' && <button type="button" className="drop" onClick={() => discard(item)} aria-label="Do not send this order"><CloseIcon size={16} /></button>}
          </li>
        ))}
        {rows.map((job) => {
          const last = job.messages[job.messages.length - 1]
          const first = job.messages.flatMap((m) => m.photos)[0]
          const news = newIn(job)
          const assembling = stageId(job) === 'assemble' && !finished(job) && job.needsAssemble !== false && job.boardsTotal
          return (
            <li key={job.id} className={`card holdable ${myTurn(job) ? 'mine' : ''} ${finished(job) ? 'over' : ''}`} {...holdToDelete(job)}>
              <button type="button" className="open" onClick={() => onOpen(job.id)}>
                <span className={`sign ${finished(job) ? 'done' : myTurn(job) ? 'mine' : 'wait'}`}>{finished(job) ? <TickIcon size={24} strokeWidth="3.2" /> : stageNo(stageId(job)) + 1}</span>
                <span className="body">
                  <span className="head">
                    <b>{nameOf(job)}</b>
                    {job.priority && !finished(job) && <i className="prio" aria-label="Priority"><FlagIcon size={14} strokeWidth="3" /> Priority</i>}
                    <time className={news ? 'new' : ''}>{whenOf(job.updatedAt)}</time>
                  </span>
                  <span className="sub">
                    <small className="addr">{addressOf(job) || (job.title ? `Work order ${job.number}` : 'No customer set')}</small>
                    {news > 0 && <i className="badge">{news}</i>}
                  </span>
                  <StepTracker job={job} mini />
                  <span className="foot">
                    <em className={`chip ${finished(job) ? 'done' : myTurn(job) ? 'mine' : 'idle'}`}>{stageOf(job)}</em>
                    {assembling
                      ? <Pieces made={job.boardsMade} total={job.boardsTotal} />
                      : last && <small className="last">{last.from === SIDE ? 'You: ' : ''}{lineOf(last, job)}</small>}
                  </span>
                </span>
                {first && <span className="thumb"><Shot url={first.url} width={SMALL} alt="" loading="lazy" decoding="async" /></span>}
              </button>
            </li>
          )
        })}
        {!jobs && <li className="empty">Loading</li>}
        {jobs && !rows.length && !sending.length && (
          <li className="empty">
            {q ? 'Nothing by that name.'
              : filter === 'todo' && jobs.length ? 'Nothing is waiting on you. Tap All to see every job.'
              : filter !== 'todo' && filter !== 'all' ? `Nothing at ${showing.full.toLowerCase()}.`
              : SIDE === 'shop' ? 'No work orders yet. Tap New order to send the first.' : 'No work orders yet. A new one from the shop shows here by itself.'}
          </li>
        )}
      </ul>

      {SIDE === 'shop' && (
        <div className="dock"><button type="button" className="key must" onClick={onNew}><PlusIcon size={26} strokeWidth="2.6" /> New order</button></div>
      )}
      {deleting && (
        <DeleteSheet title="Delete this work order?" onClose={() => setDeleting(null)} run={(pin) => remove({ jobId: deleting.id, pin })}>
          {titleOf(deleting)}{photosIn(deleting) ? ` · ${photosIn(deleting)} ${photosIn(deleting) === 1 ? 'photo' : 'photos'}` : ''}
          <br />The whole work order is removed for both sides, for good.
        </DeleteSheet>
      )}
    </div>
  )
}
