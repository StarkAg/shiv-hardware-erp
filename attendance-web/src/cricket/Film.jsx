/**
 * The opening film. Plays once on a phone and can be watched again from Ground
 * settings. Built live from this month's real marks, and it can always be skipped.
 * It praises whoever leads and never names anyone for absences. No rupees.
 */
import { useEffect, useRef, useState } from 'react'
import { PixelIcon, Sprite } from './Sprite.jsx'
import groundPng from './art/ground.png'
import coinPng from './art/coin.png'
import light0 from './art/light0.png'
import light1 from './art/light1.png'
import light2 from './art/light2.png'
import light3 from './art/light3.png'

export const FILM_SEEN_KEY = 'shiv-attendance:ck-film-seen'

const LIGHTS = [light0, light1, light2, light3]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const TABS = [['day', 'Play'], ['month', 'Card'], ['stats', 'Table'], ['pay', 'Purse']]

export function Film({ rows, top, yet, month, sfx, onDone }) {
  const [scene, setScene] = useState('quiet')
  const [lit, setLit] = useState(0)
  const [shown, setShown] = useState(0)
  const [tabsLit, setTabsLit] = useState(0)
  const timers = useRef([])
  const data = useRef({ rows, top, yet })
  const finish = useRef(onDone)
  finish.current = onDone

  useEffect(() => {
    const at = (ms, fn) => timers.current.push(setTimeout(fn, ms))
    const r = data.current.rows
    let t = 1500
    at(t, () => setScene('lights'))
    ;[0, 1, 2, 3].forEach((i) => at(t + 250 + i * 360, () => { setLit(i + 1); sfx('thunk') }))
    t += 2300
    at(t, () => { setScene('crowd'); sfx('crowd') })
    t += 2500
    at(t, () => setScene('card'))
    const step = 480
    r.forEach((_, i) => at(t + 350 + i * step, () => { setShown(i + 1); sfx('tick') }))
    t += 800 + r.length * step + 900
    at(t, () => { setScene('leader'); sfx('crack'); sfx('crowd', 0.15) })
    t += 2500
    at(t, () => { setScene('toss'); sfx('coin') })
    t += 2300
    at(t, () => setScene('yours'))
    TABS.forEach((_, i) => at(t + 300 + i * 340, () => { setTabsLit(i + 1); sfx('thunk') }))
    t += 300 + TABS.length * 340 + 1500
    at(t, () => finish.current())
    return () => timers.current.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const leads = top && top.runs > 0
  const yetN = data.current.yet.length
  return (
    <div className="ck-film" data-scene={scene} role="dialog" aria-label="Opening film">
      <div className="ck-cam">
        <img src={groundPng} alt="" />
        {LIGHTS.map((src, i) => <img key={src} src={src} alt="" className="ck-lit" style={{ opacity: lit > i ? 1 : 0 }} />)}
      </div>
      <div className="ck-film-shade" />

      {scene === 'quiet' && <div className="ck-line">The ground is quiet.</div>}
      {scene === 'lights' && <div className="ck-line">Then the lights come on.</div>}
      {scene === 'crowd' && (
        <div className="ck-line">
          {MONTHS[month.getMonth()]}. {rows.length} batters on the sheet.
          <small>The shop has come to watch.</small>
        </div>
      )}
      {scene === 'card' && (
        <div className="ck-card">
          <div className="ck-card-head">The scorecard so far</div>
          {rows.slice(0, shown).map((r) => (
            <div className="ck-card-row" key={r.name}><span>{r.name}</span><b>{r.runs}</b></div>
          ))}
        </div>
      )}
      {scene === 'leader' && (
        <div className="ck-film-hero">
          <Sprite frame="batter-cheer" scale={4} />
          <div className="ck-line">
            {leads ? <>{top.name} leads with {top.runs} runs.</> : <>A new month. Nobody has batted yet.</>}
          </div>
        </div>
      )}
      {scene === 'toss' && (
        <div className="ck-film-hero">
          <img className="ck-coin" src={coinPng} alt="" />
          <div className="ck-line">
            Shiv Hardware won the toss and will bat.
            {yetN > 0 && <small>{yetN} yet to walk in today.</small>}
          </div>
        </div>
      )}
      {scene === 'yours' && (
        <div className="ck-film-hero">
          <div className="ck-film-tabs">
            {TABS.map(([id, label], i) => (
              <div key={id} data-lit={tabsLit > i ? 'true' : undefined}><PixelIcon id={id} size={40} /><span>{label}</span></div>
            ))}
          </div>
          <div className="ck-line">The ground is yours.</div>
        </div>
      )}

      <button className="ck-skip" onClick={() => finish.current()}>Skip</button>
    </div>
  )
}
