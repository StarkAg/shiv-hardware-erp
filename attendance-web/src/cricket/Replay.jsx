/**
 * Today's play, for everyone who was not holding the phone when the marks went in.
 * Every marked player comes out in turn and gets the same moment the marking phone
 * saw, then the day's card. Reads marks only, and can always be skipped.
 */
import { useEffect, useRef, useState } from 'react'
import { byRuns, RUNS, SIX_RUNS } from './score.js'
import { wakeSound } from './sound.js'
import { Sprite } from './Sprite.jsx'
import { clearFlying, dust, firework, flashes, flight, punch, shake, spark, stumpFly } from './fx.js'
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
const PARTY = ['#ffcc00', '#5fe39a', '#ffffff', '#6fb4ff']

export function Replay({ plays, rows, soundsOn, sfx, onClose }) {
  const [big] = useState(() => window.innerWidth >= 360)
  const k = big ? 4 / 3 : 1
  const batting = useRef(plays.filter((p) => RUNS[p.status] || p.status === 'N')).current
  const [turn, setTurn] = useState(-1)
  const [scene, setScene] = useState(REST)
  const [score, setScore] = useState({ runs: 0, wickets: 0 })
  const [stamp, setStamp] = useState(null)
  const [flash, setFlash] = useState(false)
  const [boards, setBoards] = useState(false)
  const [wave, setWave] = useState(0)
  const [done, setDone] = useState(false)
  const [askSound, setAskSound] = useState(() => soundsOn && !wakeSound())

  const stage = useRef(null)
  const world = useRef(null)
  const stumpsEl = useRef(null)
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
    clearFlying(world.current)
    setBoards(false)
    for (const el of [stage.current, world.current, batterEl.current, bailA.current, bailB.current]) {
      el?.getAnimations().forEach((a) => a.cancel())
    }
  }
  const quiet = (name, delay) => { if (wakeSound()) sound.current(name, delay) }

  // In stage pixels, the ball's top-left. The ball is 16 (x k) pixels, the
  // figures 144 (x k) with their feet on row 44 of 48.
  const size = 16 * k
  const places = () => {
    const box = stage.current.getBoundingClientRect()
    const bt = batterEl.current.getBoundingClientRect()
    const bw = bowlerEl.current.getBoundingClientRect()
    const st = stumpsEl.current.getBoundingClientRect()
    return {
      w: box.width,
      h: box.height,
      from: { x: bw.left - box.left + 39 * k, y: bw.top - box.top + 33 * k },
      bat: { x: bt.left - box.left + 108 * k, y: bt.top - box.top + 87 * k },
      stumps: { x: bt.left - box.left + 9 * k, y: bt.top - box.top + 96 * k },
      ground: bt.top - box.top + bt.height * (44 / 48) - size,
      feet: { x: bt.left - box.left + bt.width * 0.5, y: bt.top - box.top + bt.height * (43 / 48) },
      middle: { x: st.left - box.left + st.width * (8 / 18), y: st.top - box.top + st.height * (4 / 24) },
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
      // Down the pitch, lands short in a puff of dust, up at the bat or the stumps.
      const p = places()
      const aim = status === 'N' ? p.stumps : p.bat
      const land = { x: aim.x + (p.from.x - aim.x) * 0.3, y: p.ground }
      flight(world.current, [{ ...p.from, o: 0 }, { ...land, r: 220, o: 0.62 }, { ...aim, r: 320, o: 1 }], { duration: 170, ground: p.ground, size })
      at(105, () => dust(world.current, land.x + size / 2, p.ground + size, 6))
      quiet('bounce', 0.105)
    })
    at(710, () => setScene((s) => ({ ...s, bowler: 'after' })))
    at(790, () => {
      const p = places()
      const s = STAMP[status]
      setStamp(run
        ? { id: i, word: 'SIX!', sub: `${name}: ${run} days in a row`, kind: 'six' }
        : { id: i, word: s.word, sub: `${name}: ${s.say}`, kind: s.kind })
      setScore((old) => ({ runs: old.runs + runsOf(batting[i]), wickets: old.wickets + (status === 'N' ? 1 : 0) }))
      if (status !== 'N') spark(world.current, p.bat.x + size / 2, p.bat.y + size / 2)
      if (run) {
        // Up and over the stand: fireworks, phones flashing, a wave round the ground.
        quiet('crack')
        quiet('roar', 0.06)
        setScene((c) => ({ ...c, batter: 'pull', umpire: 'six' }))
        shake(stage.current, 3, 180)
        flight(world.current, [
          { ...p.bat, o: 0 },
          { x: p.w * 0.55, y: p.h * 0.12, r: 540, o: 0.5 },
          { x: p.w * 0.85, y: -60, r: 1000, o: 1 },
        ], { duration: 720, easing: 'cubic-bezier(.2,.7,.4,1)', ground: p.ground, size })
        ;[[0.25, 0.14, 0], [0.75, 0.1, 170], [0.5, 0.2, 340]].forEach(([fx, fy, ms]) => at(420 + ms, () => (
          firework(world.current, p.w * fx, p.h * fy, PARTY, { rise: 90, ring: 54 })
        )))
        flashes(world.current, { x0: 6, x1: p.w - 6, y0: p.h * 0.32, y1: p.h * 0.5 }, 22, 1300)
        at(200, () => setWave((n) => n + 1))
        at(240, () => setScene((c) => ({ ...c, batter: 'cheer' })))
        at(1450, () => playTurn(i + 1))
      } else if (status === 'P') {
        // Along the ground: two hops, beats the field to the rope, boards light up.
        quiet('crack')
        quiet('claps', 0.4)
        quiet('crowd', 0.35)
        setScene((c) => ({ ...c, batter: 'drive' }))
        const run = (f) => p.bat.x + (p.w + 24 - p.bat.x) * f
        flight(world.current, [
          { ...p.bat, o: 0 },
          { x: run(0.28), y: p.ground - 22 * k, r: 260, o: 0.26 },
          { x: run(0.48), y: p.ground, r: 480, o: 0.44 },
          { x: run(0.66), y: p.ground - 8 * k, r: 660, o: 0.62 },
          { x: run(0.8), y: p.ground, r: 820, o: 0.78 },
          { x: run(1), y: p.ground, r: 1080, o: 1 },
        ], { duration: 600, easing: 'cubic-bezier(.25,.6,.45,1)', ground: p.ground, size })
        at(160, () => dust(world.current, run(0.48) + size / 2, p.ground + size, 5))
        at(320, () => dust(world.current, run(0.8) + size / 2, p.ground + size, 4))
        at(150, () => setScene((c) => ({ ...c, batter: 'follow', umpire: 'fourA' })))
        at(350, () => setScene((c) => ({ ...c, umpire: 'fourB' })))
        at(430, () => setBoards(true))
        at(550, () => setScene((c) => ({ ...c, umpire: 'fourA' })))
        at(1000, () => playTurn(i + 1))
      } else if (status === 'H') {
        quiet('crack')
        quiet('run', 0.12)
        setScene((c) => ({ ...c, batter: 'runA' }))
        dust(world.current, p.feet.x, p.feet.y, 6)
        at(320, () => dust(world.current, p.feet.x + 70, p.feet.y, 6))
        batterEl.current?.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(70px)' }, { transform: 'translateX(0)' }],
          { duration: 640, easing: 'steps(8)' },
        )
        ;[110, 270, 430, 590].forEach((ms, n) => at(ms, () => setScene((c) => ({ ...c, batter: n % 2 ? 'runA' : 'runB' }))))
        at(960, () => playTurn(i + 1))
      } else {
        // Bowled: the middle stump cartwheels, the camera pushes in and shakes.
        quiet('stumps')
        quiet('clatter', 0.04)
        quiet('groan', 0.14)
        setScene((c) => ({ ...c, hit: true, batter: 'stance', bowler: 'appeal' }))
        stumpFly(world.current, p.middle.x, p.middle.y, 1.5 * k)
        punch(world.current, p.middle.x, p.middle.y + 30 * k, 1.14, 560)
        shake(stage.current, 5, 300)
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
            <div className="ck-world ck-rp-world" ref={world}>
              <div className="ck-floods" aria-hidden="true" />
              {wave > 0 && <i className="ck-wave" key={wave} aria-hidden="true" />}
              {boards && <i className="ck-boards" aria-hidden="true" />}
              <div className="ck-rp-stumps" ref={stumpsEl} aria-hidden="true">
                <img src={scene.hit ? stumpsHitPng : stumpsPng} alt="" />
                <img ref={bailA} className="a" src={bailPng} alt="" />
                <img ref={bailB} className="b" src={bailPng} alt="" />
              </div>
              <div className="ck-rp-who batter" ref={batterEl}><Sprite frame={`batter-${scene.batter}`} scale={big ? 4 : 3} flip={walkingOff} /></div>
              <div className="ck-rp-who umpire"><Sprite frame={`umpire-${scene.umpire}`} scale={3} /></div>
              <div className="ck-rp-who bowler" ref={bowlerEl}><Sprite frame={`bowler-${scene.bowler}`} scale={big ? 4 : 3} flip /></div>
            </div>
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
