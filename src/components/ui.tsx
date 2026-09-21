import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

/**
 * The body of a page.
 *
 * There were five of these written out by hand — `p-3 sm:p-4 md:p-6` here,
 * `p-4 md:p-6` there, `max-w-lg mx-auto` on the scanner — and three different
 * maximum widths, so the panel changed size as you walked through it. This is
 * the one shape, and it matches the ledger's `.app`, so crossing between the
 * two halves no longer moves the page under the operator.
 */
export function Page({
  children,
  narrow = false,
  className = '',
}: {
  children: ReactNode
  /** For a form that should not run the full width of a shop laptop. */
  narrow?: boolean
  className?: string
}) {
  return (
    <div
      className={`mx-auto w-full space-y-4 px-3 pb-16 pt-3 sm:px-4 md:px-[18px] md:pt-4 ${
        narrow ? 'max-w-2xl' : 'max-w-[1280px]'
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="no-print border-b border-stone-200/80 bg-stone-50/95 px-3 py-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-stone-950/90 sm:px-4 md:px-6 md:py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight text-stone-950 dark:text-stone-50 md:text-xl">{title}</h1>
          {subtitle && <p className="text-sm font-medium text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'outline' }) {
  const styles = {
    primary: 'border-transparent bg-[var(--brass)] text-[var(--brass-ink)] shadow-sm enabled:hover:brightness-105',
    ghost: 'border-transparent text-[var(--muted)] enabled:hover:bg-[var(--card2)] enabled:hover:text-[var(--fg)]',
    danger: 'border-transparent bg-shiv-red text-white enabled:hover:bg-[#851719]',
    outline:
      'border-stone-300 bg-stone-50 text-stone-700 enabled:hover:border-shiv-green enabled:hover:bg-stone-100 dark:border-white/15 dark:bg-white/5 dark:text-stone-100 dark:enabled:hover:bg-white/10',
  }[variant]
  return (
    <button
      className={`panel-button ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({ label, className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>}
      <input
        className={`w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 ${className}`}
        {...props}
      />
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200/90 bg-stone-50 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 ${className}`}>{children}</div>
}

/** Styled select dropdown — consistent across all screens. */
export function Select({
  label,
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>}
      <div className="relative">
        <select
          className={`w-full appearance-none rounded-lg border border-stone-300 bg-stone-50 py-2 pl-3 pr-9 text-sm font-medium text-stone-800 outline-none transition focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 ${className}`}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
    </label>
  )
}

/** iOS-style sliding toggle switch. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
}) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-3 text-sm font-medium text-stone-600 select-none dark:text-stone-300">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-shiv-green/40 ${
          checked ? 'bg-shiv-green' : 'bg-stone-300 dark:bg-stone-700'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      {label}
    </label>
  )
}

/**
 * Custom styled dropdown — replaces native <select>.
 * options: string[] or { value, label }[]
 */
export function DropDown({
  value,
  onChange,
  options,
  placeholder,
  className = '',
  disabled = false,
  navigable = false,
  onNavKey,
  onCommit,
}: {
  value: string
  onChange: (v: string) => void
  options: string[] | { value: string; label: string }[]
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Join a keyboard field chain (adds data-bill-nav to the trigger). */
  navigable?: boolean
  /** Called for keys this dropdown doesn't own — lets the page move focus on. */
  onNavKey?: (e: React.KeyboardEvent) => void
  /** Fired after a value is taken, so the page can advance to the next field. */
  onCommit?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const normalised = (options as Array<string | { value: string; label: string }>).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  )

  const selected = normalised.find((o) => o.value === value)

  /**
   * Opening on a value already chosen lands on that value, not the top of the
   * list. The highlight is both what Enter takes and the only thing saying
   * where you are, so starting at the first row made a list of twenty units
   * say nothing about which one the line was already using — and Enter would
   * swap it for whichever sorts first.
   */
  useEffect(() => {
    if (!open) return
    const at = normalised.findIndex((o) => o.value === value)
    setHl(at >= 0 ? at : 0)
    // Only when it opens, and when the value beneath it changes: `normalised`
    // is rebuilt every render and would put the highlight back continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-hl="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [hl, open])

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('touchstart', handle)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('touchstart', handle)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        {...(navigable ? { 'data-bill-nav': '1' } : {})}
        onFocus={() => {
          // Tally opens the list as soon as the field is reached.
          if (!navigable || disabled) return
          setHl(Math.max(0, normalised.findIndex((o) => o.value === value)))
          setOpen(true)
        }}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (open) {
            // While the list is showing, the arrows belong to it.
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setHl((h) => Math.min(normalised.length - 1, Math.max(0, h + (e.key === 'ArrowDown' ? 1 : -1))))
              return
            }
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              const pick = normalised[hl]
              if (pick) onChange(pick.value)
              setOpen(false)
              // Tally accepts the line and moves on in one keystroke.
              if (e.key === 'Enter') onCommit?.()
              return
            }
            if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault()
              setHl(e.key === 'Home' ? 0 : normalised.length - 1)
              return
            }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
            return
          }
          // Closed: Enter or Space opens it, anything else is the page's business.
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setHl(Math.max(0, normalised.findIndex((o) => o.value === value)))
            setOpen(true)
            return
          }
          onNavKey?.(e)
        }}
        className={`flex w-full items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors
          ${open
            ? 'border-shiv-green bg-white text-stone-900 shadow-sm shadow-shiv-green/20 dark:bg-stone-800 dark:text-white'
            : 'border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-300 dark:border-white/10 dark:bg-stone-800 dark:text-stone-200'
          } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span className="truncate">{selected?.label ?? placeholder ?? '—'}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg shadow-stone-900/10 dark:border-white/10 dark:bg-stone-900">
          <div ref={listRef} className="max-h-52 overflow-y-auto py-1">
            {normalised.map((opt, i) => {
              const active = opt.value === value
              // `active` is the saved value; `hl` is where the keyboard is. They
              // start together but move apart as soon as you press an arrow, so
              // both need to be visible or the arrows look like they do nothing.
              const highlighted = i === hl
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-hl={highlighted ? '1' : undefined}
                  onMouseEnter={() => setHl(i)}
                  onMouseDown={() => { onChange(opt.value); setOpen(false) }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors
                    ${highlighted ? 'bg-stone-100 dark:bg-white/10' : ''}
                    ${active
                      ? 'font-semibold text-stone-900 dark:text-white'
                      : 'text-stone-700 dark:text-stone-200'
                    }`}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {active && <Check size={13} className="shrink-0 text-shiv-green" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
