import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, Eraser, FileText, Maximize2, Minus, Pencil, Plus, RotateCw, Scan, Send, X } from 'lucide-react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { attachmentName, isPdfAttachment, type Attachment } from '../lib/attachments'
import { sendWhatsAppDocument } from '../lib/printServer'
import { shareFile } from '../lib/shareImage'
import './AttachmentViewer.css'

/** PDFs are rendered here too, so phones and desktops have the same preview. */
function usePdfImage(url: string | null | undefined, enabled: boolean, page: number, attempt: number) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [result, setResult] = useState({ source: '', url: '', error: '', loading: false, pages: 1 })
  useEffect(() => {
    setDoc(null)
    setResult({ source: url ?? '', url: '', error: '', loading: enabled, pages: 1 })
    if (!enabled || !url) return
    let disposed = false
    // The PDF reader is loaded the first time a PDF is shown, not with the panel.
    let task: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null = null
    import('../lib/pdfjs').then(({ pdfjs }) => {
      if (disposed) return
      task = pdfjs.getDocument(url)
      return task.promise.then(pdf => {
        if (disposed) return
        setDoc(pdf)
        setResult(current => ({ ...current, pages: pdf.numPages }))
      })
    }).catch(() => {
      if (!disposed) setResult(current => ({ ...current, loading: false, error: 'Could not open this PDF. It may be unavailable or password protected.' }))
    })
    return () => { disposed = true; void task?.destroy().catch(() => {}) }
  }, [url, enabled, attempt])

  useEffect(() => {
    if (!doc) return
    let disposed = false
    let render: RenderTask | undefined
    let objectUrl = ''
    setResult(current => ({ ...current, loading: true, url: '', error: '' }))
    void (async () => {
      try {
        const pdfPage = await doc.getPage(Math.min(page, doc.numPages))
        if (disposed) return
        const base = pdfPage.getViewport({ scale: 1 })
        const viewport = pdfPage.getViewport({ scale: 2000 / Math.max(base.width, base.height) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        render = pdfPage.render({ canvasContext: canvas.getContext('2d')!, viewport, background: '#ffffff' })
        await render.promise
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
        if (disposed) return
        if (!blob) throw new Error('No page image')
        objectUrl = URL.createObjectURL(blob)
        setResult(current => ({ ...current, url: objectUrl, loading: false }))
      } catch (error) {
        if (!disposed && (error as Error).name !== 'RenderingCancelledException') {
          setResult(current => ({ ...current, loading: false, error: 'Could not show this PDF page. Try again or download the file.' }))
        }
      }
    })()
    return () => { disposed = true; render?.cancel(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [doc, page])
  return result.source === (url ?? '') ? result : { url: '', loading: enabled, error: '', pages: 1 }
}

export function AttachmentThumbnail({ file, alt = '' }: { file: Attachment; alt?: string }) {
  const [failed, setFailed] = useState(false)
  const url = file.previewUrl || (!isPdfAttachment(file) ? file.url : null)
  useEffect(() => setFailed(false), [url])
  return (
    <span className="attachment-thumb">
      {url && !failed
        ? <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} />
        : <><FileText size={24} aria-hidden="true" /><span>{isPdfAttachment(file) ? 'PDF' : 'Unavailable'}</span></>}
    </span>
  )
}

/**
 * The photo on screen as a JPG, turned the way it is shown. A JPG not turned
 * goes as it is; the pencil marks never go with it.
 */
async function photoJpeg(url: string, rotation: number): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not fetch this photo. Please try again.')
  const blob = await response.blob()
  if (blob.type === 'image/jpeg' && rotation === 0) return blob
  const image = await createImageBitmap(blob)
  const turned = rotation % 180 !== 0
  const canvas = document.createElement('canvas')
  canvas.width = turned ? image.height : image.width
  canvas.height = turned ? image.width : image.height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(rotation * Math.PI / 180)
  context.drawImage(image, -image.width / 2, -image.height / 2)
  image.close()
  const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .9))
  if (!jpeg) throw new Error('Could not make the JPG. Please try again.')
  return jpeg
}

/** One pencil stroke on a photo: x, y, x, y… in the photo's own pixels, so it stays put through zoom and rotation. */
type Stroke = number[]

/**
 * The pencil's marks, by photo. Kept here rather than in the viewer so they
 * are still on the photo when it goes full screen and comes back. They are a
 * scribble for whoever is reading the photo, never part of it: nothing is
 * saved or downloaded, and a reload wipes them.
 */
const pencilMarks = new Map<string, Stroke[]>()
const NO_MARKS: Stroke[] = []

type Props = {
  attachments: Attachment[]
  title?: string
  subtitle?: string
  initialIndex?: number
  onClose: () => void
  onDownloadPdf?: () => Promise<void>
  loading?: boolean
  /**
   * Shown beside the form rather than over it: no backdrop, the page keeps
   * scrolling and the cursor stays in the box being typed into.
   */
  docked?: boolean
  /** Docked only: open the same file full screen. */
  onExpand?: () => void
  /** Controls of the caller's own, first in the same row as the zoom (the phone queue's ‹ ›). */
  toolsBefore?: React.ReactNode
}

/** How close a photo opens: a little more than the whole page. */
const OPEN_ZOOM = 1.25

/** What a photo shown among others is on (BillViewer photoStrip). */
type Entry = { type: string; number: string; date: string; amount: string; refNo: string; party: string; paper: string }
/** One colour per kind of entry, so a purchase and a sale are told apart at a glance. */
const TYPE_TONE: Record<string, string> = {
  Sale: 'sale', Purchase: 'purchase', Receipt: 'receipt', Payment: 'payment',
  'Goods Return': 'return', Refund: 'return', Quotation: 'quote', 'Goods Received': 'grn',
}

/** The entry a photo is on, as a card: its kind in its colour, number, day, amount, reference. */
function EntryCard({ title, entry }: { title: string; entry: Entry }) {
  const tone = TYPE_TONE[entry.type] ?? 'other'
  return (
    <div className={'attachment-entry tone-' + tone}>
      <div className="attachment-entry-top">
        {entry.type && <span className="attachment-entry-type">{entry.type}</span>}
        <b className="attachment-entry-no">{entry.number}</b>
        {entry.amount ? <b className="attachment-entry-amount">{entry.amount}</b> : <span className="attachment-entry-none">No amount yet</span>}
      </div>
      <div className="attachment-entry-meta">
        {[entry.date, entry.party || title, entry.refNo && 'Ref ' + entry.refNo, entry.paper].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

export default function AttachmentViewer({ attachments, title = 'Attachments', subtitle, initialIndex = 0, onClose, onDownloadPdf, loading = false, docked = false, onExpand, toolsBefore }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, attachments.length - 1)))
  const at = Math.min(index, Math.max(0, attachments.length - 1))
  const file = attachments[at]
  // A bill opens a little closer than the whole page, where its lines can be
  // read without reaching for the zoom; Fit shows the whole page.
  const [zoom, setZoom] = useState(OPEN_ZOOM)
  const [rotation, setRotation] = useState(0)
  const [natural, setNatural] = useState({ width: 800, height: 1100 })
  const [area, setArea] = useState({ width: 800, height: 600 })
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [imageError, setImageError] = useState(false)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState('')
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const pdf = !!file && isPdfAttachment(file)
  const rendered = usePdfImage(file?.url, pdf, page, attempt)
  const shown = pdf ? rendered.url : file?.url || file?.previewUrl
  // A photo shown among others (BillViewer photoStrip) says which entry it is on.
  const caption = (file as { caption?: string } | undefined)?.caption
  const entry = (file as { entry?: Entry } | undefined)?.entry
  const sheet = useRef<HTMLDivElement>(null)
  const [drawing, setDrawing] = useState(false)
  const stroke = useRef<Stroke | null>(null)
  const [, repaint] = useState(0)
  const markKey = (file?.storageId || file?.url || file?.previewUrl || '') + '#' + page
  const marks = pencilMarks.get(markKey) ?? NO_MARKS

  useEffect(() => {
    if (docked) return
    const el = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    el.showModal()
    closeButton.current?.focus()
    return () => {
      el.close()
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  /**
   * Going on to the next bill keeps the zoom and the place zoomed into: bills
   * of one kind put the total, the date, the party in the same spot, so the
   * next one is read where the last one was. Where it was is kept as a share
   * of the page (`held`) and found again once the next photo has its size.
   */
  const held = useRef<{ x: number; y: number } | null>(null)
  const hold = () => {
    const el = stage.current
    held.current = el && zoom > 1
      ? { x: el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth), y: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) }
      : null
  }
  const findHeld = () => requestAnimationFrame(() => {
    const el = stage.current
    const at = held.current
    if (!el) return
    // Not moved on from another bill: the top of the page, across its middle.
    if (!at) { el.scrollTo((el.scrollWidth - el.clientWidth) / 2, 0); return }
    el.scrollTo(at.x * (el.scrollWidth - el.clientWidth), at.y * (el.scrollHeight - el.clientHeight))
  })

  useEffect(() => {
    setPage(1); setImageError(false); setActionError('')
    if (!held.current) stage.current?.scrollTo(0, 0)
  }, [at, file?.url])

  useEffect(() => {
    setImageError(false)
    if (!held.current) stage.current?.scrollTo(0, 0)
  }, [page, shown])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const fit = () => setArea({ width: el.clientWidth, height: el.clientHeight })
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const turn = (by: number) => {
    if (pdf && page + by >= 1 && page + by <= rendered.pages) setPage(page + by)
    else if (at + by >= 0 && at + by < attachments.length) {
      hold()
      setPage(1); setImageError(false)
      setIndex(at + by)
    }
  }
  const changeZoom = (by: number) => setZoom(current => Math.max(1, Math.min(5, current + by)))
  const action = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setActionError('')
    try { await fn() } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not download. Please try again.')
    } finally { setBusy('') }
  }
  const download = async () => {
    if (!file?.url) return
    const response = await fetch(file.url)
    if (!response.ok) throw new Error('Could not download this file. Please try again.')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = attachmentName({ ...file, contentType: blob.type || file.contentType }, at)
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Give the browser time to begin the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  /**
   * The photo on screen straight into the Shiv Hardware WhatsApp group, from
   * the shop's number on the shop PC, with what it is a bill of as its
   * caption. Where the shop PC cannot be reached, the phone's share sheet.
   */
  const [sentToGroup, setSentToGroup] = useState(false)
  const shareToGroup = async () => {
    if (!shown || !file) return
    const jpeg = await photoJpeg(shown, rotation)
    const name = attachmentName(file, at).replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg'
    try {
      await sendWhatsAppDocument('group', jpeg, name, caption || subtitle || title)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!(error instanceof TypeError) && !/Cannot find Shiv Print Server/.test(message)) throw new Error('Not sent on WhatsApp: ' + message)
      await shareFile(jpeg, name, 'image/jpeg')
      return
    }
    setSentToGroup(true)
    setTimeout(() => setSentToGroup(false), 4000)
  }
  const rotated = rotation % 180 !== 0
  const width = rotated ? natural.height : natural.width
  const height = rotated ? natural.width : natural.height
  // Docked, the bill fills the width and scrolls down: a short strip under
  // the form is read line by line, not shrunk to a thumbnail.
  const fit = docked ? (area.width - 16) / width : Math.min((area.width - 32) / width, (area.height - 32) / height)
  const scale = Math.max(.01, fit) * zoom
  /** Where on the photo itself the pointer is, whatever the zoom and rotation. */
  const pointOnPhoto = (event: PointerEvent) => {
    const box = sheet.current!.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)
    const angle = -rotation * Math.PI / 180
    return [
      Math.round((dx * Math.cos(angle) - dy * Math.sin(angle)) / scale + natural.width / 2),
      Math.round((dx * Math.sin(angle) + dy * Math.cos(angle)) / scale + natural.height / 2),
    ]
  }
  const wipeMarks = () => { pencilMarks.delete(markKey); stroke.current = null; repaint(n => n + 1) }
  const error = !file ? 'No attachments to show.' : !file.url && !file.previewUrl ? 'This attachment is no longer available.' : pdf ? rendered.error : imageError ? 'Could not load this photo. Please try again.' : ''

  const tools = (
        <div className="attachment-tools" aria-label="Preview controls">
          {toolsBefore}
          <button type="button" onClick={() => changeZoom(-.5)} disabled={zoom <= 1 || !shown} aria-label="Zoom out"><Minus size={18} /></button>
          <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={() => changeZoom(.5)} disabled={zoom >= 5 || !shown} aria-label="Zoom in"><Plus size={18} /></button>
          <button type="button" onClick={() => { setZoom(1); stage.current?.scrollTo(0, 0) }} disabled={!shown} aria-label="Fit to window"><Scan size={18} /><span className="attachment-action-label">Fit</span></button>
          <button type="button" onClick={() => setRotation(current => (current + 90) % 360)} disabled={!shown} aria-label="Rotate clockwise"><RotateCw size={18} /></button>
          <button type="button" onClick={() => setDrawing(on => !on)} disabled={!shown} aria-pressed={drawing} aria-label="Pencil: mark on the photo" title="Pencil: mark on the photo (not saved)"><Pencil size={18} /></button>
          {marks.length > 0 && <button type="button" onClick={wipeMarks} aria-label="Wipe the pencil marks" title="Wipe the pencil marks"><Eraser size={18} /></button>}
          {!docked && <button type="button" onClick={() => void action('file', download)} disabled={!!busy || !file?.url} aria-label="Download original file"><Download size={18} /><span className="attachment-action-label">{busy === 'file' ? 'Downloading…' : 'Download'}</span></button>}
          {onDownloadPdf && !docked && <button type="button" onClick={() => void action('pdf', onDownloadPdf)} disabled={!!busy}>{busy === 'pdf' ? 'Making PDF…' : 'Photos as PDF'}</button>}
          {!docked && <button type="button" onClick={() => void action('group', shareToGroup)} disabled={!!busy || !shown} aria-label="Share this photo to the Shiv Hardware WhatsApp group" title="Send this photo to the Shiv Hardware group"><Send size={18} /><span className="attachment-action-label">{busy === 'group' ? 'Sending…' : sentToGroup ? 'Sent to group' : 'Share to group'}</span></button>}
        </div>
  )
  const Shell = docked ? 'div' : 'dialog'
  const shell = (
    <Shell ref={dialog as never} className={docked ? 'attachment-dialog attachment-docked' : 'attachment-dialog'} aria-label={title}
      {...(docked ? { role: 'region' } : {
        'aria-modal': 'true',
        onCancel: (event: SyntheticEvent) => { event.preventDefault(); onClose() },
        onMouseDown: (event: MouseEvent) => { if (event.target === event.currentTarget) onClose() },
      })}
      onKeyDown={event => {
        // A preview owns its keys; closing it must not close the voucher too.
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); onClose() }
        else if (event.key === 'ArrowRight') { event.preventDefault(); turn(1) }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); turn(-1) }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(.5) }
        else if (event.key === '-') { event.preventDefault(); changeZoom(-.5) }
      }}>
      <section className="attachment-panel">
        <header className="attachment-header">
          {/* Docked there is no room to spare: the controls share the title's row. */}
          {docked ? tools : entry ? <EntryCard title={title} entry={entry} /> : <div className="attachment-heading"><h2>{title}</h2>{(caption || subtitle) && <p>{caption || subtitle}</p>}</div>}
          {onExpand && <button type="button" onClick={onExpand} aria-label="Full screen" title="Full screen"><Maximize2 size={18} /></button>}
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close preview"><X size={20} /></button>
        </header>
        {!docked && tools}
        {actionError && <div className="attachment-error" role="alert">{actionError}</div>}
        <div ref={stage} className={'attachment-canvas' + (zoom > 1 ? ' is-zoomed' : '') + (dragging ? ' is-dragging' : '')}
          onPointerDown={event => {
            if (event.pointerType !== 'mouse' || event.button !== 0 || zoom <= 1) return
            const el = event.currentTarget
            drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }
            el.setPointerCapture(event.pointerId); setDragging(true); event.preventDefault()
          }}
          onPointerMove={event => {
            if (!drag.current) return
            event.currentTarget.scrollLeft = drag.current.left - event.clientX + drag.current.x
            event.currentTarget.scrollTop = drag.current.top - event.clientY + drag.current.y
          }}
          onPointerUp={() => { drag.current = null; setDragging(false) }}
          onPointerCancel={() => { drag.current = null; setDragging(false) }}>
          {loading ? <div className="attachment-status" role="status">Loading attachments…</div>
            : error ? <div className="attachment-status" role="alert">{error}{file?.url && <p><button type="button" onClick={() => { setImageError(false); setAttempt(current => current + 1) }}>Try again</button></p>}</div>
            : pdf && rendered.loading ? <div className="attachment-status" role="status">Opening PDF…</div>
            : shown && <div className="attachment-center"><div ref={sheet} className="attachment-sheet" style={{ width: width * scale, height: height * scale }}>
              <img key={shown + ':' + attempt} src={shown} alt={file?.label || 'Attachment ' + (at + 1)} draggable={false}
                onLoad={event => { setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); findHeld() }}
                onError={() => setImageError(true)}
                onDoubleClick={() => setZoom(current => current === 1 ? 2 : 1)}
                style={{ width: natural.width * scale, height: natural.height * scale, left: (width - natural.width) * scale / 2, top: (height - natural.height) * scale / 2, transform: 'rotate(' + rotation + 'deg)' }} />
              {/* The pencil's marks, laid exactly over the photo and turned with it. */}
              {(drawing || marks.length > 0) && <svg className={'attachment-marks' + (drawing ? ' is-drawing' : '')} aria-hidden="true"
                viewBox={'0 0 ' + natural.width + ' ' + natural.height}
                style={{ width: natural.width * scale, height: natural.height * scale, left: (width - natural.width) * scale / 2, top: (height - natural.height) * scale / 2, transform: 'rotate(' + rotation + 'deg)' }}
                // The cursor stays in the box being typed into while a line is ticked off.
                onMouseDown={event => event.preventDefault()}
                onPointerDown={event => {
                  if (event.button !== 0) return
                  // The pencil draws; it does not also drag the photo about.
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  stroke.current = pointOnPhoto(event)
                  pencilMarks.set(markKey, [...marks, stroke.current])
                  repaint(n => n + 1)
                }}
                onPointerMove={event => {
                  if (!stroke.current) return
                  stroke.current.push(...pointOnPhoto(event))
                  repaint(n => n + 1)
                }}
                onPointerUp={() => { stroke.current = null }}
                onPointerCancel={() => { stroke.current = null }}>
                {/* A tap is a stroke of one point: drawn to itself, it shows as a dot. */}
                {marks.map((line, i) => <path key={i} d={'M' + line[0] + ' ' + line[1] + 'L' + (line.length > 2 ? line.slice(2) : line).join(' ')} />)}
              </svg>}
            </div></div>}
        </div>
        <footer className="attachment-footer">
          <button type="button" onClick={() => turn(-1)} disabled={at === 0 && (!pdf || page === 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
          <span aria-live="polite" title={caption || file?.label || undefined}>{entry ? '' : file?.label ? file.label + ' · ' : ''}{entry ? 'Photo' : 'Attachment'} {attachments.length ? at + 1 : 0} of {attachments.length}{pdf && rendered.pages > 1 ? ' · PDF page ' + page + ' of ' + rendered.pages : ''}</span>
          <button type="button" onClick={() => turn(1)} disabled={at >= attachments.length - 1 && (!pdf || page >= rendered.pages)} aria-label="Next page"><ChevronRight size={18} /></button>
        </footer>
      </section>
    </Shell>
  )
  return docked ? shell : createPortal(shell, document.body)
}
