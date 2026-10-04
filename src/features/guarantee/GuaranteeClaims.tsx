import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Link } from 'react-router-dom'
import { ExternalLink, Mail, Phone } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { Button, Card, Page, PageHeader } from '../../components/ui'
import { toast } from '../../components/Toast'

/**
 * Claims customers file from a guarantee card's page (convex/guaranteeClaims.ts).
 *
 * Waiting claims come first and turn red once a week has gone by without a
 * decision: an unanswered claim is the complaint that ends up at a consumer
 * forum. Every decision is kept with its note, which the customer reads on
 * their card page; a refusal cannot be saved without its reason.
 */

type Status = Doc<'guaranteeClaims'>['status']
type Claim = Doc<'guaranteeClaims'> & {
  cardPhotoUrl: string | null
  billPhotoUrl: string | null
  doorPhotoUrl: string | null
  photoUrls: string[]
}

const STATUS: Record<Status, { label: string; tone: string }> = {
  new: { label: 'Received', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  reviewing: { label: 'Under review', tone: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  approved: { label: 'Approved', tone: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  rejected: { label: 'Not approved', tone: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  replaced: { label: 'Replaced', tone: 'bg-stone-200 text-stone-800 dark:bg-white/10 dark:text-stone-200' },
}
const ISSUE: Record<Claim['issue'], string> = { borer: 'Borer', air: 'Air bubbles', cracks: 'Cracks' }
const WAITING: Status[] = ['new', 'reviewing']
const DUE_DAYS = 7
const DAY = 24 * 60 * 60 * 1000

const FILTERS: { key: string; label: string; match: (s: Status) => boolean }[] = [
  { key: 'waiting', label: 'Waiting', match: (s) => WAITING.includes(s) },
  { key: 'approved', label: 'Approved', match: (s) => s === 'approved' },
  { key: 'rejected', label: 'Not approved', match: (s) => s === 'rejected' },
  { key: 'replaced', label: 'Replaced', match: (s) => s === 'replaced' },
  { key: 'all', label: 'All', match: () => true },
]

const ago = (at: number) => {
  const days = Math.floor((Date.now() - at) / DAY)
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/** `cardLinks`: link each claim to the card in Guarantee History (Shiv Quotation has it; the panel does not). */
export function GuaranteeClaims({ cardLinks = false }: { cardLinks?: boolean }) {
  const convexReady = Boolean(import.meta.env.VITE_CONVEX_URL)
  return (
    <Page>
      <PageHeader title="Guarantee Claims" subtitle="Filed by customers from their card's QR page" />
      {convexReady ? <ClaimList cardLinks={cardLinks} /> : <Card className="p-6 text-sm text-muted">Claims need the cloud connection (VITE_CONVEX_URL).</Card>}
    </Page>
  )
}

function ClaimList({ cardLinks }: { cardLinks: boolean }) {
  const claims = useQuery(api.guaranteeClaims.list, {}) as Claim[] | undefined
  const [filter, setFilter] = useState('waiting')

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const f of FILTERS) out[f.key] = (claims ?? []).filter((c) => f.match(c.status)).length
    return out
  }, [claims])

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]
    const list = (claims ?? []).filter((c) => f.match(c.status))
    // Waiting: oldest first, so the one most overdue is on top. Others: newest first.
    return filter === 'waiting' ? [...list].sort((a, b) => a.createdAt - b.createdAt) : list
  }, [claims, filter])

  if (claims === undefined) return <Card className="p-6 text-sm text-muted">Loading claims…</Card>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter claims">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
              filter === f.key
                ? 'border-shiv-green bg-shiv-green text-stone-950'
                : 'border-stone-300 bg-stone-50 text-stone-600 hover:border-shiv-green dark:border-white/15 dark:bg-white/5 dark:text-stone-300'
            }`}
          >
            {f.label} <span className="ml-1 opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          {filter === 'waiting' ? 'No claims waiting. Every claim has a decision.' : 'No claims here.'}
        </Card>
      ) : (
        shown.map((c) => <ClaimCard key={c._id} claim={c} cardLink={cardLinks} />)
      )}
    </div>
  )
}

function ClaimCard({ claim, cardLink }: { claim: Claim; cardLink: boolean }) {
  const setStatus = useMutation(api.guaranteeClaims.setStatus)
  const [status, setStatusValue] = useState<Status>(claim.status)
  const [note, setNote] = useState(claim.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const waiting = WAITING.includes(claim.status)
  const overdue = waiting && Date.now() - claim.createdAt > DUE_DAYS * DAY
  const changed = status !== claim.status || note.trim() !== (claim.note ?? '')
  const needsReason = status === 'rejected' && !note.trim()

  const photos = [
    { label: 'Guarantee card', url: claim.cardPhotoUrl },
    { label: 'Bill', url: claim.billPhotoUrl },
    { label: 'Door with card', url: claim.doorPhotoUrl },
    ...claim.photoUrls.map((url, i) => ({ label: `Close-up ${i + 1}`, url })),
  ].filter((p): p is { label: string; url: string } => Boolean(p.url))

  async function save() {
    if (needsReason) return setError('Write the reason it is not approved. The customer sees it.')
    setSaving(true)
    setError('')
    try {
      await setStatus({ id: claim._id as Id<'guaranteeClaims'>, status, note })
      toast(`${claim.ref}: ${STATUS[status].label}`)
    } catch (err) {
      const said = (err as { data?: unknown })?.data
      setError(typeof said === 'string' ? said : 'Could not save. Check the connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className={`overflow-hidden text-stone-800 dark:text-stone-100 ${overdue ? 'border-red-400 dark:border-red-500/60' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 px-4 py-2.5 dark:border-white/10">
        <span className="font-mono text-sm font-bold">{claim.ref}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS[claim.status].tone}`}>{STATUS[claim.status].label}</span>
        <span className={`text-xs ${overdue ? 'font-bold text-red-600 dark:text-red-400' : 'text-muted'}`}>
          Received {ago(claim.createdAt)} · {new Date(claim.createdAt).toLocaleDateString('en-GB')}
          {overdue ? ` · past ${DUE_DAYS} days with no decision` : ''}
        </span>
        {cardLink ? (
          <Link to={`/guarantee/history/${encodeURIComponent(claim.number)}`} className="ml-auto flex items-center gap-1 text-xs font-semibold text-muted hover:text-shiv-green">
            Card {claim.number} <ExternalLink size={12} />
          </Link>
        ) : (
          <span className="ml-auto text-xs font-semibold text-muted">Card {claim.number}</span>
        )}
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-base font-bold">{claim.name}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted">
              <a href={`tel:+91${claim.phone}`} className="flex items-center gap-1 hover:text-shiv-green"><Phone size={13} /> {claim.phone}</a>
              <a href={`mailto:${claim.email}`} className="flex items-center gap-1 break-all hover:text-shiv-green"><Mail size={13} /> {claim.email}</a>
            </div>
            <p className="mt-1 text-muted">{claim.address}</p>
          </div>
          <div className="rounded-lg bg-stone-100 px-3 py-2 dark:bg-white/5">
            <p className="font-semibold">{claim.itemLabel}</p>
            <p className="text-muted">
              {ISSUE[claim.issue]} · {claim.doors} {claim.doors === 1 ? 'door' : 'doors'}
            </p>
          </div>
          <p className="whitespace-pre-wrap">{claim.description}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <a key={p.label} href={p.url} target="_blank" rel="noreferrer" className="group block">
              <img
                src={p.url}
                alt={p.label}
                loading="lazy"
                className="aspect-square w-full rounded-lg border border-stone-200 object-cover transition group-hover:border-shiv-green dark:border-white/10"
              />
              <span className="mt-1 block truncate text-[11px] font-semibold text-muted">{p.label}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-stone-100 bg-stone-50/60 px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">Decision</span>
          <select
            value={status}
            onChange={(e) => { setStatusValue(e.target.value as Status); setError('') }}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-shiv-green dark:border-white/15 dark:bg-stone-950"
          >
            {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </label>
        <label className="block min-w-60 flex-1">
          <span className="mb-1 block text-xs font-semibold text-muted">
            Note for the customer (shown on their card page){status === 'rejected' ? ', required: the reason' : ''}
          </span>
          <input
            value={note}
            maxLength={500}
            onChange={(e) => { setNote(e.target.value); setError('') }}
            className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-shiv-green dark:bg-stone-950 ${
              needsReason ? 'border-red-400' : 'border-stone-300 dark:border-white/15'
            }`}
          />
        </label>
        <Button onClick={save} disabled={!changed || saving} className="px-5 py-2">
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {error && <p className="w-full text-sm font-semibold text-danger" role="alert">{error}</p>}
      </div>
    </Card>
  )
}

/** The number of claims waiting on the shop, for the menu. Mount only with a cloud connection. */
export function ClaimsBadge() {
  const open = useQuery(api.guaranteeClaims.openCount, {})
  if (!open) return null
  return (
    <span className="min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white" aria-label={`${open} claims waiting`}>
      {open}
    </span>
  )
}
