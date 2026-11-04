import { useEffect, useState } from 'react'
import { useConvex } from 'convex/react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Confirm from '../ledger/components/Confirm'
import { useStore } from '../../lib/store'
import { Pencil, Printer, Trash2 } from 'lucide-react'
import { CATEGORY_LABELS, type Quotation } from '../../lib/types'
import { enrichQuotation, formatSize } from '../../lib/pricing'
import { Button, Card, Input, Page, PageHeader } from '../../components/ui'
import { PrintPreview } from '../print/PrintPreview'
import { QuotationPrint } from '../print/QuotationPrint'
import { api } from '../../../convex/_generated/api'

type CloudQuotationRow = { localId: string; number: string; updatedAt?: number; customer?: Quotation['customer']; document?: Quotation }

/**
 * Pulls the newest quotations into this device's History each time it opens, so
 * a phone shows what the counter wrote. Not in the desktop app: it has always
 * held only its own, and quotations deleted there before deletions were
 * remembered would come back. Split out so the Convex hook only mounts when a
 * deployment is set.
 */
function CloudQuoteSync() {
  const convex = useConvex()
  const merge = useStore((s) => s.mergeQuotationsFromCloud)
  useEffect(() => {
    if ((window as unknown as { shivDesktop?: unknown }).shivDesktop) return
    void convex.query(api.documents.recentQuotations, { limit: 100 })
      .then((rows) => merge((rows as CloudQuotationRow[])
        .filter((r) => r.document?.category && r.number)
        .map((r) => ({
          ...(r.document as Quotation),
          id: r.localId,
          number: r.number,
          updatedAt: r.updatedAt,
          customer: { ...r.customer, ...r.document?.customer } as Quotation['customer'],
        }))))
      .catch(() => undefined) // Offline: History shows what this device holds.
  }, [convex, merge])
  return null
}

export function QuoteHistory() {
  const { quotations, deleteQuotation } = useStore()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  // Search and open preview both live in the URL, so a quotation someone is
  // looking at can be sent to another counter as a plain link.
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const setQ = (value: string) => {
    setParams(value ? { q: value } : {}, { replace: true })
  }
  const [deleting, setDeleting] = useState<{ id: string; number: string } | null>(null)
  const found = quotations.find((x) => x.id === id)
  const preview = found ? enrichQuotation(found) : null
  const convexReady = Boolean(import.meta.env.VITE_CONVEX_URL)

  const needle = q.toLowerCase()
  const filtered = quotations
    .filter(
      (x) =>
        x.number.toLowerCase().includes(needle) ||
        (x.customer?.name ?? '').toLowerCase().includes(needle) ||
        (x.customer?.mobile ?? '').includes(q) ||
        (x.customer?.altMobile ?? '').includes(q),
    )
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))

  const sizeOf = (x: Quotation) => {
    if (x.bed) return `${x.bed.totalSqft} sq ft`
    if (x.sizeRates) return [x.sizeRates.brand, `${x.sizeRates.rows.length} sizes`].filter(Boolean).join(' · ')
    return formatSize(x.height, x.width, x.category) || '—'
  }

  /** A quotation's buttons; `big` gives each a thumb-sized target on a phone. */
  const actionsFor = (x: Quotation, big: boolean) => (
    <>
      <Button
        variant="ghost"
        className={big ? 'h-11 min-w-11 flex-1 justify-center' : 'px-2 py-1'}
        title="Edit"
        onClick={() => navigate(`/quote/${x.id}`)}
      >
        <Pencil size={16} />
      </Button>
      <Button
        variant="ghost"
        className={big ? 'h-11 min-w-11 flex-1 justify-center' : 'px-2 py-1'}
        title="Print quotation"
        onClick={() => navigate(`/history/${x.id}`)}
      >
        <Printer size={16} />
      </Button>
      <Button
        variant="ghost"
        className={`${big ? 'h-11 min-w-11 flex-1 justify-center' : 'px-2 py-1'} text-danger`}
        title="Delete"
        onClick={() => setDeleting({ id: x.id, number: x.number })}
      >
        <Trash2 size={16} />
      </Button>
    </>
  )

  return (
    <div>
      {convexReady && <CloudQuoteSync />}
      {deleting && (
        <Confirm
          title={`Delete ${deleting.number}?`}
          body="Remove this quotation from this device's history? The cloud copy stays."
          confirmLabel="Delete"
          danger
          onConfirm={() => deleteQuotation(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
      <PageHeader title="Quote History" subtitle={`${quotations.length} quotations`} />
      <Page>
        <div className="max-w-sm">
          <Input placeholder="Search number, name, mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {/* A phone gets each quotation as a block, with buttons big enough for a
            thumb; the table, with its six columns, is for wider screens. */}
        <div className="space-y-2 md:hidden">
          {filtered.map((x) => (
            <Card key={x.id} className="p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{x.number}</span>
                <span className="text-xs text-muted">{new Date(x.date).toLocaleDateString('en-GB')}</span>
              </div>
              <div className="mt-1 text-sm">
                {x.customer?.name || '—'}
                {x.customer?.mobile && <span className="text-muted"> · {x.customer.mobile}</span>}
              </div>
              <div className="mt-0.5 text-xs text-muted">{CATEGORY_LABELS[x.category]} · {sizeOf(x)}</div>
              <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2 dark:border-white/10">{actionsFor(x, true)}</div>
            </Card>
          ))}
          {!filtered.length && <Card className="p-6 text-center text-sm text-muted">No quotations yet.</Card>}
        </div>

        <Card className="hidden overflow-x-auto md:block">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-card2 text-left text-xs uppercase text-muted dark:bg-white/5 dark:text-muted">
              <tr>
                <th className="px-4 py-2">Number</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.id} className="border-t border-line dark:border-white/10">
                  <td className="px-4 py-2 font-medium">{x.number}</td>
                  <td className="px-4 py-2">{new Date(x.date).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-2">
                    {x.customer?.name || '—'}
                    <div className="text-xs text-muted">
                      {x.customer?.mobile}
                      {x.customer?.altMobile ? ` / ${x.customer.altMobile}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-2">{CATEGORY_LABELS[x.category]}</td>
                  <td className="px-4 py-2">{sizeOf(x)}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">{actionsFor(x, false)}</div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No quotations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </Page>

      {preview && (
        <PrintPreview
          title="Quotation"
          onClose={() => navigate(q ? `/history?q=${encodeURIComponent(q)}` : '/history')}
          serverPrint={{ kind: 'quotation', quote: preview }}
        >
          <QuotationPrint quote={preview} />
        </PrintPreview>
      )}
    </div>
  )
}
