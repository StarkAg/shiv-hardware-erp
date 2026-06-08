import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

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
          {subtitle && <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
    primary: 'bg-shiv-green text-stone-950 shadow-sm shadow-amber-900/10 hover:bg-[#c6a15a]',
    ghost: 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10',
    danger: 'bg-shiv-red text-white hover:bg-[#851719]',
    outline:
      'border border-stone-300 bg-stone-50 text-stone-700 hover:border-shiv-green hover:bg-stone-100 dark:border-white/15 dark:bg-white/5 dark:text-stone-100 dark:hover:bg-white/10',
  }[variant]
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({ label, className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">{label}</span>}
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
      {label && <span className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">{label}</span>}
      <div className="relative">
        <select
          className={`w-full appearance-none rounded-lg border border-stone-300 bg-stone-50 py-2 pl-3 pr-9 text-sm font-medium text-stone-800 outline-none transition focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 ${className}`}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500"
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
}: {
  value: string
  onChange: (v: string) => void
  options: string[] | { value: string; label: string }[]
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const normalised = (options as Array<string | { value: string; label: string }>).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  )

  const selected = normalised.find((o) => o.value === value)

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
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors
          ${open
            ? 'border-shiv-green bg-white text-stone-900 shadow-sm shadow-shiv-green/20 dark:bg-stone-800 dark:text-white'
            : 'border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-300 dark:border-white/10 dark:bg-stone-800 dark:text-stone-200'
          } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span className="truncate">{selected?.label ?? placeholder ?? '—'}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg shadow-stone-900/10 dark:border-white/10 dark:bg-stone-900">
          <div className="max-h-52 overflow-y-auto py-1">
            {normalised.map((opt) => {
              const active = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onMouseDown={() => { onChange(opt.value); setOpen(false) }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors
                    ${active
                      ? 'bg-shiv-green/10 font-semibold text-stone-900 dark:text-white'
                      : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-white/5'
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
