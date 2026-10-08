/**
 * The defects found by the ERP audit of 2026-10-08, each held to the
 * behaviour the shop chose for it.
 */
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const cash = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 2 })
    const bank = await ctx.db.insert('groups', { name: 'Bank Accounts', nature: 'asset', normalSide: 'Dr', sort: 3 })
    const base = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...base, name: 'Sales', groupId: income })
    await ctx.db.insert('ledgers', { ...base, name: 'Discount Allowed', groupId: income })
    await ctx.db.insert('ledgers', { ...base, name: 'Cash', groupId: cash })
    await ctx.db.insert('ledgers', { ...base, name: 'Bank', groupId: bank })
    void debtors
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    await ctx.db.insert('voucherTypes', { name: 'Receipt', abbr: 'RCT', sort: 1 })
  })
  return t
}

const bill = (over: Record<string, unknown> = {}) => ({
  id: 'audit-bill', number: '1', date: '2026-03-31', customerName: 'Audit Customer',
  kind: 'sale', items: [], total: 1000, paid: false, ...over,
})

/** What the voucher's lines say, by account name. */
async function lines(t: Awaited<ReturnType<typeof shop>>, voucherId: string) {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query('voucherEntries').collect()
    const out: Record<string, string> = {}
    for (const r of rows.filter((r) => r.voucherId === voucherId)) {
      out[(await ctx.db.get(r.ledgerId))!.name] = `${r.side} ${r.amount}`
    }
    return out
  })
}

describe('#2 a voucher opened from the ledger and saved unchanged stays as it was', () => {
  /** The editor's mapping of vouchers.detail back into a bill, as BillBuilder does it. */
  async function reopenAndSave(t: Awaited<ReturnType<typeof shop>>, voucherId: any) {
    const d: any = await t.query(api.vouchers.detail, { id: voucherId })
    await t.mutation(api.billLedger.postBill, {
      bill: bill({
        id: `vch-${voucherId}`, voucherId, kind: d.kind, number: d.vchLabel,
        paymentMode: d.paymentMode ?? 'upi',
        moneyAmount: d.moneyAmount ?? d.amount, discount: d.discount ?? 0, total: d.amount,
      }),
      keepAsBill: false,
    } as any)
  }

  test('a cash receipt stays cash', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'vch-new', kind: 'receipt', paymentMode: 'cash', moneyAmount: 1000 }), keepAsBill: false,
    } as any)
    const before = await lines(t, first.voucherId)
    await reopenAndSave(t, first.voucherId)
    expect(await lines(t, first.voucherId)).toEqual(before)
    expect(before.Cash).toBe('Dr 1000')
  })

  test('money and discount keep their split', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'vch-new', kind: 'receipt', paymentMode: 'upi', moneyAmount: 900, discount: 100 }), keepAsBill: false,
    } as any)
    const before = await lines(t, first.voucherId)
    await reopenAndSave(t, first.voucherId)
    expect(await lines(t, first.voucherId)).toEqual(before)
    expect(before).toMatchObject({ Bank: 'Dr 900', 'Discount Allowed': 'Dr 100' })
  })
})

describe('#6 a date moved across 1 April moves the voucher into that year', () => {
  test('31 March to 1 April takes the new year and its next number', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: bill() } as any)
    await t.mutation(api.billLedger.postBill, { bill: { ...first.bill, date: '2026-04-01' } } as any)
    const v = await t.run((ctx) => ctx.db.get(first.voucherId))
    expect(v?.fy).toBe('2026-27')
    expect(v?.voucherNo).toBe(1)
  })

  test('the same edit from the ledger does the same', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: bill() } as any)
    const v = (await t.run((ctx) => ctx.db.get(first.voucherId)))!
    const other = await t.run(async (ctx) => (await ctx.db.query('ledgers').filter((q) => q.eq(q.field('name'), 'Sales')).first())!._id)
    await t.mutation(api.vouchers.edit, {
      id: first.voucherId, date: Date.parse('2026-04-01T00:00:00Z'), partyLedgerId: v.partyLedgerId,
      accountLedgerId: other, amount: 1000,
    } as any)
    expect((await t.run((ctx) => ctx.db.get(first.voucherId)))?.fy).toBe('2026-27')
  })
})

describe('#9 a quotation converted to a sale takes a bill number', () => {
  test('Q-1 becomes bill 2, and remembers Q-1', async () => {
    const t = await shop()
    await t.mutation(api.bills.save, { bills: [bill({ kind: 'quotation', number: 'Q-1', updatedAt: 1 })], billSeq: 0 } as any)
    const posted = await t.mutation(api.billLedger.postBill, { bill: bill({ number: '2', fromQuote: 'Q-1' }) } as any)
    expect(posted.number).toBe('2')
    expect((await t.run((ctx) => ctx.db.get(posted.voucherId)))?.refNo).toBe('BILL-2')
    expect(posted.bill.fromQuote).toBe('Q-1')
  })

  test('saving the sale again keeps its number', async () => {
    const t = await shop()
    await t.mutation(api.bills.save, { bills: [bill({ kind: 'quotation', number: 'Q-1', updatedAt: 1 })], billSeq: 0 } as any)
    const posted = await t.mutation(api.billLedger.postBill, { bill: bill({ number: '2', fromQuote: 'Q-1' }) } as any)
    const again = await t.mutation(api.billLedger.postBill, { bill: { ...posted.bill, number: '' } } as any)
    expect(again.number).toBe('2')
    expect(await t.run((ctx) => ctx.db.query('vouchers').collect())).toHaveLength(1)
  })
})

describe('#3 an upload cannot part a bill from its voucher', () => {
  test('a bill the books refused is not taken', async () => {
    const t = await shop()
    await t.mutation(api.bills.save, { bills: [bill({ postError: 'No connection', updatedAt: 1 })], billSeq: 1 } as any)
    expect((await t.query(api.bills.get, {}))?.bills ?? []).toHaveLength(0)
  })

  test("a posted bill's money stays what the books say", async () => {
    const t = await shop()
    const posted = await t.mutation(api.billLedger.postBill, { bill: bill() } as any)
    await t.mutation(api.bills.save, {
      bills: [{ ...posted.bill, total: 2000, notes: 'printed', updatedAt: Date.now() + 10000 }], billSeq: 1,
    } as any)
    const stored = (await t.query(api.bills.get, {}))!.bills[0]
    expect(stored.total).toBe(1000)
    expect(stored.notes).toBe('printed')
    expect((await t.run((ctx) => ctx.db.get(posted.voucherId)))?.amount).toBe(1000)
  })

  test('a quotation still saves freely', async () => {
    const t = await shop()
    await t.mutation(api.bills.save, { bills: [bill({ kind: 'quotation', number: 'Q-1', updatedAt: 1 })], billSeq: 0 } as any)
    await t.mutation(api.bills.save, { bills: [bill({ kind: 'quotation', number: 'Q-1', total: 1500, updatedAt: 2 })], billSeq: 0 } as any)
    expect((await t.query(api.bills.get, {}))!.bills[0].total).toBe(1500)
  })
})

describe('#4 a save from an old copy is refused', () => {
  test('counter A cannot write its old 1,000 over counter B’s 2,000', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: bill(), expectedRev: null } as any)
    const opened = first.bill // both counters open it at rev 1
    expect(opened.rev).toBe(1)
    await t.mutation(api.billLedger.postBill, { bill: { ...opened, total: 2000 }, expectedRev: opened.rev } as any)
    await expect(
      t.mutation(api.billLedger.postBill, { bill: { ...opened, notes: 'A' }, expectedRev: opened.rev } as any),
    ).rejects.toMatchObject({ data: { code: 'stale' } })
    expect((await t.run((ctx) => ctx.db.get(first.voucherId)))?.amount).toBe(2000)
  })

  test('the refusal carries the newer bill', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: bill(), expectedRev: null } as any)
    await t.mutation(api.billLedger.postBill, { bill: { ...first.bill, total: 2000 }, expectedRev: 1 } as any)
    const err: any = await t.mutation(api.billLedger.postBill, { bill: first.bill, expectedRev: 1 } as any).catch((e) => e)
    expect(err.data.newer.total).toBe(2000)
  })

  test('an edit from the ledger also makes the open copy old', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: bill(), expectedRev: null } as any)
    const v = (await t.run((ctx) => ctx.db.get(first.voucherId)))!
    const sales = await t.run(async (ctx) => (await ctx.db.query('ledgers').filter((q) => q.eq(q.field('name'), 'Sales')).first())!._id)
    await t.mutation(api.vouchers.edit, {
      id: first.voucherId, date: v.date, partyLedgerId: v.partyLedgerId, accountLedgerId: sales, amount: 1500,
    } as any)
    await expect(
      t.mutation(api.billLedger.postBill, { bill: first.bill, expectedRev: first.bill.rev } as any),
    ).rejects.toMatchObject({ data: { code: 'stale' } })
  })

  test('a new bill that someone else already posted is refused too', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: bill() } as any)
    await expect(
      t.mutation(api.billLedger.postBill, { bill: bill(), expectedRev: null } as any),
    ).rejects.toMatchObject({ data: { code: 'stale' } })
  })

  test('a voucher with its commission marked can still be deleted', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: bill() } as any)
    await t.mutation(api.vouchers.setCommissionPaid, { id: first.voucherId, paid: true } as any)
    const { trashVoucher } = await import('../convex/vouchers')
    await t.run((ctx) => trashVoucher(ctx as any, first.voucherId))
    expect(await t.run((ctx) => ctx.db.get(first.voucherId))).toBeNull()
  })
})
