import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  Loader2,
  Minus,
  Plus,
  ScanLine,
} from 'lucide-react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

// One dedicated worker for the whole viewer session.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()

/**
 * Feeds pdf.js only the byte ranges it asks for, read straight off the picked
 * File via Blob.slice — so a multi-GB PDF is never loaded into memory at once.
 */
class FileRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  private file: File
  constructor(file: File) {
    super(file.size, new Uint8Array(0), false)
    this.file = file
  }
  requestDataRange(begin: number, end: number): void {
    this.file
      .slice(begin, end)
      .arrayBuffer()
      .then((buf) => this.onDataRange(begin, new Uint8Array(buf)))
      .catch(() => {})
  }
  abort(): void {}
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function PdfViewer() {
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)

  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [scale, setScale] = useState(1)
  const [status, setStatus] = useState<'empty' | 'opening' | 'ready' | 'rendering' | 'error'>('empty')
  const [error, setError] = useState('')

  // Fit the current page to the container width, return the scale used.
  const fitWidthScale = useCallback(async (pdf: PDFDocumentProxy, page = 1) => {
    const p = await pdf.getPage(page)
    const unscaled = p.getViewport({ scale: 1 })
    const avail = (scrollRef.current?.clientWidth ?? 800) - 24 // padding
    return Math.max(0.2, Math.min(4, avail / unscaled.width))
  }, [])

  const openFile = async (file: File) => {
    setError('')
    setStatus('opening')
    setFileMeta({ name: file.name, size: file.size })
    // Tear down any previous document.
    renderTaskRef.current?.cancel()
    if (pdfRef.current) {
      try { await pdfRef.current.destroy() } catch { /* ignore */ }
      pdfRef.current = null
    }
    try {
      const loadingTask = pdfjsLib.getDocument({
        range: new FileRangeTransport(file),
        disableAutoFetch: true, // only fetch ranges we actually view
        disableStream: true,
      })
      const pdf = await loadingTask.promise
      pdfRef.current = pdf
      setNumPages(pdf.numPages)
      setPageNum(1)
      setScale(await fitWidthScale(pdf, 1))
      setStatus('ready')
    } catch (e) {
      console.error(e)
      setError('Could not open this PDF. It may be corrupt or password-protected.')
      setStatus('error')
    }
  }

  const renderPage = useCallback(async (n: number, s: number) => {
    const pdf = pdfRef.current
    const canvas = canvasRef.current
    if (!pdf || !canvas) return
    renderTaskRef.current?.cancel()
    setStatus('rendering')
    try {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: s })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const task = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      renderTaskRef.current = task
      await task.promise
      setStatus('ready')
    } catch (e: unknown) {
      // Cancellations are expected when flipping pages quickly.
      if ((e as { name?: string })?.name !== 'RenderingCancelledException') {
        console.error(e)
      }
    }
  }, [])

  // Re-render whenever the page or zoom changes.
  useEffect(() => {
    if (status === 'empty' || status === 'opening' || status === 'error') return
    void renderPage(pageNum, scale)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [pageNum, scale]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel()
      pdfRef.current?.destroy().catch(() => {})
    }
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void openFile(f)
    e.target.value = ''
  }

  const goTo = (n: number) => {
    if (!numPages) return
    setPageNum(Math.min(numPages, Math.max(1, n)))
  }

  const busy = status === 'opening' || status === 'rendering'

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200/80 bg-stone-50/80 px-3 py-2 dark:border-white/10 dark:bg-stone-950/60">
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-lg bg-shiv-green px-3 py-2 text-sm font-semibold text-stone-950 shadow-sm transition hover:brightness-95"
        >
          <FileUp size={16} /> Open PDF
        </button>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={onPick} className="hidden" />

        {fileMeta && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-stone-700 dark:text-stone-200">{fileMeta.name}</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">{formatBytes(fileMeta.size)}</p>
          </div>
        )}

        {status !== 'empty' && status !== 'error' && (
          <div className="ml-auto flex items-center gap-2">
            {/* Page controls */}
            <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-1 dark:border-white/10 dark:bg-stone-900">
              <button onClick={() => goTo(pageNum - 1)} disabled={pageNum <= 1} className="rounded p-1 text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-white/10">
                <ChevronLeft size={18} />
              </button>
              <input
                type="number"
                value={pageNum}
                min={1}
                max={numPages || 1}
                onChange={(e) => goTo(Number(e.target.value))}
                className="w-12 bg-transparent text-center text-sm text-stone-700 outline-none dark:text-stone-200"
              />
              <span className="pr-1 text-sm text-stone-500 dark:text-stone-400">/ {numPages}</span>
              <button onClick={() => goTo(pageNum + 1)} disabled={pageNum >= numPages} className="rounded p-1 text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-white/10">
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-1 dark:border-white/10 dark:bg-stone-900">
              <button onClick={() => setScale((s) => Math.max(0.2, +(s - 0.2).toFixed(2)))} className="rounded p-1 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10">
                <Minus size={16} />
              </button>
              <span className="w-12 text-center text-sm tabular-nums text-stone-600 dark:text-stone-300">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale((s) => Math.min(4, +(s + 0.2).toFixed(2)))} className="rounded p-1 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10">
                <Plus size={16} />
              </button>
              <button
                onClick={async () => { if (pdfRef.current) setScale(await fitWidthScale(pdfRef.current, pageNum)) }}
                title="Fit width"
                className="rounded p-1 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10"
              >
                <ScanLine size={16} />
              </button>
            </div>
            {busy && <Loader2 size={18} className="animate-spin text-stone-400" />}
          </div>
        )}
      </div>

      {/* Viewport */}
      <div ref={scrollRef} className="relative flex-1 overflow-auto bg-stone-200/60 p-3 dark:bg-black/40">
        {status === 'empty' && (
          <button
            onClick={() => inputRef.current?.click()}
            className="mx-auto mt-16 flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center text-stone-500 transition hover:border-shiv-green hover:text-stone-700 dark:border-white/15 dark:text-stone-400 dark:hover:text-stone-200"
          >
            <FileUp size={28} />
            <span className="text-sm font-semibold">Open a PDF from this device</span>
            <span className="text-xs">Large files open instantly — pages load as you read</span>
          </button>
        )}

        {status === 'opening' && (
          <div className="mt-24 flex flex-col items-center gap-3 text-stone-500 dark:text-stone-400">
            <Loader2 size={28} className="animate-spin" />
            <span className="text-sm">Opening…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="mx-auto mt-24 max-w-sm rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-center text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        {(status === 'ready' || status === 'rendering') && (
          <div className="flex justify-center">
            <canvas ref={canvasRef} className="rounded shadow-lg" />
          </div>
        )}
      </div>
    </div>
  )
}
