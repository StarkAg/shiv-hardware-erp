/**
 * Today's play, for everyone who was not holding the phone when the marks went in.
 * Every marked player comes out in turn and gets the same moment the marking phone
 * saw, then the day's card. Reads marks only, and can always be skipped.
 */
import { useEffect, useRef, useState } from 'react'
import { byRuns, RUNS, SIX_RUNS } from './score.js'
import { wakeSound } from './sound.js'
import { Sprite } from './Sprite.jsx'
import ballPng from './art/ball.png'
import bailPng from './art/bail.png'
import stumpsPng from './art/stumps.png'
import stumpsHitPng from './art/stumps-hit.png'

const REST = { batter: 'walk', bowler: 'mark', umpire: 'still', hit: false }
const TODAY_MARK = { P: '4', H: '2', N: 'W', C: 'C' }
const TODAY_SAY = { P: 'Present, four runs', H: 'Half day, two runs', N: 'Absent, out', C: 'Closed' }
const STAMP = {
  P: { word: 'FOUR!', say: 'present', kind: 'four' },
  H: { word: 'TWO RUNS', say: 'half day', kind: 'two' },
  N: { word: 'OUT', say: 'absent', kind: 'out' },
}

const runsOf = (p) => (p.run ? SIX_RUNS : RUNS[p.status] || 0)

export function Replay({ plays, rows, soundsOn, sfx, onClose }) {
  const [big] = useState(() => window.innerWidth >= 360)
  const k = big ? 4 / 3 : 1
  const batting = useRef(plays.filter((p) => RUNS[p.status] || p.status === 'N')).current
  const [turn, setTurn] = useState(-1)
  const [scene, setScene] = useState(REST)
  const [score, setScore] = useState({ runs: 0, wickets: 0 })
  const [stamp, setStamp] = useState(null)
  const [flash, setFlash] = useState(false)
  const [done, setDone] = useState(false)
  const [askSound, setAskSound] = useState(() => soundsOn && !wakeSound())

  const stage = useRef(null)
  const ballEl = useRef(null)
  const batterEl = useRef(null)
  const bowlerEl = useRef(null)
  const bailA = useRef(null)
  const bailB = useRef(null)
  const timers = useRef([])
  const sound = useRef(sfx)
  sound.current = sfx

  const at = (ms, fn) => timers.current.push(setTimeout(fn, ms))
  const stopAll = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    for (const el of [ballEl.current, batterEl.current, bailA.current, bailB.current]) {
      el?.getAnimations().forEach((a) => a.cancel())
    }
    if (ballEl.current) ballEl.current.style.opacity = 0
  }
  const quiet = (name, delay) => { if (wakeSound()) sound.current(name, delay) }

  const moveBall = (keys, duration, easing = 'linear') => {
    const el = ballEl.current
    if (!el) return
    el.style.opacity = 1
    el.animate(
      keys.map((k) => ({ transform: `translate(${k.x}px, ${k.y}px) rotate(${k.r || 0}deg)` })),
      { duration, easing, fill: 'forwards' },
    ).onfinish = () => { el.style.opacity = 0 }
  }
  const places = () => {
    const box = stage.current.getBoundingClientRect()
    const bt = batterEl.current.getBoundingClientRect()
    const bw = bowlerEl.current.getBoundingClientRect()
    return {
      w: box.width,
      from: { x: bw.left - box.left + 39 * k, y: bw.top - box.top + 33 * k },
      bat: { x: bt.left - box.left + 108 * k, y: bt.top - box.top + 87 * k },
      stumps: { x: bt.left - box.left + 9 * k, y: bt.top - box.top + 96 * k },
    }
  }

  const playTurn = (i) => {
    stopAll()
    if (i >= batting.length) { setStamp(null); setDone(true); quiet('crowd'); return }
    const { name, status, run } = batting[i]
    setTurn(i)
    setStamp(null)
    setScene(REST)
    batterEl.current?.animate(
      [{ transform: 'translateX(-200px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'steps(6)' },
    )
    at(340, () => setScene((s) => ({ ...s, batter: 'stance', bowler: 'load' })))
    at(620, () => {
      setScene((s) => ({ ...s, batter: 'lift', bowler: 'throw' }))
      const p = places()
      const aim = status === 'N' ? p.stumps : p.bat
      moveBall([p.from, { x: (p.from.x + aim.x) / 2, y: aim.y + 18 }, aim], 170)
    })
    at(710, () => setScene((s) => ({ ...s, bowler: 'after' })))
    at(790, () => {
      const p = places()
      const s = STAMP[status]
      setStamp(run
        ? { id: i, word: 'SIX!', sub: `${name}: ${run} days in a row`, kind: 'six' }
        : { id: i, word: s.word, sub: `${name}: ${s.say}`, kind: s.kind })
      setScore((old) => ({ runs: old.runs + runsOf(batting[i]), wickets: old.wickets + (status === 'N' ? 1 : 0) }))
      if (run) {
        quiet('crack')
        quiet('crowd', 0.08)
        quiet('crowd', 0.5)
        setScene((c) => ({ ...c, batter: 'pull', umpire: 'six' }))
        moveBall([p.bat, { x: p.w * 0.6, y: -40, r: 500 }, { x: p.w + 20, y: -60, r: 1000 }], 700, 'ease-out')
        at(240, () => setScene((c) => ({ ...c, batter: 'cheer' })))
        at(1300, () => playTurn(i + 1))
      } else if (status === 'P') {
        quiet('crack')
        quiet('crowd', 0.08)
        setScene((c) => ({ ...c, batter: 'drive' }))
        moveBall([p.bat, { x: p.w * 0.7, y: 10, r: 360 }, { x: p.w + 20, y: 50, r: 720 }], 520, 'ease-out')
        at(150, () => setScene((c) => ({ ...c, batter: 'follow', umpire: 'fourA' })))
        at(350, () => setScene((c) => ({ ...c, umpire: 'fourB' })))
        at(550, () => setScene((c) => ({ ...c, umpire: 'fourA' })))
        at(960, () => playTurn(i + 1))
      } else if (status === 'H') {
        quiet('crack')
        quiet('run', 0.12)
        setScene((c) => ({ ...c, batter: 'runA' }))
        batterEl.current?.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(70px)' }, { transform: 'translateX(0)' }],
          { duration: 640, easing: 'steps(8)' },
        )
        ;[110, 270, 430, 590].forEach((ms, n) => at(ms, () => setScene((c) => ({ ...c, batter: n % 2 ? 'runA' : 'runB' }))))
        at(960, () => playTurn(i + 1))
      } else {
        quiet('stumps')
        quiet('groan', 0.12)
        setScene((c) => ({ ...c, hit: true, batter: 'stance', bowler: 'appeal' }))
        for (const [el, dx] of [[bailA.current, -40], [bailB.current, 36]]) {
          el?.animate(
            [
              { transform: 'translate(0, 0) rotate(0)', opacity: 1 },
              { transform: `translate(${dx}px, -50px) rotate(300deg)`, opacity: 1, offset: 0.5 },
              { transform: `translate(${dx * 1.5}px, 24px) rotate(640deg)`, opacity: 0 },
            ],
            { duration: 620, easing: 'ease-out', fill: 'forwards' },
          )
        }
        setFlash(true)
        at(190, () => setFlash(false))
        at(260, () => {
          setScene((c) => ({ ...c, umpire: 'out', batter: 'walk' }))
          batterEl.current?.animate(
            [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-160px)', opacity: 0 }],
            { duration: 700, easing: 'steps(9)', fill: 'forwards' },
          )
        })
        at(1160, () => playTurn(i + 1))
      }
    })
  }

  useEffect(() => {
    if (batting.length === 0) { setDone(true); return undefined }
    const start = setTimeout(() => playTurn(0), 450)
    return () => { clearTimeout(start); stopAll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const skip = () => {
    stopAll()
    setStamp(null)
    setFlash(false)
    setScore(batting.reduce((t, p) => ({
      runs: t.runs + runsOf(p),
      wickets: t.wickets + (p.status === 'N' ? 1 : 0),
    }), { runs: 0, wickets: 0 }))
    setDone(true)
  }

  const statusOf = Object.fromEntries(plays.map((p) => [p.name, p.status]))
  const hitSix = Object.fromEntries(plays.map((p) => [p.name, Boolean(p.run)]))
  const current = batting[turn]
  const walkingOff = scene.batter === 'walk' && scene.umpire === 'out'

  return (
    <div
      className="ck-rp"
      role="dialog"
      aria-label="Today's play"
      onClick={() => { if (askSound) { wakeSound(); setAskSound(false) } }}
    >
      <div className="ck-rp-board">
        <div>
          <small>Today's play</small>
          <small>{done ? 'Full card' : `${Math.max(turn + 1, 1)} of ${batting.length}`}</small>
        </div>
        <b>{score.runs}<i>/</i>{score.wickets}</b>
      </div>

      {done ? (
        <div className="ck-rp-card">
          <div className="ck-rp-head"><span>Batter</span><span>Today</span><span>Month</span></div>
          {byRuns(rows).map((r, i) => {
            const today = statusOf[r.name]
            return (
              <div className="ck-rp-row" style={{ animationDelay: `${i * 60}ms` }} key={r.name}>
                <span>{i + 1}. {r.name}</span>
                <em data-s={hitSix[r.name] ? 'six' : today || undefined} aria-label={hitSix[r.name] ? 'Present, hit for six' : TODAY_SAY[today] || 'Not marked'}>{hitSix[r.name] ? '6' : TODAY_MARK[today] || '-'}</em>
                <b>{r.runs}</b>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className="ck-rp-stage" ref={stage} style={{ '--k': k }}>
            <div className="ck-rp-stumps" aria-hidden="true">
              <img src={scene.hit ? stumpsHitPng : stumpsPng} alt="" />
              <img ref={bailA} className="a" src={bailPng} alt="" />
              <img ref={bailB} className="b" src={bailPng} alt="" />
            </div>
            <div className="ck-rp-who batter" ref={batterEl}><Sprite frame={`batter-${scene.batter}`} scale={big ? 4 : 3} flip={walkingOff} /></div>
            <div className="ck-rp-who umpire"><Sprite frame={`umpire-${scene.umpire}`} scale={3} /></div>
            <div className="ck-rp-who bowler" ref={bowlerEl}><Sprite frame={`bowler-${scene.bowler}`} scale={big ? 4 : 3} flip /></div>
            <img ref={ballEl} className="ck-rp-ball" src={ballPng} alt="" aria-hidden="true" />
            {flash && <div className="ck-flash" />}
            {stamp && (
              <div className={`ck-stamp ${stamp.kind}`} key={stamp.id}>
                <b>{stamp.word}</b>
                <small>{stamp.sub}</small>
              </div>
            )}
          </div>
          <div className="ck-rp-name" key={turn}>{current ? current.name : ''}</div>
        </>
      )}

      {askSound && !done && <div className="ck-rp-hint">Tap for sound</div>}
      <button className={done ? 'ck-rp-go' : 'ck-skip'} onClick={done ? onClose : skip}>{done ? 'Play on' : 'Skip'}</button>
    </div>
  )
}
