import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Confirm from '../ledger/components/Confirm'
import { useStore } from '../../lib/store'
import { Pencil, Printer, Trash2 } from 'lucide-react'
import { CATEGORY_LABELS } from '../../lib/types'
import { enrichQuotation, formatSize } from '../../lib/pricing'
import { Button, Card, Input, Page, PageHeader } from '../../components/ui'
import { PrintPreview } from '../print/PrintPreview'
import { QuotationPrint } from '../print/QuotationPrint'

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

  const filtered = quotations.filter(
    (x) =>
      x.number.toLowerCase().includes(q.toLowerCase()) ||
      x.customer.name.toLowerCase().includes(q.toLowerCase()) ||
      x.customer.mobile.includes(q),
  )

  return (
    <div>
      {deleting && (
        <Confirm
          title={`Delete ${deleting.number}?`}
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
        <Card className="overflow-x-auto">
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
                    {x.customer.name || '—'}
                    <div className="text-xs text-muted">{x.customer.mobile}</div>
                  </td>
                  <td className="px-4 py-2">{CATEGORY_LABELS[x.category]}</td>
                  <td className="px-4 py-2">{formatSize(x.height, x.width, x.category) || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Link to={`/quote/${x.id}`} title="Edit">
                        <Button variant="ghost" className="px-2 py-1">
                          <Pencil size={16} />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        className="px-2 py-1"
                        title="Print quotation"
                        onClick={() => navigate(`/history/${x.id}`)}
                      >
                        <Printer size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-danger"
                        title="Delete"
                        onClick={() => setDeleting({ id: x.id, number: x.number })}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
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
