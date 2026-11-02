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
import { ladderLine, monthPay } from '../pay.js'
import { play, wakeSound } from './sound.js'
import { Film, FILM_SEEN_KEY } from './Film.jsx'
import { Replay } from './Replay.jsx'
import { Settings } from './Panels.jsx'
import { Sprite } from './Sprite.jsx'
import { burst, clearFlying, dust, firework, flashes, flight, punch, shake, spark, stumpFly } from './fx.js'
import bailPng from './art/bail.png'
import stumpsPng from './art/stumps.png'
import stumpsHitPng from './art/stumps-hit.png'
import groundPng from './art/ground.png'

const FOUND_KEY = 'shiv-attendance:ck-found'
const PREFS_KEY = 'shiv-attendance:ck-prefs'
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
const PARTY = ['#ffcc00', '#5fe39a', '#ffffff', '#6fb4ff']
// The stands on the strip, in stage pixels: where camera flashes go off.
const CROWD = (w) => ({ x0: 4, x1: w - 4, y0: 4, y1: 56 })

/** The board's runs climb one at a time to a new total, like a real scoreboard. */
function useCountUp(value, on) {
  const [shown, setShown] = useState(value)
  const shownRef = useRef(value)
  shownRef.current = shown
  useEffect(() => {
    const from = shownRef.current
    if (!on || value <= from || value - from > 30) { setShown(value); return undefined }
    let n = from
    const t = setInterval(() => {
      n += 1
      setShown(n)
      if (n >= value) clearInterval(t)
    }, 55)
    return () => clearInterval(t)
  }, [value, on])
  return shown
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
  const [boards, setBoards] = useState(false)
  const [wave, setWave] = useState(0)

  const fxRoot = useRef(null)
  const stage = useRef(null)
  const world = useRef(null)
  const stumpsEl = useRef(null)
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
    setBoards(false)
    clearFlying(world.current)
    for (const el of [stage.current, world.current, batterEl.current, bowlerEl.current, bailA.current, bailB.current]) {
      el?.getAnimations().forEach((a) => a.cancel())
    }
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

  // Where the ball starts and arrives on the strip, in stage pixels (the ball's
  // top-left). Null when the strip is not showing.
  const places = () => {
    const box = stage.current?.getBoundingClientRect()
    if (!box || !batterEl.current || !bowlerEl.current) return null
    const bt = batterEl.current.getBoundingClientRect()
    const bw = bowlerEl.current.getBoundingClientRect()
    const st = stumpsEl.current?.getBoundingClientRect()
    return {
      w: box.width,
      from: { x: bw.left - box.left + 26, y: bw.top - box.top + 22 },
      bat: { x: bt.left - box.left + 72, y: bt.top - box.top + 58 },
      stumps: { x: bt.left - box.left + 6, y: bt.top - box.top + 64 },
      ground: bt.top - box.top + 76, // feet are on row 44 of 48, drawn twice size
      feet: { x: bt.left - box.left + 50, y: bt.top - box.top + 86 },
      middle: st ? { x: st.left - box.left + 16, y: st.top - box.top + 8 } : null,
    }
  }
  // The ball comes down the pitch, lands short of the batter in a puff of dust,
  // and comes up at the bat (or the stumps). It takes 170ms: the shot is at 170.
  const deliver = (aim) => {
    const p = places()
    if (!p) return null
    const toward = p[aim]
    const land = { x: toward.x + (p.from.x - toward.x) * 0.3, y: p.ground }
    flight(world.current, [{ ...p.from, o: 0 }, { ...land, r: 220, o: 0.62 }, { ...toward, r: 320, o: 1 }], { duration: 170, ground: p.ground })
    at(105, () => dust(world.current, land.x + 6, p.ground + 12, 5))
    sfx('bounce', 0.105)
    return p
  }
  const bowl = () => {
    setScene({ ...REST, batter: 'lift', bowler: 'throw' })
    at(90, () => setScene((s) => ({ ...s, bowler: 'after' })))
  }

  // A four is hit along the ground: it skims the grass, hops twice and beats the
  // fielder to the rope, and the boundary boards light up.
  const playFour = () => {
    bowl()
    const p = deliver('bat')
    sfx('crack', 0.17)
    sfx('claps', 0.55)
    sfx('crowd', 0.5)
    at(170, () => {
      setScene((s) => ({ ...s, batter: 'drive' }))
      if (!p) return
      spark(world.current, p.bat.x + 6, p.bat.y + 6)
      const run = (f) => p.bat.x + (p.w + 24 - p.bat.x) * f
      flight(world.current, [
        { ...p.bat, o: 0 },
        { x: run(0.28), y: p.ground - 16, r: 260, o: 0.26 },
        { x: run(0.48), y: p.ground, r: 480, o: 0.44 },
        { x: run(0.66), y: p.ground - 6, r: 660, o: 0.62 },
        { x: run(0.8), y: p.ground, r: 820, o: 0.78 },
        { x: run(1), y: p.ground, r: 1080, o: 1 },
      ], { duration: 560, easing: 'cubic-bezier(.25,.6,.45,1)', ground: p.ground })
      at(150, () => dust(world.current, run(0.48) + 6, p.ground + 12, 4))
      at(300, () => dust(world.current, run(0.8) + 6, p.ground + 12, 3))
    })
    at(320, () => setScene((s) => ({ ...s, batter: 'follow', umpire: 'fourA' })))
    at(520, () => setScene((s) => ({ ...s, umpire: 'fourB' })))
    at(600, () => { setBoards(true); at(760, () => setBoards(false)) })
    at(720, () => setScene((s) => ({ ...s, umpire: 'fourA' })))
    at(920, () => setScene((s) => ({ ...s, umpire: 'fourB' })))
    crowdHop()
    at(1150, () => setScene(REST))
  }
  const playTwo = () => {
    bowl()
    const p = deliver('bat')
    sfx('crack', 0.17)
    sfx('run', 0.3)
    at(170, () => {
      setScene((s) => ({ ...s, batter: 'runA' }))
      if (p) {
        spark(world.current, p.bat.x + 6, p.bat.y + 6)
        dust(world.current, p.feet.x, p.feet.y, 5)
      }
      batterEl.current?.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(46px)' }, { transform: 'translateX(0)' }],
        { duration: 640, easing: 'steps(8)' },
      )
    })
    if (p) at(490, () => dust(world.current, p.feet.x + 46, p.feet.y, 5))
    ;[280, 440, 600, 760].forEach((ms, i) => at(ms, () => setScene((s) => ({ ...s, batter: i % 2 ? 'runA' : 'runB' }))))
    at(840, () => setScene(REST))
  }
  // Bowled: the middle stump cartwheels away, the bails spin off, and the camera
  // pushes in on the broken wicket and shakes.
  const playOut = () => {
    bowl()
    const p = deliver('stumps')
    sfx('stumps', 0.17)
    sfx('clatter', 0.2)
    sfx('groan', 0.32)
    at(170, () => {
      setScene((s) => ({ ...s, hit: true, batter: 'stance', bowler: 'appeal' }))
      if (p?.middle) {
        stumpFly(world.current, p.middle.x, p.middle.y)
        punch(world.current, p.middle.x, p.middle.y + 20, 1.1, 480)
      }
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
      at(220, () => setOverlay(null))
      shake(stage.current, 4, 280)
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
  // A six goes up and over the stand: fireworks, phones flashing in the crowd, and
  // a Mexican wave going round.
  const playSix = () => {
    bowl()
    const p = deliver('bat')
    sfx('crack', 0.17)
    sfx('roar', 0.22)
    at(170, () => {
      setScene((s) => ({ ...s, batter: 'pull', umpire: 'six' }))
      if (!p) return
      spark(world.current, p.bat.x + 6, p.bat.y + 6)
      shake(stage.current, 2, 160)
      flight(world.current, [
        { ...p.bat, o: 0 },
        { x: p.w * 0.52, y: -24, r: 540, o: 0.5 },
        { x: p.w * 0.8, y: -70, r: 980, o: 1 },
      ], { duration: 640, easing: 'cubic-bezier(.2,.7,.4,1)', ground: p.ground })
      ;[[0.28, 30, 0], [0.72, 22, 160], [0.5, 36, 330]].forEach(([fx, y, ms]) => at(420 + ms, () => (
        firework(world.current, p.w * fx, y, PARTY, { rise: 50, ring: 30 })
      )))
      flashes(world.current, CROWD(p.w), 16, 1300)
      at(250, () => setWave((n) => n + 1))
    })
    at(380, () => setScene((s) => ({ ...s, batter: 'cheer' })))
    crowdHop(1200)
    at(1300, () => setScene(REST))
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
            burst(fxRoot.current, x, y, PARTY, { count: 24, spread: 110 })
            showStamp('SIX!', `${ev.name}: ${run} days in a row`, 'six')
            sfx('crowd', 0.45)
            playSix()
          } else sfx('crack')
        } else if (ev.status === 'P') {
          tell('cover')
          if (fx) { buzz(18); burst(fxRoot.current, x, y, ['#ffcc00', '#5fe39a', '#ffffff'], { fall: 26 }); showStamp('FOUR!', `${ev.name}: present`, 'four'); playFour() } else sfx('crack')
        } else if (ev.status === 'H') {
          tell('two')
          if (fx) { buzz(12); burst(fxRoot.current, x, y, ['#ffcc00', '#ffffff'], { count: 8, spread: 50 }); showStamp('TWO RUNS', `${ev.name}: half day`, 'two'); playTwo() } else sfx('crack')
        } else if (ev.status === 'N') {
          tell('bowled')
          if (fx) { buzz([24, 40, 24]); burst(fxRoot.current, x, y, ['#ff5a62', '#ebd7aa'], { count: 14, spread: 80 }); showStamp('OUT', `${ev.name}: absent`, 'out'); playOut() } else sfx('stumps')
        } else {
          sfx('tick')
        }
      } else if (ev.type === 'allin') {
        tell('allin')
        if (!fx) { sfx('crowd'); return }
        buzz([16, 30, 16, 30, 16])
        setStriker('')
        showStamp('ALL IN', 'Whole team present', 'four')
        sfx('roar'); sfx('claps', 0.2); sfx('crowd', 0.6)
        setScene({ ...REST, batter: 'cheer', umpire: 'six', bowler: 'appeal' })
        crowdHop(1300)
        setWave((n) => n + 1)
        for (let i = 0; i < 6; i++) {
          at(i * 190, () => firework(
            fxRoot.current,
            window.innerWidth * (0.15 + Math.random() * 0.7),
            90 + Math.random() * 120,
            PARTY, { rise: 90, ring: 54 },
          ))
        }
        const w = stage.current?.getBoundingClientRect().width
        if (w) flashes(world.current, CROWD(w), 22, 1400)
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
  const shownRuns = useCountUp(dayNow.runs, prefs.effects)
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

  // The stands are alive: now and then a phone flashes in the crowd, and when the
  // screen has been quiet for a while a Mexican wave goes round.
  useEffect(() => {
    if (mode !== 'day' || !prefs.effects) return undefined
    let ticks = 0
    const t = setInterval(() => {
      if (filmRef.current || document.hidden) return
      ticks += 1
      const w = stage.current?.getBoundingClientRect().width
      if (w && Math.random() < 0.55) flashes(world.current, CROWD(w), 1 + Math.floor(Math.random() * 2), 1800)
      if (ticks % 10 === 0 && Date.now() - lastEvent.current > 14000) setWave((n) => n + 1)
    }, 2400)
    return () => clearInterval(t)
  }, [mode, prefs.effects])

  // Pull the page down from the very top: the batter winds up; let go and it is hit.
  const pullRef = useRef(0)

  // Today's play. Every opening of the app, on every phone, looks once on marks fresh
  // from Convex rather than the cache, and plays when the day is done, even with the
  // effects off. A half marked day waits, so nobody gets it mid-marking.
  // Each batter carries where they stand on the bonus ladder (pay.js) after
  // today's mark, said in days, shown under their name as the shot lands.
  const todayPlays = () => {
    const now = new Date()
    const monthDays = Array.from(
      { length: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() },
      (_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1),
    )
    return staff.map((name) => {
      const status = statusFor(now, name)
      const ladder = monthPay({ entries: monthDays.map((d) => {
        const s = statusFor(d, name)
        return { date: d, status: s, future: keyOf(d) > todayKey || (keyOf(d) === todayKey && !s) }
      }) })
      return {
        name,
        status,
        run: status === 'P' ? sixRun(statusFor, name, now) : 0,
        bonus: {
          days: ladder.attended,
          gain: status === 'P' ? 1 : status === 'H' ? 0.5 : 0,
          // An out is a leave, unless today is the Tuesday off.
          leaves: ladder.leaves,
          leaveGain: status === 'N' && now.getDay() !== 2 ? 1 : 0,
          say: ladderLine(ladder),
          state: ladder.missed.length ? 'lost' : ladder.enough ? 'on' : 'climb',
        },
      }
    })
  }
  const lookForReplay = useRef(true)
  const onCurrentMonth = cursor.getFullYear() === new Date().getFullYear() && cursor.getMonth() === new Date().getMonth()
  const onCurrentMonthRef = useRef(onCurrentMonth)
  onCurrentMonthRef.current = onCurrentMonth
  useEffect(() => {
    if (!lookForReplay.current || freshTick === 0 || staff.length === 0) return
    lookForReplay.current = false
    if (!onCurrentMonth) return
    const plays = todayPlays()
    if (!plays.some((p) => p.status === 'P' || p.status === 'H' || p.status === 'N')) return
    if (!todaySaved && plays.some((p) => !p.status)) return
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
        <div className="ck-stage" ref={stage} data-still={prefs.effects ? undefined : 'true'}>
          <div className="ck-world" ref={world} data-hop={hop ? 'true' : undefined}>
            <div className="ck-floods" aria-hidden="true" />
            {wave > 0 && <i className="ck-wave" key={wave} aria-hidden="true" />}
            {boards && <i className="ck-boards" aria-hidden="true" />}
            <div className="ck-pitch" aria-hidden="true"><i className="bat-end" /><i className="bowl-end" /></div>

            <div className="ck-stumps" ref={stumpsEl} aria-hidden="true">
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
          </div>

          <div className="ck-board">
            <small>{keyOf(cursor) === todayKey ? 'Today' : 'That day'}</small>
            {dayNow.rain ? <b>Rain</b> : (
              <b aria-label={`${dayNow.runs} for ${dayNow.wickets}`}>
                <span className="ck-count" key={`r${dayNow.runs}`}>{shownRuns}</span>
                <i>/</i>
                <span className="ck-count" key={`w${dayNow.wickets}`}>{dayNow.wickets}</span>
              </b>
            )}
            {!dayNow.rain && <small>{dayNow.yet.length > 0 ? `${dayNow.yet.length} to bat` : 'All out there'}</small>}
          </div>
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

