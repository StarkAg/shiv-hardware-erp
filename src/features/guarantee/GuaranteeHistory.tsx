import { useState } from 'react'
import { useAction } from 'convex/react'
import { MessageCircle, Printer, Trash2 } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '../../lib/store'
import { Button, Card, Input, Page, PageHeader } from '../../components/ui'
import { PrintPreview } from '../print/PrintPreview'
import { GuaranteeCard } from '../print/GuaranteeCard'
import { api } from '../../../convex/_generated/api'
import type { GuaranteeDocument } from '../../lib/types'
import { toast } from '../../components/Toast'
import Confirm from '../ledger/components/Confirm'

/** Brands on a card, condensed for the table. */
function itemSummary(doc: GuaranteeDocument): string {
  const named = (doc.items ?? []).filter((i) => i.brandName)
  if (!named.length) return '—'
  if (named.length <= 2) return named.map((i) => i.brandName).join(', ')
  return `${named.length} items`
}

/**
 * Split out so the Convex hook only mounts when a deployment is configured —
 * the Electron/offline build renders the router without <ConvexProvider>.
 */
function SendWhatsAppButton({ doc }: { doc: GuaranteeDocument }) {
  const send = useAction(api.whatsapp.sendGuaranteeCard)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  const mobile = doc.customer?.mobile?.trim()

  async function onSend() {
    setAsking(false)
    setBusy(true)
    try {
      const res = await send({ number: doc.number })
      if (res.ok) toast(`Sent to ${mobile}`)
      else toast(`Failed: ${res.error}`, 'error')
    } catch (err) {
      toast(`Failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        className="px-2 py-1 text-good"
        title="Send guarantee card message on WhatsApp"
        disabled={busy}
        onClick={() => (mobile ? setAsking(true) : toast('This customer has no mobile number saved.', 'error'))}
      >
        <MessageCircle size={16} />
      </Button>
      {asking && (
        <Confirm
          title={`Send ${doc.number} to ${mobile}?`}
          confirmLabel="Send"
          onConfirm={onSend}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  )
}

export function GuaranteeHistory() {
  const { guarantees, deleteGuarantee } = useStore()
  const [deleting, setDeleting] = useState<{ id: string; number: string } | null>(null)
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const setQ = (value: string) => {
    setParams(value ? { q: value } : {}, { replace: true })
  }
  const preview = guarantees.find((x) => x.id === id) ?? null

  const convexReady = Boolean(import.meta.env.VITE_CONVEX_URL)

  const needle = q.toLowerCase()
  const filtered = guarantees.filter(
    (x) =>
      x.number.toLowerCase().includes(needle) ||
      (x.customer?.name ?? '').toLowerCase().includes(needle) ||
      (x.customer?.mobile ?? '').includes(q),
  )

  return (
    <div>
      {deleting && (
        <Confirm
          title={`Delete ${deleting.number}?`}
          confirmLabel="Delete"
          danger
          onConfirm={() => deleteGuarantee(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
      <PageHeader title="Guarantee History" subtitle={`${guarantees.length} cards`} />
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
                <th className="px-4 py-2">Products</th>
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
                    <div className="text-xs text-muted">{x.customer?.mobile}</div>
                  </td>
                  <td className="px-4 py-2">{itemSummary(x)}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      {convexReady && <SendWhatsAppButton doc={x} />}
                      <Button
                        variant="ghost"
                        className="px-2 py-1"
                        title="Print guarantee card"
                        onClick={() => navigate(`/guarantee/history/${x.id}`)}
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
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No guarantee cards yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </Page>

      {preview && (
        <PrintPreview
          title="Guarantee Card"
          onClose={() => navigate(q ? `/guarantee/history?q=${encodeURIComponent(q)}` : '/guarantee/history')}
          serverPrint={{ kind: 'guarantee', document: preview, layout: 'a4' }}
        >
          <GuaranteeCard document={preview} layout="a4" />
        </PrintPreview>
      )}
    </div>
  )
}
