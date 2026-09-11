import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Info, X } from 'lucide-react'

/**
 * What the panel says back.
 *
 * It used `alert()` — an operating-system dialog that stops the browser dead
 * and has to be dismissed with the mouse. In a till app driven from the
 * keyboard, where saving a bill is Ctrl+A and the next customer is already at
 * the counter, that is the worst interruption available: the shop learns to
 * hit Enter through it without reading, which is exactly how a failed save
 * goes unnoticed.
 *
 * So: a line in the corner. Good news clears itself; a failure stays until it
 * is dismissed, because a failure is something somebody has to act on.
 */

export type ToastKind = 'ok' | 'error' | 'info'
type Toast = { id: number; kind: ToastKind; text: string }

let nextId = 1
const listeners = new Set<(t: Toast[]) => void>()
let toasts: Toast[] = []

function publish() {
  for (const listener of listeners) listener(toasts)
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  publish()
}

/** Say something. Errors wait to be dismissed; anything else fades. */
export function toast(text: string, kind: ToastKind = 'ok') {
  const id = nextId++
  toasts = [...toasts, { id, kind, text }]
  publish()
  if (kind !== 'error') setTimeout(() => dismiss(id), 3200)
  return id
}

const ICONS = { ok: Check, error: AlertTriangle, info: Info }

/** Mounted once, in the layout. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>(toasts)

  useEffect(() => {
    listeners.add(setItems)
    return () => { listeners.delete(setItems) }
  }, [])

  if (!items.length) return null

  return (
    <div
      className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-bottom-nav-space)+0.5rem)] z-[60] flex flex-col items-center gap-2 px-3 sm:bottom-4 sm:left-auto sm:right-4 sm:items-end sm:px-0"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium shadow-lg ${
              t.kind === 'error'
                ? 'border-danger/40 bg-card text-danger'
                : t.kind === 'ok'
                  ? 'border-line bg-card text-ink'
                  : 'border-line bg-card text-muted'
            }`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{t.text}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="-m-2 shrink-0 p-2 text-muted hover:text-ink"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
