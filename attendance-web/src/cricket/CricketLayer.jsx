/**
 * The live part of the cricket theme: the ground behind the app, the ticker, the
 * match on the Play screen, and everything that answers a touch. It only listens
 * (cricket/bus.js) and draws. It never marks, locks or saves anything.
 *
 * Every effect ignores touches, so the next row can be tapped mid-animation, and
 * a new mark cancels the last one's animation instead of queueing behind it.
 */
import { useEffect, useRef, useState } from 'react'
import { byRuns, dayScore, IDLE_LINES, MOMENTS, monthScores, sixRun, tickerLines } from './score.js'
import { play, wakeSound } from './sound.js'
import { Film, FILM_SEEN_KEY } from './Film.jsx'
import { Replay } from './Replay.jsx'
import { Settings } from './Panels.jsx'
import { Sprite } from './Sprite.jsx'
import ballPng from './art/ball.png'
import bailPng from './art/bail.png'
import stumpsPng from './art/stumps.png'
import stumpsHitPng from './art/stumps-hit.png'
import groundPng from './art/ground.png'

const FOUND_KEY = 'shiv-attendance:ck-found'
const PREFS_KEY = 'shiv-attendance:ck-prefs'
const REPLAY_SEEN_KEY = 'shiv-attendance:ck-replay-seen'
const AWAY_MS = 30000
const REST = { batter: 'stance', bowler: 'mark', umpire: 'still', hit: false }
const STAMP_MS = 900

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
}
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}
const stillPhone = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const buzz = (pattern) => { try { navigator.vibrate?.(pattern) } catch { /* ignore */ } }

/** A little burst of square pixels where the finger landed. */
function burst(root, x, y, colours, count = 12, spread = 70) {
  if (!root) return
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i')
    p.className = 'ck-bit'
    p.style.left = `${x}px`
    p.style.top = `${y}px`
    p.style.background = colours[i % colours.length]
    root.appendChild(p)
    const a = Math.random() * Math.PI * 2
    const r = spread * (0.5 + Math.random() * 0.6)
    p.animate(
      [
        { transform: 'translate(0, 0)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r + 26}px)`, opacity: 0 },
      ],
      { duration: 420 + Math.random() * 240, easing: 'cubic-bezier(.15,.7,.3,1)' },
    ).onfinish = () => p.remove()
  }
}

export function CricketLayer({ staff, statusFor, cursor, todayKey, mode, loading, freshTick, todaySaved, onRefresh }) {
  const [prefs, setPrefs] = useState(() => ({ effects: !stillPhone(), sounds: true, ...readJson(PREFS_KEY, {}) }))
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const changePrefs = (patch) => setPrefs((p) => { const n = { ...p, ...patch }; writeJson(PREFS_KEY, n); return n })
  const sfx = (name, at) => { if (prefsRef.current.sounds) play(name, at) }

  // A phone only lets sound start from a finished tap, so every tap asks again.
  useEffect(() => {
    const wake = () => { if (prefsRef.current.sounds) wakeSound() }
    const events = ['touchend', 'click', 'keydown']
    events.forEach((e) => document.addEventListener(e, wake, true))
    return () => events.forEach((e) => document.removeEventListener(e, wake, true))
  }, [])
  const fxOn = () => prefsRef.current.effects

  const [scene, setScene] = useState(REST)
  const [stamp, setStamp] = useState(null)
  const [overlay, setOverlay] = useState(null) // rain | dusk | flash
  const [striker, setStriker] = useState('')
  const [bubble, setBubble] = useState('')
  const [hop, setHop] = useState(false)
  const [wipe, setWipe] = useState(0)
  const [toast, setToast] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [found, setFound] = useState(() => readJson(FOUND_KEY, []))
  const [film, setFilm] = useState(() => !stillPhone() && !readJson(FILM_SEEN_KEY, false))
  const [pull, setPull] = useState(0)
  const [replay, setReplay] = useState(null)

  const fxRoot = useRef(null)
  const stage = useRef(null)
  const ballEl = useRef(null)
  const batterEl = useRef(null)
  const bowlerEl = useRef(null)
  const bailA = useRef(null)
  const bailB = useRef(null)
  const timers = useRef([])
  const lastTap = useRef({ x: window.innerWidth / 2, y: 180 })
  const lastEvent = useRef(Date.now())
  const sixes = useRef({ n: 0, at: 0 })

  const at = (ms, fn) => timers.current.push(setTimeout(fn, ms))
  const clearAll = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setOverlay(null)
    setHop(false)
    for (const el of [ballEl.current, batterEl.current, bowlerEl.current, bailA.current, bailB.current]) {
      el?.getAnimations().forEach((a) => a.cancel())
    }
    if (ballEl.current) ballEl.current.style.opacity = 0
  }
  useEffect(() => () => clearAll(), [])

  const showStamp = (word, sub, kind) => {
    const { y } = lastTap.current
    const top = Math.max(70, Math.min(window.innerHeight - 240, y - 118))
    setStamp({ id: Date.now(), word, sub, kind, top })
    at(STAMP_MS, () => setStamp(null))
  }
  const crowdHop = (ms = 900) => { setHop(true); at(ms, () => setHop(false)) }
  const shakeCard = () => {
    document.querySelector('.ck .card')?.animate(
      [0, -5, 5, -3, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 260 },
    )
  }
  const tell = (id) => {
    setFound((prev) => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      writeJson(FOUND_KEY, next)
      const m = MOMENTS.find((x) => x.id === id)
      setToast({ name: m.name, n: next.length })
      setTimeout(() => setToast(null), 1900)
      setTimeout(() => sfx('found'), 500)
      return next
    })
  }

  // Where the ball starts and arrives on the strip. Null when the strip is not showing.
  const places = () => {
    const box = stage.current?.getBoundingClientRect()
    if (!box || !batterEl.current || !bowlerEl.current) return null
    const bt = batterEl.current.getBoundingClientRect()
    const bw = bowlerEl.current.getBoundingClientRect()
    return {
      w: box.width,
      from: { x: bw.left - box.left + 26, y: bw.top - box.top + 22 },
      bat: { x: bt.left - box.left + 72, y: bt.top - box.top + 58 },
      stumps: { x: bt.left - box.left + 6, y: bt.top - box.top + 64 },
    }
  }
  const moveBall = (keys, duration, easing = 'linear') => {
    const el = ballEl.current
    if (!el) return
    el.style.opacity = 1
    const a = el.animate(keys.map((k) => ({ transform: `translate(${k.x}px, ${k.y}px) rotate(${k.r || 0}deg)` })), { duration, easing, fill: 'forwards' })
    a.onfinish = () => { el.style.opacity = 0 }
  }
  const deliver = (toward) => {
    const p = places()
    if (!p) return null
    moveBall([p.from, { x: (p.from.x + toward.x) / 2, y: toward.y + 14 }, toward], 170)
    return p
  }

  const playFour = () => {
    setScene({ ...REST, batter: 'lift', bowler: 'throw' })
    at(90, () => setScene((s) => ({ ...s, bowler: 'after' })))
    const p = places()
    if (p) deliver(p.bat)
    sfx('crack', 0.17)
    sfx('crowd', 0.25)
    at(170, () => {
      setScene((s) => ({ ...s, batter: 'drive' }))
      if (p) moveBall([p.bat, { x: p.w * 0.7, y: 6, r: 360 }, { x: p.w + 20, y: 40, r: 720 }], 520, 'ease-out')
    })
    at(320, () => setScene((s) => ({ ...s, batter: 'follow', umpire: 'fourA' })))
    at(520, () => setScene((s) => ({ ...s, umpire: 'fourB' })))
    at(720, () => setScene((s) => ({ ...s, umpire: 'fourA' })))
    at(920, () => setScene((s) => ({ ...s, umpire: 'fourB' })))
    crowdHop()
    at(1150, () => setScene(REST))
  }
  const playTwo = () => {
    setScene({ ...REST, batter: 'lift', bowler: 'throw' })
    at(90, () => setScene((s) => ({ ...s, bowler: 'after' })))
    const p = places()
    if (p) deliver(p.bat)
    sfx('crack', 0.17)
    sfx('run', 0.3)
    at(170, () => {
      setScene((s) => ({ ...s, batter: 'runA' }))
      batterEl.current?.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(46px)' }, { transform: 'translateX(0)' }],
        { duration: 640, easing: 'steps(8)' },
      )
    })
    ;[280, 440, 600, 760].forEach((ms, i) => at(ms, () => setScene((s) => ({ ...s, batter: i % 2 ? 'runA' : 'runB' }))))
    at(840, () => setScene(REST))
  }
  const playOut = () => {
    setScene({ ...REST, batter: 'lift', bowler: 'throw' })
    at(90, () => setScene((s) => ({ ...s, bowler: 'after' })))
    const p = places()
    if (p) deliver(p.stumps)
    sfx('stumps', 0.17)
    sfx('groan', 0.3)
    at(170, () => {
      setScene((s) => ({ ...s, hit: true, batter: 'stance', bowler: 'appeal' }))
      for (const [el, dx] of [[bailA.current, -30], [bailB.current, 26]]) {
        el?.animate(
          [
            { transform: 'translate(0, 0) rotate(0)', opacity: 1 },
            { transform: `translate(${dx}px, -34px) rotate(300deg)`, opacity: 1, offset: 0.5 },
            { transform: `translate(${dx * 1.5}px, 16px) rotate(640deg)`, opacity: 0 },
          ],
          { duration: 620, easing: 'ease-out', fill: 'forwards' },
        )
      }
      setOverlay('flash')
      at(190, () => setOverlay(null))
      shakeCard()
    })
    at(420, () => {
      setScene((s) => ({ ...s, umpire: 'out', batter: 'walk' }))
      batterEl.current?.animate(
        [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-74px)', opacity: 0 }],
        { duration: 700, easing: 'steps(9)', fill: 'forwards' },
      )
    })
    at(1280, () => {
      for (const el of [batterEl.current, bailA.current, bailB.current]) el?.getAnimations().forEach((a) => a.cancel())
      setScene(REST)
    })
  }
  const playSix = () => {
    setScene({ ...REST, batter: 'lift' })
    sfx('crack', 0.08)
    sfx('crowd', 0.2)
    const p = places()
    at(90, () => {
      setScene((s) => ({ ...s, batter: 'pull', umpire: 'six' }))
      if (p) moveBall([p.bat, { x: p.w * 0.6, y: -20, r: 500 }, { x: p.w * 0.86, y: 18, r: 900 }], 620, 'ease-out')
    })
    at(300, () => setScene((s) => ({ ...s, batter: 'cheer' })))
    crowdHop()
    at(1100, () => setScene(REST))
  }

  const markedOn = useRef(null)
  markedOn.current = { statusFor, cursor }

  useEffect(() => {
    const onTap = (e) => { lastTap.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('pointerdown', onTap, { passive: true })
    return () => window.removeEventListener('pointerdown', onTap)
  }, [])

  useEffect(() => {
    const onEvent = (e) => {
      const ev = e.detail
      lastEvent.current = Date.now()
      setBubble('')
      if (ev.type === 'settings') { setSettingsOpen(true); sfx('tick'); return }
      const fx = fxOn()
      const { x, y } = lastTap.current
      if (ev.type === 'tab') {
        if (!fx) return
        sfx('whoosh')
        setWipe((n) => n + 1)
        return
      }
      clearAll()
      setScene(REST)
      if (ev.type === 'mark') {
        setStriker(ev.name || '')
        const run = ev.status === 'P' ? sixRun(markedOn.current.statusFor, ev.name, markedOn.current.cursor) : 0
        if (run) {
          tell('six')
          if (fx) {
            buzz([18, 30, 18])
            burst(fxRoot.current, x, y, ['#ffcc00', '#5fe39a', '#ffffff', '#6fb4ff'], 24, 110)
            showStamp('SIX!', `${ev.name}: ${run} days in a row`, 'six')
            sfx('crowd', 0.45)
            playSix()
          } else sfx('crack')
        } else if (ev.status === 'P') {
          tell('cover')
          if (fx) { buzz(18); burst(fxRoot.current, x, y, ['#ffcc00', '#5fe39a', '#ffffff']); showStamp('FOUR!', `${ev.name}: present`, 'four'); playFour() } else sfx('crack')
        } else if (ev.status === 'H') {
          tell('two')
          if (fx) { buzz(12); burst(fxRoot.current, x, y, ['#ffcc00', '#ffffff'], 8, 50); showStamp('TWO RUNS', `${ev.name}: half day`, 'two'); playTwo() } else sfx('crack')
        } else if (ev.status === 'N') {
          tell('bowled')
          if (fx) { buzz([24, 40, 24]); burst(fxRoot.current, x, y, ['#ff5a62', '#ebd7aa'], 14, 80); showStamp('OUT', `${ev.name}: absent`, 'out'); playOut() } else sfx('stumps')
        } else {
          sfx('tick')
        }
      } else if (ev.type === 'allin') {
        tell('allin')
        if (!fx) { sfx('crowd'); return }
        buzz([16, 30, 16, 30, 16])
        setStriker('')
        showStamp('ALL IN', 'Whole team present', 'four')
        sfx('crowd'); sfx('crack', 0.05); sfx('crack', 0.3); sfx('crowd', 0.5)
        setScene({ ...REST, batter: 'cheer', umpire: 'six', bowler: 'appeal' })
        crowdHop(1300)
        for (let i = 0; i < 6; i++) {
          at(i * 170, () => burst(
            fxRoot.current,
            window.innerWidth * (0.15 + Math.random() * 0.7),
            70 + Math.random() * 130,
            ['#ffcc00', '#5fe39a', '#ffffff', '#6fb4ff'], 18, 90,
          ))
        }
        at(1400, () => setScene(REST))
      } else if (ev.type === 'rain') {
        tell('rain')
        if (!fx) return
        buzz(40)
        sfx('rain')
        showStamp('RAIN STOPS PLAY', 'Shop closed', 'rain')
        setOverlay('rain')
        at(1700, () => setOverlay(null))
      } else if (ev.type === 'stumps') {
        tell('stumps')
        if (!fx) { sfx('whistle'); return }
        buzz([20, 60, 20])
        sfx('whistle')
        sfx('crowd', 0.25)
        showStamp('STUMPS', 'Day saved and locked', 'stumps')
        setScene({ ...REST, umpire: 'wide', batter: 'walk', bowler: 'mark' })
        setOverlay('dusk')
        at(1600, () => { setOverlay(null); setScene(REST) })
      } else if (ev.type === 'overturned') {
        tell('third')
        if (!fx) return
        sfx('whistle')
        showStamp('REVIEW OPEN', 'This day can be changed', 'two')
      } else if (ev.type === 'notout') {
        if (!fx) return
        sfx('groan')
      }
    }
    window.addEventListener('shiv-cricket', onEvent)
    return () => window.removeEventListener('shiv-cricket', onEvent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Quiet for a while on the Play screen: the umpire says something true.
  const dayNow = dayScore(staff, statusFor, cursor)
  const filmRef = useRef(film)
  filmRef.current = film
  const yetRef = useRef(dayNow.yet)
  yetRef.current = dayNow.yet
  useEffect(() => {
    if (mode !== 'day') return undefined
    const t = setInterval(() => {
      if (Date.now() - lastEvent.current < 14000 || filmRef.current) return
      lastEvent.current = Date.now()
      const yet = yetRef.current
      const line = yet.length > 0 && Math.random() < 0.6
        ? `${yet[0]} has not come out to bat yet`
        : IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)]
      setBubble(line)
      setTimeout(() => setBubble(''), 3800)
    }, 3000)
    return () => clearInterval(t)
  }, [mode])

  // Pull the page down from the very top: the batter winds up; let go and it is hit.
  const pullRef = useRef(0)

  // Today's play. Each opening of the app looks once, on marks fresh from Convex
  // rather than the cache, and plays when the day is done and this phone has not
  // seen these exact marks. A half marked day waits, so nobody gets it mid-marking.
  const todayPlays = () => staff.map((name) => {
    const status = statusFor(new Date(), name)
    return { name, status, run: status === 'P' ? sixRun(statusFor, name, new Date()) : 0 }
  })
  const lookForReplay = useRef(true)
  const onCurrentMonth = cursor.getFullYear() === new Date().getFullYear() && cursor.getMonth() === new Date().getMonth()
  const onCurrentMonthRef = useRef(onCurrentMonth)
  onCurrentMonthRef.current = onCurrentMonth
  useEffect(() => {
    if (!lookForReplay.current || freshTick === 0 || staff.length === 0) return
    lookForReplay.current = false
    if (!prefsRef.current.effects || !onCurrentMonth) return
    const plays = todayPlays()
    if (!plays.some((p) => p.status === 'P' || p.status === 'H' || p.status === 'N')) return
    if (!todaySaved && plays.some((p) => !p.status)) return
    const marks = `${keyOf(new Date())}|${plays.map((p) => `${p.name}:${p.status}`).join(',')}`
    if (readJson(REPLAY_SEEN_KEY, '') === marks) return
    writeJson(REPLAY_SEEN_KEY, marks)
    setReplay(plays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshTick, staff.length])
  useEffect(() => {
    let hiddenAt = 0
    const onShow = () => {
      if (document.hidden) { hiddenAt = Date.now(); return }
      if (hiddenAt && Date.now() - hiddenAt > AWAY_MS && onCurrentMonthRef.current) {
        lookForReplay.current = true
        onRefresh()
      }
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    let startY = null, startX = 0
    const down = (e) => {
      if (window.scrollY > 0 || e.touches.length !== 1 || e.target.closest?.('.modal, .ck-film, .gridscroll')) { startY = null; return }
      startY = e.touches[0].clientY
      startX = e.touches[0].clientX
    }
    const moved = (e) => {
      if (startY === null) return
      const dy = e.touches[0].clientY - startY
      const dx = Math.abs(e.touches[0].clientX - startX)
      if (dy <= 0 || dx > dy) { pullRef.current = 0; setPull(0); return }
      pullRef.current = Math.min(110, dy * 0.5)
      setPull(pullRef.current)
    }
    const up = () => {
      const was = pullRef.current
      pullRef.current = 0
      setPull(0)
      startY = null
      if (was >= 70) {
        onRefresh()
        tell('newball')
        if (fxOn()) { buzz(20); sfx('crack'); showStamp('NEW BALL', 'Fresh from the scorer', 'two'); clearAll(); playSix() }
      }
    }
    window.addEventListener('touchstart', down, { passive: true })
    window.addEventListener('touchmove', moved, { passive: true })
    window.addEventListener('touchend', up, { passive: true })
    return () => {
      window.removeEventListener('touchstart', down)
      window.removeEventListener('touchmove', moved)
      window.removeEventListener('touchend', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tapBatter = () => {
    if (!fxOn()) return
    lastEvent.current = Date.now()
    clearAll()
    tell('six')
    const now = Date.now()
    sixes.current = { n: now - sixes.current.at < 2500 ? sixes.current.n + 1 : 1, at: now }
    if (sixes.current.n >= 3) tell('hattrick')
    buzz(18)
    showStamp('SIX!', sixes.current.n > 1 ? `${sixes.current.n} in a row` : '', 'four')
    playSix()
  }
  const tapUmpire = () => {
    if (!fxOn()) return
    lastEvent.current = Date.now()
    sfx('whistle')
    setBubble(IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)])
    setScene((s) => ({ ...s, umpire: 'wide' }))
    at(700, () => setScene((s) => ({ ...s, umpire: 'still' })))
    setTimeout(() => setBubble(''), 2600)
  }
  const tapBowler = () => {
    if (!fxOn()) return
    lastEvent.current = Date.now()
    sfx('tick')
    setScene((s) => ({ ...s, bowler: 'load' }))
    at(420, () => setScene((s) => ({ ...s, bowler: 'mark' })))
  }

  const days = Array.from(
    { length: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate() },
    (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1),
  )
  const rows = monthScores(staff, days, statusFor, todayKey, keyOf)
  const lines = tickerLines({ day: dayNow, rows, isToday: keyOf(cursor) === todayKey })
  const top = byRuns(rows)[0]

  return (
    <>
      <div className="ck-sky" style={{ backgroundImage: `url(${groundPng})` }} aria-hidden="true" />

      {pull > 0 && (
        <div className="ck-pull" style={{ height: pull }} aria-hidden="true">
          <Sprite frame={pull >= 70 ? 'batter-lift' : 'batter-stance'} scale={1} />
          <span>{pull >= 70 ? 'Let go to play the shot' : 'Pull for the new ball'}</span>
        </div>
      )}

      <div className="ck-ticker" role="status" aria-label={lines[0]}>
        <div className="ck-ticker-run" style={{ animationDuration: `${Math.max(14, lines.join(' ').length * 0.24)}s` }} data-still={prefs.effects ? undefined : "true"}>
          {[...lines, ...lines].map((l, i) => <span key={i}>{l}</span>)}
        </div>
      </div>

      {mode === 'day' && (
        <div className="ck-stage" ref={stage} data-hop={hop ? 'true' : undefined} data-still={prefs.effects ? undefined : 'true'}>
          <div className="ck-board">
            <small>{keyOf(cursor) === todayKey ? 'Today' : 'That day'}</small>
            {dayNow.rain ? <b>Rain</b> : <b>{dayNow.runs}<i>/</i>{dayNow.wickets}</b>}
            {!dayNow.rain && <small>{dayNow.yet.length > 0 ? `${dayNow.yet.length} to bat` : 'All out there'}</small>}
          </div>

          <div className="ck-stumps" aria-hidden="true">
            <img src={scene.hit ? stumpsHitPng : stumpsPng} alt="" />
            <img ref={bailA} className="ck-bail a" src={bailPng} alt="" />
            <img ref={bailB} className="ck-bail b" src={bailPng} alt="" />
          </div>

          <button className="ck-who batter" ref={batterEl} onClick={tapBatter} aria-label="Batter. Tap to play a shot">
            {striker && <span className="ck-tag">{striker}</span>}
            <Sprite frame={`batter-${scene.batter}`} flip={scene.batter === 'walk'} />
          </button>
          <button className="ck-who umpire" onClick={tapUmpire} aria-label="Umpire">
            {bubble && <span className="ck-bubble">{bubble}</span>}
            <Sprite frame={`umpire-${scene.umpire}`} />
          </button>
          <button className="ck-who bowler" ref={bowlerEl} onClick={tapBowler} aria-label="Bowler">
            <Sprite frame={`bowler-${scene.bowler}`} flip />
          </button>

          <img ref={ballEl} className="ck-ball" src={ballPng} alt="" aria-hidden="true" />
        </div>
      )}

      <div className="ck-fx" ref={fxRoot} aria-hidden="true">
        {overlay === 'rain' && <div className="ck-rain" />}
        {overlay === 'dusk' && <div className="ck-dusk" />}
        {overlay === 'flash' && <div className="ck-flash" />}
        {wipe > 0 && (
          <div className="ck-wipe" key={wipe}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <i key={i} style={{ animationDelay: `${i * 14}ms` }} data-side={i % 2 ? 'r' : 'l'} />)}
          </div>
        )}
        {stamp && (
          <div className={`ck-stamp ${stamp.kind}`} key={stamp.id} style={{ top: stamp.top }}>
            <b>{stamp.word}</b>
            {stamp.sub && <small>{stamp.sub}</small>}
          </div>
        )}
        {toast && (
          <div className="ck-toast">
            <small>Moment found · {toast.n} of {MOMENTS.length}</small>
            <b>{toast.name}</b>
          </div>
        )}
      </div>

      {settingsOpen && (
        <Settings
          prefs={prefs}
          onPrefs={changePrefs}
          found={found}
          onFilm={() => { setSettingsOpen(false); setFilm(true) }}
          onReplay={onCurrentMonth && todayPlays().some((p) => p.status === 'P' || p.status === 'H' || p.status === 'N')
            ? () => { setSettingsOpen(false); setReplay(todayPlays()) }
            : null}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {film && !loading && staff.length > 0 && (
        <Film
          rows={rows}
          top={top}
          yet={dayNow.yet}
          month={cursor}
          sfx={(name, delay) => { if (wakeSound()) sfx(name, delay) }}
          onDone={() => { writeJson(FILM_SEEN_KEY, true); setFilm(false); if (fxOn()) setWipe((n) => n + 1) }}
        />
      )}
      {replay && !film && (
        <Replay
          plays={replay}
          rows={rows}
          soundsOn={prefs.sounds}
          sfx={sfx}
          onClose={() => setReplay(null)}
        />
      )}
    </>
  )
}

