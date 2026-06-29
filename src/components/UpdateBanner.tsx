import { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import {
  checkForUpdate,
  installAndroidUpdate,
  isAndroidApp,
  isDesktopApp,
  type UpdateInfo,
} from '../lib/appUpdate'

type DesktopUpdateState = {
  status: string
  version?: string
  progress?: number
  info?: { version?: string } | null
}

/**
 * One banner, one source (GitHub Releases).
 *  • Android  → checks for a newer APK and offers to download + install it.
 *  • Desktop  → mirrors electron-updater's status (download / restart prompt).
 *  • Web/dev  → renders nothing.
 */
export function UpdateBanner() {
  const [android, setAndroid] = useState<UpdateInfo | null>(null)
  const [desktop, setDesktop] = useState<DesktopUpdateState | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // ── Android: poll the single source on launch ──────────────────────────────
  useEffect(() => {
    if (!isAndroidApp()) return
    let alive = true
    checkForUpdate().then((info) => {
      if (alive && info?.available) setAndroid(info)
    })
    return () => {
      alive = false
    }
  }, [])

  // ── Desktop: subscribe to electron-updater status ──────────────────────────
  useEffect(() => {
    if (!isDesktopApp()) return
    const api = window.shivDesktop
    api?.getUpdateState?.().then((s) => s && setDesktop(s as DesktopUpdateState))
    const off = api?.onUpdateStatus?.((s) => setDesktop(s as DesktopUpdateState))
    return () => off?.()
  }, [])

  if (dismissed) return null

  // ── Desktop banner ─────────────────────────────────────────────────────────
  if (desktop) {
    if (desktop.status === 'downloading') {
      return (
        <Bar tone="info">
          <RefreshCw size={16} className="animate-spin shrink-0" />
          <span>
            Downloading update{typeof desktop.progress === 'number' ? ` — ${desktop.progress}%` : '…'}
          </span>
        </Bar>
      )
    }
    if (desktop.status === 'downloaded') {
      return (
        <Bar tone="success" onDismiss={() => setDismissed(true)}>
          <Download size={16} className="shrink-0" />
          <span>Update {desktop.info?.version ?? ''} ready.</span>
          <button
            onClick={() => window.shivDesktop?.installUpdate?.()}
            className="ml-2 rounded-md bg-stone-950/10 px-3 py-1 text-xs font-semibold hover:bg-stone-950/20"
          >
            Restart &amp; install
          </button>
        </Bar>
      )
    }
    return null
  }

  // ── Android banner ─────────────────────────────────────────────────────────
  if (android?.available) {
    return (
      <Bar tone="success" onDismiss={() => setDismissed(true)}>
        <Download size={16} className="shrink-0" />
        <span>
          Update available — v{android.latestVersion}
          <span className="opacity-70"> (you have v{android.currentVersion})</span>
        </span>
        <button
          onClick={() => installAndroidUpdate(android)}
          className="ml-2 rounded-md bg-stone-950/10 px-3 py-1 text-xs font-semibold hover:bg-stone-950/20"
        >
          Download &amp; install
        </button>
      </Bar>
    )
  }

  return null
}

function Bar({
  children,
  tone,
  onDismiss,
}: {
  children: React.ReactNode
  tone: 'info' | 'success'
  onDismiss?: () => void
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-shiv-green text-stone-950'
      : 'bg-stone-200 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
  // Fixed overlay (a floating toast) — never participates in page layout, so it
  // can't affect the height-sensitive .mobile-main scroll containers.
  return (
    <div
      className={`no-print fixed left-1/2 top-3 z-[60] flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ring-1 ring-black/10 ${toneClass}`}
      style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
    >
      {children}
      {onDismiss && (
        <button onClick={onDismiss} className="ml-auto opacity-70 hover:opacity-100" aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
    </div>
  )
}
