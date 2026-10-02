import { useCallback, useEffect, useState } from 'react'
import { useAction, useConvex } from 'convex/react'
import { CloudDownload, ExternalLink, Eye, MessageCircle, Printer, Trash2, X } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '../../lib/store'
import { Button, Card, Input, Page, PageHeader } from '../../components/ui'
import { PrintPreview } from '../print/PrintPreview'
import { GuaranteeCard, GuaranteeCardFace } from '../print/GuaranteeCard'
import { api } from '../../../convex/_generated/api'
import type { GuaranteeDocument } from '../../lib/types'
import { formatSize } from '../../lib/pricing'
import { guaranteeOnlineUrl } from '../../lib/printServer'
import { toast } from '../../components/Toast'
import Confirm from '../ledger/components/Confirm'

/**
 * Show = look at a saved card, nothing to change. The card face as it prints
 * on the PVC card, every detail on it, and the online page its QR opens.
 */
function ShowGuaranteeModal({ doc, onClose }: { doc: GuaranteeDocument; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const c = doc.customer ?? { name: '', mobile: '', uid: '', address: '' }
  const items = doc.items ?? []
  const total = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0)
  const onlineUrl = guaranteeOnlineUrl(doc.number, doc.token)
  const detail = (label: string, value?: string | null) => (
    <div className="flex gap-3 border-t border-line py-1.5 first:border-t-0 dark:border-white/10">
      <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words font-medium">{value || '—'}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-stone-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-stone-800 dark:text-stone-100">
            Guarantee Card <span className="ml-1 rounded bg-stone-100 px-2 py-0.5 font-mono text-sm dark:bg-white/10">{doc.number}</span>
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-stone-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-5 md:flex-row">
          {/* The card as it prints (the shop design is pre-printed on the PVC). */}
          <div className="shrink-0 self-center md:self-start">
            <div className="relative h-[86mm] w-[54mm] overflow-hidden rounded-md border border-stone-300 bg-white font-print text-black shadow-sm">
              <GuaranteeCardFace document={doc} />
            </div>
          </div>

          <div className="min-w-0 flex-1 text-sm">
            {detail('Name', c.name)}
            {detail('Mobile', c.mobile)}
            {detail('Aadhaar', c.uid)}
            {detail('Address', c.address)}
            {detail('Date', new Date(doc.date).toLocaleDateString('en-GB'))}

            <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-muted">Items</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1">Brand</th><th className="py-1">Size</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Gty</th><th className="py-1 text-right">Amount</th></tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-t border-line dark:border-white/10">
                    <td className="py-1.5 pr-2 font-medium">
                      {it.brandName || '—'}
                      {it.thickness ? <div className="text-xs text-muted">{it.thickness}</div> : null}
                    </td>
                    <td className="py-1.5 pr-2">{formatSize(it.height ?? doc.height, it.width ?? doc.width) || it.sizeLabel || '—'}</td>
                    <td className="py-1.5 text-right">{it.qty ?? doc.qty ?? ''}</td>
                    <td className="py-1.5 text-right">{it.guaranteeYears ? `${it.guaranteeYears} yr` : '—'}</td>
                    <td className="py-1.5 text-right">{Number(it.amount) ? `₹${Math.round(Number(it.amount))}` : ''}</td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={5} className="py-3 text-center text-muted">No items on this card.</td></tr>}
              </tbody>
              {total > 0 && (
                <tfoot><tr className="border-t-2 border-stone-800 font-bold dark:border-stone-300"><td colSpan={4} className="py-1.5">Total</td><td className="py-1.5 text-right">₹{Math.round(total)}</td></tr></tfoot>
              )}
            </table>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="outline" className="flex items-center gap-1.5" onClick={() => window.open(onlineUrl, '_blank', 'noopener')}>
                <ExternalLink size={15} /> Open online
              </Button>
              {!doc.token && <span className="text-xs text-danger">No QR secret saved — this card won't open online.</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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

// The shop code, kept on this device after it is entered once, so History can
// fetch the cloud's copy of the cards on every open. The cloud only hands the
// full list (names, Aadhaar, QR secrets) to someone holding this code.
const CLOUD_PIN_KEY = 'shiv-panel:guarantee-cloud-pin'

function readCloudPin() {
  try { return localStorage.getItem(CLOUD_PIN_KEY) || '' } catch { return '' }
}

function writeCloudPin(pin: string) {
  try {
    if (pin) localStorage.setItem(CLOUD_PIN_KEY, pin)
    else localStorage.removeItem(CLOUD_PIN_KEY)
  } catch { /* ignore */ }
}

type CloudGuaranteeRow = { localId: string; number: string; token?: string; document: GuaranteeDocument }

/**
 * Pulls the cards made at other counters (or before a reinstall) into this
 * device's History. Cards are uploaded as they are made; this is the way back
 * down. Split out so the Convex hook only mounts when a deployment is set.
 */
function CloudGuaranteeSync() {
  const convex = useConvex()
  const merge = useStore((s) => s.mergeGuaranteesFromCloud)
  const [pin, setPin] = useState(readCloudPin)
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const pull = useCallback(async (code: string, quiet = false) => {
    setBusy(true)
    try {
      const rows = (await convex.query(api.documents.recentGuarantees, { pin: code, limit: 100 })) as CloudGuaranteeRow[]
      const docs = rows
        .filter((r) => r?.document && r.number)
        .map((r) => ({ ...r.document, id: r.localId, number: r.number, token: r.token ?? r.document.token }))
      const added = merge(docs)
      setStatus(added ? `${added} card${added === 1 ? '' : 's'} synced from the cloud` : 'Up to date with the cloud')
      return true
    } catch (err) {
      // A ConvexError carries the server's own words ("Wrong code.", "No code is set…").
      const said = typeof (err as { data?: unknown })?.data === 'string' ? String((err as { data: string }).data) : ''
      const wrong = /wrong code/i.test(said || String(err instanceof Error ? err.message : err))
      if (wrong) {
        writeCloudPin('')
        setPin('')
      }
      if (!quiet || wrong) setStatus(wrong ? 'Wrong code. Enter it again to sync.' : said || 'Could not reach the cloud.')
      if (!quiet && (wrong || said)) throw new Error(said || 'Wrong code.')
      return false
    } finally {
      setBusy(false)
    }
  }, [convex, merge])

  useEffect(() => {
    if (pin) void pull(pin, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        className="flex items-center gap-1.5"
        disabled={busy}
        onClick={() => (pin ? void pull(pin) : setAsking(true))}
      >
        <CloudDownload size={15} /> {busy ? 'Syncing…' : 'Sync from cloud'}
      </Button>
      {status && <span className="text-xs text-muted">{status}</span>}
      {asking && (
        <Confirm
          title="Sync guarantee cards"
          body="Enter the shop code once on this device. History then fetches the cards made at every counter each time it opens."
          confirmLabel="Sync"
          ask={{ label: 'Code', secret: true }}
          onConfirm={async (code) => {
            const ok = await pull(code.trim())
            if (!ok) throw new Error('Could not reach the cloud. Try again.')
            writeCloudPin(code.trim())
            setPin(code.trim())
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  )
}

export function GuaranteeHistory() {
  const { guarantees, deleteGuarantee } = useStore()
  const [deleting, setDeleting] = useState<{ id: string; number: string } | null>(null)
  const [showing, setShowing] = useState<GuaranteeDocument | null>(null)
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full max-w-sm">
            <Input placeholder="Search number, name, mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {convexReady && <CloudGuaranteeSync />}
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
                      <Button
                        variant="ghost"
                        className="px-2 py-1"
                        title="Show card"
                        onClick={() => setShowing(x)}
                      >
                        <Eye size={16} />
                      </Button>
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

      {showing && <ShowGuaranteeModal doc={showing} onClose={() => setShowing(null)} />}

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
