import { v } from 'convex/values'
import { query } from './lib/guarded'

/**
 * Read-only views of the books for the panel.
 *
 * Balances are folded from the entries rather than stored — that's the ledger's
 * own rule, and a cached balance is a balance that can silently go wrong.
 */

/** Party accounts with their balance, filtered by name or phone. */
export const parties = query({
  args: { search: v.optional(v.string()), group: v.optional(v.string()) },
  handler: async (ctx, { search, group }) => {
    const groups = await ctx.db.query('groups').collect()
    const byId = new Map(groups.map((g) => [g._id as string, g]))

    let ledgers = await ctx.db.query('ledgers').collect()
    if (group) ledgers = ledgers.filter((l) => byId.get(l.groupId as string)?.name === group)

    const q = (search ?? '').trim().toLowerCase()
    if (q) {
      ledgers = ledgers.filter(
        (l) => l.name.toLowerCase().includes(q) || (l.phone ?? '').includes(q) || (l.phone2 ?? '').includes(q),
      )
    }

    // One pass over the entries, rather than a query per ledger.
    const entries = await ctx.db.query('voucherEntries').collect()
    const bal = new Map<string, number>()
    for (const e of entries) {
      const k = e.ledgerId as string
      bal.set(k, (bal.get(k) ?? 0) + (e.side === 'Dr' ? e.amount : -e.amount))
    }

    return ledgers
      .map((l) => {
        const opening = l.openingSide === 'Dr' ? l.openingBalance : -l.openingBalance
        const balance = opening + (bal.get(l._id as string) ?? 0)
        return {
          id: l._id,
          name: l.name,
          phone: l.phone ?? '',
          group: byId.get(l.groupId as string)?.name ?? '',
          balance,
        }
      })
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
  },
})

/** Every line on one account, newest first, with a running balance. */
export const statement = query({
  args: { ledgerId: v.id('ledgers') },
  handler: async (ctx, { ledgerId }) => {
    const led = await ctx.db.get(ledgerId)
    if (!led) return null
    const grp = await ctx.db.get(led.groupId)

    const entries = await ctx.db
      .query('voucherEntries')
      .withIndex('by_ledger', (q) => q.eq('ledgerId', ledgerId))
      .collect()

    const rows = []
    for (const e of entries) {
      const vch = await ctx.db.get(e.voucherId)
      const type = vch ? await ctx.db.get(vch.typeId) : null
      rows.push({
        date: e.date,
        side: e.side,
        amount: e.amount,
        voucher: type?.name ?? '',
        no: vch?.voucherNo ?? 0,
        ref: vch?.refNo ?? '',
        narration: vch?.narration ?? '',
      })
    }
    rows.sort((a, b) => a.date - b.date)

    const opening = led.openingSide === 'Dr' ? led.openingBalance : -led.openingBalance
    let running = opening
    const withRunning = rows.map((r) => {
      running += r.side === 'Dr' ? r.amount : -r.amount
      return { ...r, running }
    })

    return {
      name: led.name,
      phone: led.phone ?? '',
      group: grp?.name ?? '',
      opening,
      balance: running,
      rows: withRunning.reverse(),
    }
  },
})
