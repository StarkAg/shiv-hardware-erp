import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../lib/store'
import { Eye, Printer, Trash2 } from 'lucide-react'
import { Button, Card, Input, PageHeader } from '../../components/ui'
import { PrintPreview } from '../print/PrintPreview'
import { GuaranteeCard } from '../print/GuaranteeCard'
import { guaranteeOnlineUrl } from '../../lib/printServer'
import type { GuaranteeDocument } from '../../lib/types'

type LayoutChoice = 'card' | 'a4'

export function GuaranteeHistory() {
  const { guarantees, deleteGuarantee } = useStore()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [preview, setPreview] = useState<{ doc: GuaranteeDocument; layout: LayoutChoice } | null>(null)

  const filtered = useMemo(
    () =>
      guarantees.filter(
        (g) =>
          g.number.toLowerCase().includes(q.toLowerCase()) ||
          g.customer.name.toLowerCase().includes(q.toLowerCase()) ||
          (g.customer.mobile ?? '').includes(q),
      ),
    [guarantees, q],
  )

  return (
    <div>
      <PageHeader title="Guarantee Card History" subtitle={`${guarantees.length} cards`} />
      <div className="space-y-4 p-3 sm:p-4 md:p-6">
        <div className="max-w-sm">
          <Input placeholder="Search number, name, mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Card className="overflow-x-auto">
          <table className="min-w-[820px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400 dark:bg-white/5 dark:text-stone-500">
              <tr>
                <th className="px-4 py-2">Ref No</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Items</th>
                <th className="px-4 py-2">Online</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const onlineUrl = guaranteeOnlineUrl(g.number)
                return (
                  <tr key={g.id} className="border-t border-slate-100 dark:border-white/10">
                    <td className="px-4 py-2 font-mono font-medium">{g.number}</td>
                    <td className="px-4 py-2">{new Date(g.date).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-2">
                      {g.customer.name || '—'}
                      <div className="text-xs text-slate-400 dark:text-stone-500">{g.customer.mobile || g.customer.uid}</div>
                    </td>
                    <td className="px-4 py-2">{g.items.length} {g.items.length === 1 ? 'row' : 'rows'}</td>
                    <td className="px-4 py-2">
                      <a
                        href={onlineUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-shiv-green underline-offset-2 hover:underline"
                        title="Open this card on the shop computer / phone"
                      >
                        /{g.number}
                      </a>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          className="px-2 py-1"
                          title="Reopen in card builder"
                          onClick={() => navigate('/guarantee/card')}
                        >
                          <Eye size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1"
                          title="Reprint card (compact)"
                          onClick={() => setPreview({ doc: g, layout: 'card' })}
                        >
                          <Printer size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1"
                          title="Reprint A4 sheet"
                          onClick={() => setPreview({ doc: g, layout: 'a4' })}
                        >
                          <span className="text-[11px] font-bold">A4</span>
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-red-500"
                          title="Delete"
                          onClick={() => confirm(`Delete ${g.number}?`) && deleteGuarantee(g.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-stone-500">
                    No guarantee cards yet. Click <strong>Save</strong> or <strong>Print</strong> in the builder to record one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {preview && (
        <PrintPreview
          title={`Reprint ${preview.doc.number}`}
          onClose={() => setPreview(null)}
          serverPrint={{ kind: 'guarantee', document: preview.doc, layout: preview.layout }}
        >
          <GuaranteeCard document={preview.doc} layout={preview.layout} />
        </PrintPreview>
      )}
    </div>
  )
}
