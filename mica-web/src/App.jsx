import { useRef, useState } from 'react'
import { Capture, PhotoCapture, Shades, loadPhoto } from './Capture'
import { difference, distance, similarity, verdict } from './color'

/**
 * Mica Match: one sheet against another.
 *
 * The reference goes on top — read off a photo (a catalog page, a picture
 * the customer sent) or caught from the camera. Then the live camera is
 * pointed at the other piece, and how alike the two are is worked out
 * continuously as the phone moves: a likeness out of 100, and what is
 * different about the live one in plain words.
 *
 * One screen, never scrolled.
 */

const sideOf = (r, title) => r && ({
  shades: r.shades, texture: r.texture, corrected: r.corrected,
  img: r.thumb.toDataURL('image/jpeg', 0.8), title,
})

export default function App() {
  const [ref, setRef] = useState(null) // the reference: { shades, texture, corrected, img, title }
  const [live, setLive] = useState(null) // what the camera's square reads now
  const [photo, setPhoto] = useState(null) // a photo being read for the reference
  const [fromPhoto, setFromPhoto] = useState(null) // what the square on that photo reads
  const [shot, setShot] = useState(0) // counts photos, so each one opens fresh
  const pick = useRef(null)

  async function choose(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFromPhoto(null)
    setPhoto(await loadPhoto(file))
    setShot((n) => n + 1)
  }

  const d = ref && live?.shades.length ? distance(ref, live) : null
  const v = d !== null ? verdict(d) : null
  const said = d !== null ? difference(ref, live) : []

  return (
    <div className="app">
      <header className="top">
        <img className="logo" src="/icon.svg" alt="" />
        <div className="title">Mica Match</div>
      </header>

      <main className="page">
        {/* The reference. */}
        <div className="refcard">
          {ref?.img ? <img src={ref.img} alt="Reference" /> : <div className="nophoto">A</div>}
          <div className="ref-text">
            <div className="code one">{ref ? `Reference · ${ref.title}` : 'Reference'}</div>
            {ref ? <Shades shades={ref.shades} height={8} /> : <div className="muted">From a photo, or aim the camera and tap Use camera</div>}
          </div>
          <div className="ref-actions">
            <button type="button" className="glass" onClick={() => pick.current?.click()}>{ref ? 'New photo' : 'Photo'}</button>
            <button
              type="button"
              className="primary"
              disabled={!!photo || !live?.shades.length}
              onClick={() => setRef(sideOf(live, 'camera'))}
            >
              Use camera
            </button>
          </div>
          <input ref={pick} type="file" accept="image/*" hidden onChange={choose} />
        </div>

        {/* The camera stays running underneath; a photo being read for the
            reference is laid over it, so closing the photo never has to wait
            for the camera to open again. */}
        <div className="stack">
          <Capture onRead={setLive} hint={ref ? 'Aim the square at the other piece' : 'Aim at the first piece, then Use camera'} />
          {photo && (
            <div className="over">
              <PhotoCapture
                key={shot}
                initial={photo}
                own={false}
                onRead={setFromPhoto}
                hint="Drag the square onto the chip"
                extra={(
                  <>
                    <button type="button" className="glass" onClick={() => setPhoto(null)}>Cancel</button>
                    <button
                      type="button"
                      className="primary"
                      disabled={!fromPhoto?.shades.length}
                      onClick={() => { setRef(sideOf(fromPhoto, 'photo')); setPhoto(null) }}
                    >
                      Use this
                    </button>
                  </>
                )}
              />
            </div>
          )}
        </div>

        {/* How alike they are, live. */}
        <div className="compare-result">
          {photo ? (
            <span className="muted">Put the square on the chip in the photo, then Use this</span>
          ) : !ref ? (
            <span className="muted">Set a reference first — then point the camera at the other piece</span>
          ) : d === null ? (
            <span className="muted">Point the square at the other piece</span>
          ) : (
            <>
              <div className={`score ${v.tone}`}>{similarity(d)}%</div>
              <div className="compare-text">
                <div className={`verdict ${v.tone}`}><span>{v.word}</span><span className="muted">difference {d.toFixed(1)}</span></div>
                <div className="muted">{said.length ? `Live one is ${said.join(', ')}` : 'No difference you would see'}</div>
                {(!ref.corrected || !live.corrected) && <div className="warn">Keep white paper in the dashed frame</div>}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
