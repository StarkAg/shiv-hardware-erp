import { useSearchParams } from 'react-router-dom'
import { useStore } from '../../lib/store'
import { Card, Input, Page, PageHeader } from '../../components/ui'

export function Customers() {
  const { customers } = useStore()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const setQ = (value: string) => setParams(value ? { q: value } : {}, { replace: true })
  const filtered = customers.filter(
    (c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.mobile.includes(q) || (c.altMobile ?? '').includes(q),
  )

  return (
    <div>
      <PageHeader title="Customers" subtitle={`${customers.length} saved`} />
      <Page>
        <div className="max-w-sm">
          <Input placeholder="Search name or mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Card className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead className="bg-card2 text-left text-xs uppercase text-muted dark:bg-white/5 dark:text-muted">
              <tr>
                <th className="px-4 py-2">M/s</th>
                <th className="px-4 py-2">Mobile</th>
                <th className="px-4 py-2">2nd Mobile</th>
                <th className="px-4 py-2">UID</th>
                <th className="px-4 py-2">Address</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-line dark:border-white/10">
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2">{c.mobile}</td>
                  <td className="px-4 py-2">{c.altMobile || '—'}</td>
                  <td className="px-4 py-2">{c.uid || '—'}</td>
                  <td className="px-4 py-2 text-muted">{c.address || '—'}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No customers yet — they're saved automatically when you save a quotation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </Page>
    </div>
  )
}
