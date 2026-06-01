import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../lib/store'
import { Award, Pencil, Printer, Trash2 } from 'lucide-react'
import { CATEGORY_LABELS } from '../../lib/types'
import { isAluminium } from '../../lib/aluminium'
import { formatSize } from '../../lib/pricing'
import { Button, Card, Input, PageHeader } from '../../components/ui'
import { PrintPreview } from '../print/PrintPreview'
import { QuotationPrint } from '../print/QuotationPrint'
import { GuaranteeCard } from '../print/GuaranteeCard'
import type { Quotation } from '../../lib/types'

export function QuoteHistory() {
  const { quotations, deleteQuotation } = useStore()
  const [q, setQ] = useState('')
  const [preview, setPreview] = useState<{ quote: Quotation; mode: 'quote' | 'guarantee' } | null>(null)

  const filtered = quotations.filter(
    (x) =>
      x.number.toLowerCase().includes(q.toLowerCase()) ||
      x.customer.name.toLowerCase().includes(q.toLowerCase()) ||
      x.customer.mobile.includes(q),
  )

  return (
    <div>
      <PageHeader title="Quote History" subtitle={`${quotations.length} quotations`} />
      <div className="p-6 space-y-4">
        <div className="max-w-sm">
          <Input placeholder="Search number, name, mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
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
                <tr key={x.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">{x.number}</td>
                  <td className="px-4 py-2">{new Date(x.date).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-2">
                    {x.customer.name || '—'}
                    <div className="text-xs text-slate-400">{x.customer.mobile}</div>
                  </td>
                  <td className="px-4 py-2">{CATEGORY_LABELS[x.category]}</td>
                  <td className="px-4 py-2">{formatSize(x.height, x.width) || '—'}</td>
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
                        onClick={() => setPreview({ quote: x, mode: 'quote' })}
                      >
                        <Printer size={16} />
                      </Button>
                      {!isAluminium(x.category) && (
                        <Button
                          variant="ghost"
                          className="px-2 py-1"
                          title="Guarantee card"
                          onClick={() => setPreview({ quote: x, mode: 'guarantee' })}
                        >
                          <Award size={16} />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-red-500"
                        title="Delete"
                        onClick={() => confirm(`Delete ${x.number}?`) && deleteQuotation(x.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No quotations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {preview && (
        <PrintPreview
          title={preview.mode === 'quote' ? 'Quotation' : 'Guarantee Card'}
          onClose={() => setPreview(null)}
        >
          {preview.mode === 'quote' ? (
            <QuotationPrint quote={preview.quote} />
          ) : (
            <GuaranteeCard quote={preview.quote} />
          )}
        </PrintPreview>
      )}
    </div>
  )
}
