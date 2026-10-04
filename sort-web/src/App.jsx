/**
 * Sorting the backlog, in the two walks the shop actually does.
 *
 * SHOOT — the paper onto a screen, one press per bill, into a lettered stack.
 * NAME  — photograph to name, slip back on the stack in the same order.
 * PLACE — walk that stack with the phone calling out a bookmark for each slip.
 * LEDGER— who has what, on which bookmark, and every slip in their packet.
 *
 * They are deliberately separate. Naming can be done by anybody, anywhere, in
 * any order; placing needs the paper, the table and both hands. And a slot is
 * held from the moment it is given until that customer's packet is filed, so
 * spending one at naming time would fill the table with customers whose bills
 * are still in the stack.
 */
import { useEffect, useState } from 'react'
import Shoot from './Shoot.jsx'
import Name from './Name.jsx'
import Place from './Place.jsx'
import Ledger from './Ledger.jsx'
import { useOutbox } from './local.js'

// Ledger first: the shop's flow since 2026-10-04 is a bill in the hand, its
// name searched here, and the bookmark read off (or a new customer added) —
// no photograph and no reading. The photo walks stay for the old backlog.
const TABS = [
  { id: 'ledger', label: 'Ledger', icon: 'book' },
  { id: 'shoot', label: 'Shoot', icon: 'camera' },
  { id: 'name', label: 'Name', icon: 'edit' },
  { id: 'place', label: 'Place', icon: 'place' },
]

export default function App() {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem('shiv-sort:tab:v2')
      return TABS.some(t => t.id === saved) ? saved : 'ledger'
    } catch {
      return 'ledger'
    }
  })

  const [working, setWorking] = useState(false)
  // Starts the background sender on every tab, and says when work is still
  // on its way — closing the app then only delays it, never loses it.
  const { pending } = useOutbox()
  const stuck = pending.find((p) => p.tries)
  const [keyboard, setKeyboard] = useState(false)
  useEffect(() => {
    const viewport = window.visualViewport
    const resize = () => {
      if (viewport && viewport.scale !== 1) return
      document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`)
      setKeyboard(window.innerHeight - (viewport?.height ?? window.innerHeight) > 140)
    }
    resize()
    viewport?.addEventListener('resize', resize)
    window.addEventListener('resize', resize)
    return () => {
      viewport?.removeEventListener('resize', resize)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const go = (id) => {
    setTab(id)
    try {
      localStorage.setItem('shiv-sort:tab:v2', id)
    } catch {
      /* remembering the tab is a convenience, not a requirement */
    }
  }

  return (
    <div className={`app app-${tab}`}>
      <header className="bar">
        <div><h1>Shiv Hardware</h1><span className="bar-caption">Bill sorting</span></div>
        <span className="step-label">
          {pending.length > 0 && (
            <em className={`sync${stuck ? ' late' : ''}`} title={stuck?.error}>
              {stuck ? `${pending.length} waiting for signal` : `${pending.length} saving…`}
            </em>
          )}
          {TABS.find(t => t.id === tab)?.label}
        </span>
      </header>

      {tab === 'shoot' ? <Shoot onWorking={setWorking} /> : tab === 'name' ? <Name onNavigate={go} /> : tab === 'place' ? <Place onNavigate={go} /> : <Ledger />}

      <nav className={`tabs${keyboard ? ' keyboard-hidden' : ''}`} aria-label="Bill sorting">
        {TABS.map(t => (
          <button key={t.id} className={`tab${t.id === tab ? ' on' : ''}`}
            disabled={working && t.id !== tab} aria-current={t.id === tab ? 'page' : undefined} onClick={() => go(t.id)}>
            <TabIcon name={t.icon} /><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function TabIcon({ name }) {
  const paths = {
    camera: <><path d="M4 6h4l2-3h4l2 3h4v14H4z" /><circle cx="12" cy="12" r="4" /></>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14zM12 20h9" /></>,
    place: <><path d="M4 4h16v16H4zM4 10h16M10 10v10" /><path d="m13 15 2 2 3-3" /></>,
    book: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15" /></>,
  }
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
