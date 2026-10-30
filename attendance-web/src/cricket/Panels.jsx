/** The theme's solid panels: the points table, the run chase, and Ground settings. */
import { cricketEvent } from './bus.js'
import { byRuns, honours, MOMENTS, runsFor } from './score.js'
import { PixelIcon } from './Sprite.jsx'
import ballPng from './art/ball.png'
import stumpsPng from './art/stumps.png'

export function CricketKey() {
  return (
    <button className="themebtn" aria-label="Ground settings" title="Ground settings" onClick={() => cricketEvent('settings')}>
      <PixelIcon id="bat" size={24} />
    </button>
  )
}

export function CricketTabIcon({ id }) {
  return <PixelIcon id={id} size={24} />
}

export function PointsTable({ rows }) {
  const sorted = byRuns(rows)
  return (
    <div className="ck-table">
      <div className="ck-table-row head"><span>#</span><span>Batter</span><span>R</span><span>W</span><span>SR</span></div>
      {sorted.map((r, i) => (
        <div className="ck-table-row" data-top={i === 0 && r.runs > 0 ? 'true' : undefined} style={{ animationDelay: `${i * 50}ms` }} key={r.name}>
          <span>{i + 1}</span>
          <span className="ck-table-name">
            {r.name}
            {honours(r).map((h) => <em key={h}>{h}</em>)}
          </span>
          <span>{r.runs}</span>
          <span>{r.wickets}</span>
          <span>{r.rate}</span>
        </div>
      ))}
      <div className="ck-table-note">Present 4 runs, half day 2, absent a wicket. SR is out of 100.</div>
    </div>
  )
}

/**
 * The Tuesday pay rule as a run chase. It reads the result of monthPay, the same
 * figures shown beside it, and works out nothing about money itself.
 */
export function RunChase({ name, attended, threshold, unlocked, missedCount }) {
  const target = runsFor(threshold)
  const runs = Math.min(target, Math.round(runsFor(attended)))
  const needDays = Math.max(0, threshold - attended)
  const need = target - runs
  const lost = !unlocked && missedCount > 0
  const pct = (runs / target) * 100
  return (
    <div className="ck-chase" data-state={unlocked ? 'won' : lost ? 'lost' : 'on'}>
      <div className="ck-chase-top">
        <span>{name}'s chase for Tuesday pay</span>
        <b>{runs}<i>/{target}</i></b>
      </div>
      <div className="ck-chase-pitch">
        <span className="ck-chase-run" style={{ width: `${pct}%` }} />
        <img className="ck-chase-ball" src={ballPng} alt="" style={{ left: `${pct}%` }} />
        <img className="ck-chase-stumps" src={stumpsPng} alt="" />
      </div>
      <div className="ck-chase-say">
        {unlocked ? 'Chased down. Tuesday pay is earned.'
          : lost ? 'Chase lost this month: a Monday or Wednesday was missed.'
            : `Need ${need} runs: ${needDays} more day${needDays === 1 ? '' : 's'}.`}
      </div>
    </div>
  )
}

export function Settings({ prefs, onPrefs, found, onFilm, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet histsheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">Ground settings</div>
        <div className="sheetsub">For this phone only</div>
        <PrefRow label="Effects" hint="The match, stamps, wipes and buzzes" on={prefs.effects} onChange={(v) => onPrefs({ effects: v })} />
        <PrefRow label="Sounds" hint="The bat, the stumps and the crowd" on={prefs.sounds} onChange={(v) => onPrefs({ sounds: v })} />
        <button className="allbtn ghost" onClick={onFilm}>Watch the opening again</button>
        <div className="ck-moments-head">Moments found: {found.length} of {MOMENTS.length}</div>
        <div className="ck-moments">
          {MOMENTS.map((m) => {
            const got = found.includes(m.id)
            return (
              <div className="ck-moment" data-got={got ? 'true' : undefined} key={m.id}>
                <b>{got ? m.name : 'Not found yet'}</b>
                <small>{m.hint}</small>
              </div>
            )
          })}
        </div>
        <div className="sheetbtns"><button className="primbtn" onClick={onClose}>Done</button></div>
      </div>
    </div>
  )
}

function PrefRow({ label, hint, on, onChange }) {
  return (
    <div className="themeswitch ck-pref">
      <div>
        <div className="themeswitch-name">{label}</div>
        <div className="savednote">{hint}</div>
      </div>
      <button className="themeswitch-key" role="switch" aria-checked={on} aria-label={label} data-on={on ? 'true' : undefined} onClick={() => onChange(!on)}>
        <span>{on ? 'On' : 'Off'}</span>
      </button>
    </div>
  )
}
