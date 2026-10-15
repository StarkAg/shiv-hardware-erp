/**
 * A bill's photo docked beside a form, to fill the form in from the paper:
 * the bill screen (typing a bill from its photo) and the guarantee card
 * screen (making a card from a bill).
 */
import type React from 'react'

/** How big the docked bill is, kept on this PC between bills. */
export type DockSize = { w: number; h: number }
const DOCK_KEY = 'shiv.billDock'
export function readDockSize(): DockSize {
  const fallback = { w: Math.round(Math.min(640, Math.max(360, window.innerWidth * 0.34))), h: Math.round(window.innerHeight * 0.42) }
  try {
    const kept = JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null')
    return kept && kept.w > 0 && kept.h > 0 ? kept : fallback
  } catch {
    return fallback
  }
}

/**
 * The bill photo kept open while the bill is typed from it: down the right of
 * the screen on a computer (beside the item list), across the bottom on a
 * phone. Its edge drags to make it wider or taller. The form makes room for
 * it rather than going under it, and typing carries on in the form.
 */
export function BillDock({ size, onResize, children, besideList = true, listFolded = false }: {
  size: DockSize
  onResize: (size: DockSize) => void
  children: React.ReactNode
  /** The bill screen keeps a list panel down the right on a wide screen; the dock sits beside it. */
  besideList?: boolean
  /** The List panel is folded to a strip, so the dock moves out to it. */
  listFolded?: boolean
}) {
  const drag = (event: React.PointerEvent, side: 'w' | 'h') => {
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY, ...size }
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    let next = size
    const move = (e: Event) => {
      const { clientX, clientY } = e as PointerEvent
      next = side === 'w'
        ? { ...size, w: Math.round(Math.min(window.innerWidth * 0.7, Math.max(280, start.w + start.x - clientX))) }
        : { ...size, h: Math.round(Math.min(window.innerHeight * 0.75, Math.max(160, start.h + start.y - clientY))) }
      onResize(next)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      try { localStorage.setItem(DOCK_KEY, JSON.stringify(next)) } catch { /* the size just isn't kept */ }
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  return (
    <aside
      className={`no-print fixed inset-x-0 bottom-[var(--mobile-bottom-nav-space)] z-30 h-[var(--dock-h)] px-1.5 pt-3 md:inset-x-auto md:bottom-auto md:right-0 md:top-0 md:h-screen md:w-[var(--dock-w)] md:pb-2 md:pl-3 md:pr-2 md:pt-2 ${besideList ? (listFolded ? 'xl:right-7' : 'xl:right-80 2xl:right-96') : ''}`}
      style={{ '--dock-w': size.w + 'px', '--dock-h': size.h + 'px' } as React.CSSProperties}
      aria-label="Bill photo"
    >
      {/* Phone: the top edge drags up and down. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize the bill photo"
        onPointerDown={(e) => drag(e, 'h')}
        className="absolute inset-x-0 top-0 flex h-4 cursor-row-resize touch-none items-center justify-center md:hidden"
      >
        <span className="h-1 w-12 rounded-full bg-stone-400 dark:bg-stone-500" />
      </div>
      {/* Computer: the left edge drags left and right. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the bill photo"
        onPointerDown={(e) => drag(e, 'w')}
        className="absolute inset-y-0 left-0 hidden w-3 cursor-col-resize touch-none items-center justify-center hover:bg-shiv-green/20 md:flex"
      >
        <span className="h-12 w-1 rounded-full bg-stone-400 dark:bg-stone-500" />
      </div>
      <div className="h-full">{children}</div>
    </aside>
  )
}
