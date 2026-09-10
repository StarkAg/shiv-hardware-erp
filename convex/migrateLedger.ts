import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

/**
 * One-time import of the ShivLedger books into this deployment.
 *
 * Convex ids are deployment-scoped, so a snapshot from the ledger's own
 * deployment cannot keep its ids here — the import is rejected outright. Every
 * row is therefore re-inserted and every reference rewritten, which is why the
 * caller walks the tables in dependency order and feeds back an old->new map.
 *
 * Rows arrive with _id and _creationTime already stripped, and references
 * already rewritten, so this stays a dumb, replayable insert.
 */
export const insertRows = internalMutation({
  args: {
    table: v.string(),
    rows: v.array(v.any()),
  },
  handler: async (ctx, { table, rows }) => {
    const out: { oldId: string; newId: string }[] = []
    for (const row of rows) {
      const { __oldId, ...doc } = row
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newId = await ctx.db.insert(table as any, doc)
      out.push({ oldId: __oldId, newId })
    }
    return out
  },
})

/** Count what landed, so the migration can be verified rather than trusted. */
export const countRows = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = await ctx.db.query(table as any).collect()
    return all.length
  },
})

/** Wipe a ledger table, so a rehearsal can be run again from clean. */
export const clearTable = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = await ctx.db.query(table as any).collect()
    for (const d of all) await ctx.db.delete(d._id)
    return all.length
  },
})

/**
 * Prove the migration, rather than trust it.
 *
 * The reference checks catch a broken remap; the Dr/Cr check is the one that
 * matters — in double entry every voucher's lines must sum to zero, so if the
 * remapping had scrambled entries onto the wrong vouchers, this is where it
 * would show.
 */
export const verify = internalMutation({
  args: {},
  handler: async (ctx) => {
    const vouchers = await ctx.db.query('vouchers').collect()
    const entries = await ctx.db.query('voucherEntries').collect()
    const ledgers = await ctx.db.query('ledgers').collect()

    const voucherIds = new Set(vouchers.map((v) => v._id as string))
    const ledgerIds = new Set(ledgers.map((l) => l._id as string))

    let danglingVoucher = 0, danglingLedger = 0
    const byVoucher = new Map<string, number>()
    for (const e of entries) {
      if (!voucherIds.has(e.voucherId as string)) danglingVoucher++
      if (!ledgerIds.has(e.ledgerId as string)) danglingLedger++
      const signed = e.side === 'Dr' ? e.amount : -e.amount
      byVoucher.set(e.voucherId as string, (byVoucher.get(e.voucherId as string) ?? 0) + signed)
    }

    const unbalanced = [...byVoucher.entries()].filter(([, sum]) => Math.abs(sum) > 0.005)
    const orphanLedgers = ledgers.filter((l) => !l.groupId).length

    return {
      vouchers: vouchers.length,
      entries: entries.length,
      ledgers: ledgers.length,
      danglingVoucherRefs: danglingVoucher,
      danglingLedgerRefs: danglingLedger,
      ledgersWithoutGroup: orphanLedgers,
      unbalancedVouchers: unbalanced.length,
      worstImbalance: unbalanced.length ? Math.max(...unbalanced.map(([, s]) => Math.abs(s))) : 0,
    }
  },
})

/** What the books actually contain, for wiring bills into them. */
export const chart = internalMutation({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query('groups').collect()
    const types = await ctx.db.query('voucherTypes').collect()
    return {
      groups: groups.map((g) => ({ name: g.name, nature: g.nature })),
      voucherTypes: types.map((t) => ({ name: t.name })),
    }
  },
})

/** Which ledgers sit under a given group — used to pick the sales account. */
export const ledgersInGroup = internalMutation({
  args: { group: v.string() },
  handler: async (ctx, { group }) => {
    const g = await ctx.db.query('groups').filter((q) => q.eq(q.field('name'), group)).first()
    if (!g) return { group, found: false, ledgers: [] as string[] }
    const ls = await ctx.db.query('ledgers').filter((q) => q.eq(q.field('groupId'), g._id)).collect()
    return { group, found: true, ledgers: ls.map((l) => l.name) }
  },
})

/** Remove a test posting: its voucher, its entries and the party if unused. */
export const undoTestPost = internalMutation({
  args: { refNo: v.string() },
  handler: async (ctx, { refNo }) => {
    const vs = await ctx.db.query('vouchers').filter((q) => q.eq(q.field('refNo'), refNo)).collect()
    for (const vch of vs) {
      for (const e of await ctx.db.query('voucherEntries')
        .withIndex('by_voucher', (q) => q.eq('voucherId', vch._id)).collect()) {
        await ctx.db.delete(e._id)
      }
      await ctx.db.delete(vch._id)
    }
    return vs.length
  },
})

/** Read a customer's account exactly as the ledger app would show it. */
export const partyStatement = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const led = await ctx.db.query('ledgers').filter((q) => q.eq(q.field('name'), name)).first()
    if (!led) return { found: false }
    const grp = await ctx.db.get(led.groupId)
    const entries = await ctx.db.query('voucherEntries')
      .withIndex('by_ledger', (q) => q.eq('ledgerId', led._id)).collect()
    let balance = 0
    const lines = []
    for (const e of entries) {
      balance += e.side === 'Dr' ? e.amount : -e.amount
      const vch = await ctx.db.get(e.voucherId)
      const type = vch ? await ctx.db.get(vch.typeId) : null
      lines.push({ date: e.date, side: e.side, amount: e.amount,
                   voucher: type?.name ?? '?', ref: vch?.refNo ?? '' })
    }
    return { found: true, ledger: led.name, group: grp?.name, phone: led.phone,
             lines, balance, balanceSide: balance >= 0 ? 'Dr' : 'Cr' }
  },
})

/** Any voucher this integration created, so test rows can be found and removed. */
export const billVouchers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('vouchers').collect()
    return all
      .filter((v) => typeof v.refNo === 'string' && v.refNo.startsWith('BILL-'))
      .map((v) => ({ refNo: v.refNo, amount: v.amount, date: v.date }))
  },
})

/** Full picture of one posted bill: its voucher, both sides, and the party. */
export const billPosting = internalMutation({
  args: { refNo: v.string() },
  handler: async (ctx, { refNo }) => {
    const vch = await ctx.db.query('vouchers').filter((q) => q.eq(q.field('refNo'), refNo)).first()
    if (!vch) return { found: false }
    const party = await ctx.db.get(vch.partyLedgerId)
    const grp = party ? await ctx.db.get(party.groupId) : null
    const type = await ctx.db.get(vch.typeId)
    const entries = await ctx.db.query('voucherEntries')
      .withIndex('by_voucher', (q) => q.eq('voucherId', vch._id)).collect()
    const lines = []
    for (const e of entries) {
      const l = await ctx.db.get(e.ledgerId)
      lines.push({ ledger: l?.name, side: e.side, amount: e.amount })
    }
    return {
      found: true, voucher: `${type?.name} #${vch.voucherNo}/${vch.fy}`,
      party: party?.name, group: grp?.name, amount: vch.amount,
      narration: vch.narration, lines,
      balances: lines.reduce((s, l) => s + (l.side === 'Dr' ? l.amount : -l.amount), 0),
    }
  },
})

// ── File storage migration ─────────────────────────────────────────────────
// The rows came across from the old deployment carrying their storage ids, but
// a storage id only means anything in the deployment that issued it — so every
// bill photo pointed at a file that does not exist here and rendered blank.
// These two walk the references and swap old ids for new ones once the files
// themselves have been re-uploaded.

/** Every storage id referenced by a row, and whether the file resolves here. */
export const storageRefs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: { table: string; id: string; field: string; storageId: string; ok: boolean }[] = []
    const check = async (table: string, id: string, field: string, sid: any) => {
      if (!sid) return
      const url = await ctx.storage.getUrl(sid).catch(() => null)
      out.push({ table, id, field, storageId: String(sid), ok: !!url })
    }
    for (const table of ['vouchers', 'trash'] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        for (const att of (row as any).attachments ?? []) {
          if (typeof att === 'string') await check(table, row._id, 'attachments', att)
          else {
            await check(table, row._id, 'attachments.storageId', att.storageId)
            await check(table, row._id, 'attachments.previewStorageId', att.previewStorageId)
          }
        }
      }
    }
    for (const row of await ctx.db.query('papers').collect()) {
      for (const att of (row as any).documents ?? []) {
        if (typeof att === 'string') await check('papers', row._id, 'documents', att)
        else {
          await check('papers', row._id, 'documents.storageId', att.storageId)
          await check('papers', row._id, 'documents.previewStorageId', att.previewStorageId)
        }
      }
    }
    for (const row of await ctx.db.query('inbox').collect()) {
      await check('inbox', row._id, 'storageId', (row as any).storageId)
    }
    return out
  },
})

/** Rewrite old storage ids to the ids the re-uploaded files were given here. */
export const remapStorage = internalMutation({
  args: { map: v.any(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { map, dryRun }) => {
    const to = (sid: any) => (sid && map[String(sid)]) || undefined
    let rows = 0
    let ids = 0

    const remapList = (list: any[]) => {
      let touched = false
      const next = list.map((att) => {
        if (typeof att === 'string') {
          const n = to(att)
          if (!n) return att
          touched = true; ids++
          return n
        }
        const copy = { ...att }
        const s = to(copy.storageId)
        if (s) { copy.storageId = s; touched = true; ids++ }
        const p = to(copy.previewStorageId)
        if (p) { copy.previewStorageId = p; touched = true; ids++ }
        return copy
      })
      return touched ? next : null
    }

    for (const table of ['vouchers', 'trash'] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        const next = remapList((row as any).attachments ?? [])
        if (!next) continue
        rows++
        if (!dryRun) await ctx.db.patch(row._id, { attachments: next } as any)
      }
    }
    for (const row of await ctx.db.query('papers').collect()) {
      const next = remapList((row as any).documents ?? [])
      if (!next) continue
      rows++
      if (!dryRun) await ctx.db.patch(row._id, { documents: next } as any)
    }
    for (const row of await ctx.db.query('inbox').collect()) {
      const n = to((row as any).storageId)
      if (!n) continue
      rows++; ids++
      if (!dryRun) await ctx.db.patch(row._id, { storageId: n } as any)
    }
    return { rows, ids, dryRun: !!dryRun }
  },
})

/**
 * Moves a voucher onto another account.
 *
 * Written for the case that keeps arising after the merge: one customer with
 * two spellings, and a sale sitting on the wrong one. The voucher keeps its
 * number, its date and its amount — only which account it belongs to changes,
 * and the Dr/Cr line that named the old account is rewritten to name the new.
 */
export const repointVoucher = internalMutation({
  args: { voucherId: v.id('vouchers'), toLedgerId: v.id('ledgers'), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { voucherId, toLedgerId, dryRun }) => {
    const voucher = await ctx.db.get(voucherId)
    if (!voucher) throw new Error('No such voucher')
    const to = await ctx.db.get(toLedgerId)
    if (!to) throw new Error('No such ledger')

    const from = voucher.partyLedgerId
    const lines = await ctx.db
      .query('voucherEntries')
      .withIndex('by_voucher', (q) => q.eq('voucherId', voucherId))
      .collect()
    const moving = lines.filter((l) => l.ledgerId === from)

    if (!dryRun) {
      await ctx.db.patch(voucherId, { partyLedgerId: toLedgerId, updatedAt: Date.now() })
      for (const line of moving) await ctx.db.patch(line._id, { ledgerId: toLedgerId })
    }
    return {
      voucher: voucher.refNo ?? String(voucher.voucherNo),
      amount: voucher.amount,
      from: (await ctx.db.get(from))?.name ?? '—',
      to: to.name,
      entriesMoved: moving.length,
      dryRun: !!dryRun,
    }
  },
})
