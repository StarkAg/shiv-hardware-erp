// ── The rate card, and the material behind it ───────────────────────────────
// Two lists, for the two different questions.
//
// The per-piece rates are what the customer is told. Four of them came off the
// papers; the rest get learned the first time somebody quotes that combination.
//
// The material figures are what the variance warning is worked out from. They
// start as an average because a ventilator has never had a sheet of its own —
// the 2-Track window sheet does it properly, section by section, and until
// those figures exist for a ventilator the warning reports feet and square
// feet honestly and marks its rupees as an estimate.

import { useState } from 'react'
import {
  FORMS, FORM_IDS, FILLS, FILLS_FOR, allRates, learnRate, productShort,
  readMaterial, writeMaterial, DEFAULT_MATERIAL, inr,
} from './rates.js'

export default function RatesScreen({ onChanged }) {
  const [rates, setRates] = useState(allRates())
  const [mat, setMat] = useState(readMaterial())

  const setRate = (form, fill, value) => {
    const v = Math.round(Number(String(value).replace(/[^0-9]/g, '')) || 0)
    learnRate(form, fill, v)
    setRates(allRates())
    onChanged?.()
  }

  const setMatField = (k, v) => {
    const next = { ...mat, [k]: Number(v) || 0 }
    setMat(next)
    writeMaterial(next)
    onChanged?.()
  }

  const toggleMeasured = () => {
    const next = { ...mat, measured: !mat.measured }
    setMat(next)
    writeMaterial(next)
    onChanged?.()
  }

  return (
    <>
      <div className="block">
        <div className="blocktitle">Per piece — what the customer is told</div>
        <div className="note">
          Blank means the shop has never priced that combination. It gets asked
          for once, the first time it is quoted.
        </div>

        {FORM_IDS.map((form) => (
          <div className="ratesgroup" key={form}>
            <div className="ratesform">{FORMS[form].label}</div>
            {(FILLS_FOR[form] || []).map((fill) => {
              const key = `${form}:${fill}`
              return (
                <div className="raterow" key={key}>
                  <span>{FILLS[fill].label}</span>
                  <input
                    inputMode="numeric" value={rates[key] || ''} placeholder="—"
                    onChange={(e) => setRate(form, fill, e.target.value)}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="block warnblock">
        <div className="blocktitle warn">Material — what the shop spends</div>
        <div className="note">
          Only used for the size-variance warning. Never touches a price a
          customer sees.
        </div>

        <div className="raterow">
          <span>Aluminium ₹ per kg</span>
          <input inputMode="numeric" value={mat.rupeesPerKg}
            onChange={(e) => setMatField('rupeesPerKg', e.target.value)} />
        </div>
        <div className="raterow">
          <span>Section kg per running foot</span>
          <input inputMode="decimal" value={mat.kgPerFt}
            onChange={(e) => setMatField('kgPerFt', e.target.value)} />
        </div>
        <div className="raterow">
          <span>Frames per piece</span>
          <input inputMode="numeric" value={mat.framesPerPiece}
            onChange={(e) => setMatField('framesPerPiece', e.target.value)} />
        </div>

        <button className={`togglebtn ${mat.measured ? 'on' : ''}`} onClick={toggleMeasured}>
          {mat.measured
            ? '✓ These are the shop’s real figures'
            : 'These are still averages — warnings say “estimated”'}
        </button>

        <div className="note">
          To make them real, the ventilator needs what the 2-Track sheet already
          has: which sections its frame uses, and the kilos per 16 ft length of
          each. Averaging them into one number is what makes the rupees rough —
          the feet and square feet are exact either way.
        </div>
      </div>

      <div className="block">
        <div className="blocktitle">Fill rates per sqft</div>
        <div className="note">Read off the window sheet. Used for material only.</div>
        {Object.keys(FILLS).map((id) => (
          <div className="raterow flat" key={id}>
            <span>{FILLS[id].label}</span>
            <b>{inr(FILLS[id].sqft)}</b>
          </div>
        ))}
      </div>
    </>
  )
}
