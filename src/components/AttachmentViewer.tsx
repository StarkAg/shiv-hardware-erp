import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, FileText, Maximize2, Minus, Plus, RotateCw, Scan, X } from 'lucide-react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { attachmentName, isPdfAttachment, type Attachment } from '../lib/attachments'
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

export default function AttachmentViewer({ attachments, title = 'Attachments', subtitle, initialIndex = 0, onClose, onDownloadPdf, loading = false, docked = false, onExpand, toolsBefore }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, attachments.length - 1)))
  const at = Math.min(index, Math.max(0, attachments.length - 1))
  const file = attachments[at]
  const [zoom, setZoom] = useState(1)
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

  useEffect(() => {
    setZoom(1); setRotation(0); setPage(1); setImageError(false); setActionError('')
    setNatural({ width: 800, height: 1100 })
    stage.current?.scrollTo(0, 0)
  }, [at, file?.url])

  useEffect(() => {
    setImageError(false)
    stage.current?.scrollTo(0, 0)
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
      setZoom(1); setRotation(0); setPage(1); setImageError(false)
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
  const rotated = rotation % 180 !== 0
  const width = rotated ? natural.height : natural.width
  const height = rotated ? natural.width : natural.height
  // Docked, the bill fills the width and scrolls down: a short strip under
  // the form is read line by line, not shrunk to a thumbnail.
  const fit = docked ? (area.width - 16) / width : Math.min((area.width - 32) / width, (area.height - 32) / height)
  const scale = Math.max(.01, fit) * zoom
  const error = !file ? 'No attachments to show.' : !file.url && !file.previewUrl ? 'This attachment is no longer available.' : pdf ? rendered.error : imageError ? 'Could not load this photo. Please try again.' : ''

  const tools = (
        <div className="attachment-tools" aria-label="Preview controls">
          {toolsBefore}
          <button type="button" onClick={() => changeZoom(-.5)} disabled={zoom <= 1 || !shown} aria-label="Zoom out"><Minus size={18} /></button>
          <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={() => changeZoom(.5)} disabled={zoom >= 5 || !shown} aria-label="Zoom in"><Plus size={18} /></button>
          <button type="button" onClick={() => { setZoom(1); stage.current?.scrollTo(0, 0) }} disabled={!shown} aria-label="Fit to window"><Scan size={18} /><span className="attachment-action-label">Fit</span></button>
          <button type="button" onClick={() => setRotation(current => (current + 90) % 360)} disabled={!shown} aria-label="Rotate clockwise"><RotateCw size={18} /></button>
          {!docked && <button type="button" onClick={() => void action('file', download)} disabled={!!busy || !file?.url} aria-label="Download original file"><Download size={18} /><span className="attachment-action-label">{busy === 'file' ? 'Downloading…' : 'Download'}</span></button>}
          {onDownloadPdf && !docked && <button type="button" onClick={() => void action('pdf', onDownloadPdf)} disabled={!!busy}>{busy === 'pdf' ? 'Making PDF…' : 'Photos as PDF'}</button>}
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
          {docked ? tools : <div className="attachment-heading"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>}
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
            : shown && <div className="attachment-center"><div className="attachment-sheet" style={{ width: width * scale, height: height * scale }}>
              <img key={shown + ':' + attempt} src={shown} alt={file?.label || 'Attachment ' + (at + 1)} draggable={false}
                onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                onError={() => setImageError(true)}
                onDoubleClick={() => setZoom(current => current === 1 ? 2 : 1)}
                style={{ width: natural.width * scale, height: natural.height * scale, left: (width - natural.width) * scale / 2, top: (height - natural.height) * scale / 2, transform: 'rotate(' + rotation + 'deg)' }} />
            </div></div>}
        </div>
        <footer className="attachment-footer">
          <button type="button" onClick={() => turn(-1)} disabled={at === 0 && (!pdf || page === 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
          <span aria-live="polite">{file?.label ? file.label + ' · ' : ''}Attachment {attachments.length ? at + 1 : 0} of {attachments.length}{pdf && rendered.pages > 1 ? ' · PDF page ' + page + ' of ' + rendered.pages : ''}</span>
          <button type="button" onClick={() => turn(1)} disabled={at >= attachments.length - 1 && (!pdf || page >= rendered.pages)} aria-label="Next page"><ChevronRight size={18} /></button>
        </footer>
      </section>
    </Shell>
  )
  return docked ? shell : createPortal(shell, document.body)
}
