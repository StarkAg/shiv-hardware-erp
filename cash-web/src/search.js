const normalize = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase()
  .replace(/₹/g, '').replace(/(?<=\d),(?=\d)/g, '').replace(/\s+/g, ' ').trim()

export function searchTransactions(entries, query, mode = 'all') {
  const terms = normalize(query).split(' ').filter(Boolean)
  return entries.filter((entry) => {
    if (entry.deleted || (mode !== 'all' && entry.mode !== mode)) return false
    const date = new Date(`${entry.date}T12:00:00`)
    const readableDate = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    const shortDate = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    const [year, month, day] = (entry.date || '').split('-')
    const text = normalize([
      entry.name, entry.id, entry.amount, entry.date, `${day}/${month}/${year}`, readableDate, shortDate,
      entry.mode, entry.mode === 'online' ? 'bank upi' : '',
      entry.kind === 'in' ? 'in received receipt' : 'out paid payment',
      entry.dealer ? 'dealer supplier' : '', entry.staffPaymentId ? 'staff salary wages' : '',
    ].join(' '))
    return terms.every((term) => text.includes(term))
  }).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at)
}
