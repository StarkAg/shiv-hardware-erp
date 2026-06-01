import { useState } from 'react'
import { useStore } from '../../lib/store'
import { Card, Input, PageHeader } from '../../components/ui'

export function Customers() {
  const { customers } = useStore()
  const [q, setQ] = useState('')
  const filtered = customers.filter(
    (c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.mobile.includes(q),
  )

  return (
    <div>
      <PageHeader title="Customers" subtitle={`${customers.length} saved`} />
      <div className="p-6 space-y-4">
        <div className="max-w-sm">
          <Input placeholder="Search name or mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400 dark:bg-white/5 dark:text-stone-500">
              <tr>
                <th className="px-4 py-2">M/s</th>
                <th className="px-4 py-2">Mobile</th>
                <th className="px-4 py-2">UID</th>
                <th className="px-4 py-2">Address</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 dark:border-white/10">
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2">{c.mobile}</td>
                  <td className="px-4 py-2">{c.uid || '—'}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-stone-400">{c.address || '—'}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400 dark:text-stone-500">
                    No customers yet — they're saved automatically when you save a quotation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}
