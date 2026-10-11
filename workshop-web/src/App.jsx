import { useEffect, useRef, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { APP_NAME, SIDE } from './side.js'
import { savePhotos } from './offline.js'
import { api, newIn } from './flow.js'
import { outbox } from './outbox.js'
import JobList from './JobList.jsx'
import JobPage from './JobPage.jsx'
import NewOrder from './NewOrder.jsx'

/**
 * Shiv Workshop and Shiv Workshop Counter: a job from the visit order to the
 * fitting, in photos.
 *
 * Two apps from this one build (src/side.js says which). The counter
 * photographs a visit order and sends it; the workshop, Gopal and Bandhu,
 * measures and photographs the figures; the counter attaches the work order;
 * the workshop assembles, counting the pieces, and presses Complete; the
 * counter rings the customer and gives the go-ahead; the workshop fits it.
 * No item list, no money and nothing typed as free text: the paper says it.
 *
 * Two screens: the jobs as cards (JobList), and one job as a page built
 * around its steps (JobPage). The steps and their words are in flow.js, what
 * is sent goes through the outbox (outbox.js), and the rules are the books'
 * (convex/workshop.ts). Everything is a live read, so nothing needs
 * refreshing; every photo is also saved on the phone (offline.js).
 */

// The last list is kept on the phone, so the app opens on it at once.
const KEY = `workshop:${SIDE}:jobs`
const kept = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') ?? undefined } catch { return undefined } }
const keep = (jobs) => { try { localStorage.setItem(KEY, JSON.stringify(jobs)) } catch { /* storage full: it just opens cold */ } }

/**
 * Saves every photo to the phone, in the background, each time the list
 * arrives or changes. Returns how far it has got: { step, done, total }.
 */
function useSavePhotos(jobs) {
  const [progress, setProgress] = useState(null)
  const state = useRef({ running: false, again: false, jobs: null })
  useEffect(() => {
    if (!jobs) return
    const s = state.current
    s.jobs = jobs
    // One run at a time: a list that changes mid-run starts another after it.
    if (s.running) { s.again = true; return }
    s.running = true
    void (async () => {
      do {
        s.again = false
        try { await savePhotos({ jobs: s.jobs, onProgress: setProgress }) } catch { /* a phone that keeps nothing still shows everything live */ }
      } while (s.again)
      s.running = false
    })()
  }, [jobs])
  return progress
}

export default function App() {
  const convex = useConvex()
  useEffect(() => { outbox.convex = convex }, [convex])
  const live = useQuery(api.workshop.list, {})
  const saving = useSavePhotos(live)
  const [cached] = useState(kept)
  useEffect(() => { if (live) keep(live) }, [live])
  const jobs = live ?? cached
  const [openId, setOpenId] = useState(null)
  const [making, setMaking] = useState(false)
  const open = openId ? jobs?.find((j) => j.id === openId) : null

  // The phone's Back closes a job's page. A photo or the camera open over the
  // page is closed first (JobPage, Camera), and the page stays.
  useEffect(() => {
    const onPop = (e) => { if (!e.state?.job) setOpenId(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const openJob = (id) => { window.history.pushState({ job: id }, ''); setOpenId(id) }
  // A job removed while its page is open: back to the list.
  useEffect(() => { if (openId && live && !live.some((j) => j.id === openId)) window.history.back() }, [openId, live])

  // What is new, on the app's own tab or task-switcher title.
  const fresh = (jobs ?? []).reduce((t, j) => t + newIn(j), 0)
  useEffect(() => { document.title = `${fresh ? `(${fresh}) ` : ''}Shiv ${APP_NAME}` }, [fresh])

  if (open) return <JobPage key={open.id} job={open} onBack={() => window.history.back()} />
  return (
    <>
      <JobList jobs={jobs} onOpen={openJob} onNew={() => setMaking(true)} saving={saving} />
      {making && <NewOrder onClose={() => setMaking(false)} />}
    </>
  )
}
