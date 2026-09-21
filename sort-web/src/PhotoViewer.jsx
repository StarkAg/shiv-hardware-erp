import { useEffect, useRef, useState } from 'react'

/** Native modal keeps focus inside the viewer and restores it to the opener. */
export default function PhotoViewer({ src, onClose }) {
  const dialog = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const el = dialog.current
    el.showModal()
    return () => el.close()
  }, [])
  return (
    <dialog ref={dialog} className="photo-viewer" aria-label="Bill photo" onCancel={e => { e.preventDefault(); onClose() }}>
      <div className="photo-toolbar">
        <button onClick={onClose} autoFocus aria-label="Close photo">‹ Close</button>
        <div className="photo-zoom">
          <button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - 0.5))}>−</button>
          <button aria-label="Fit photo to screen" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(z => Math.min(4, z + 0.5))}>+</button>
        </div>
      </div>
      {failed ? <p className="photo-error" role="alert">This photo could not load. Close it and try again when connected.</p> : (
        <div className="photo-scroll">
          <div className="photo-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
            <img src={src} alt="Photographed bill" onError={() => setFailed(true)} draggable="false" />
          </div>
        </div>
      )}
      <p className="photo-help">Use + to read the details. Drag to move around.</p>
    </dialog>
  )
}
