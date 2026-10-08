// Opt-in diagnostic evidence for the audit, NOT a passing-behavior regression suite.
// These assertions deliberately reproduce defects in the reviewed revision.
// As defects are fixed, replace them with desired-behavior tests in tests/.
// Run: npx vitest run --config reports/erp-audit-2026-10-08.config.ts
import { convexTest } from 'convex-test'
import { expect, it, vi } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
import { fyOf } from '../convex/lib/money'
import { profitLines, totalsOf } from '../src/lib/profit'
import { localAdapter } from '../src/lib/db/adapter'
const modules = import.meta.glob('../convex/**/*.ts')
async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const cash = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 2 })
    const base = {openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1}
    await ctx.db.insert('ledgers', {...base, name: 'Sales', groupId: income})
    await ctx.db.insert('ledgers', {...base, name: 'Cash', groupId: cash})
    await ctx.db.insert('ledgers', {...base, name: 'Bank', groupId: cash})
    await ctx.db.insert('voucherTypes', {name: 'Sale', abbr: 'SAL', sort: 0})
    await ctx.db.insert('voucherTypes', {name: 'Receipt', abbr: 'RCT', sort: 1})
  })
  return t
}
const bill = (over = {}) => ({id:'audit-bill', number:'1', date:'2026-03-31', customerName:'Audit Customer', kind:'sale', items:[], total:1000, paid:false, ...over})

it('reproduces anonymous financial read and write access', async () => {
  const t = await shop()
  const result = await t.mutation(api.billLedger.postBill, {bill:bill()})
  expect(result.voucherId).toBeTruthy()
  expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(1)
})
it('reproduces failed posting uploaded by snapshot save', async () => {
  const t = await shop()
  await t.mutation(api.bills.save, {bills:[bill({postError:'No connection', updatedAt:1})], billSeq:1})
  expect((await t.query(api.bills.get, {}))?.bills[0].postError).toBe('No connection')
  expect(await t.run(ctx=>ctx.db.query('vouchers').collect())).toHaveLength(0)
})
it('reproduces stale catalogue replacing newer rates', async () => {
  const t = await shop()
  const snapshot = (rate: number) => ({hardwareCatalog:{}, customCatalog:[{id:'audit-item',name:'Audit Item',rate}],sets:[]})
  await t.mutation(api.catalog.save, snapshot(200))
  await t.mutation(api.catalog.save, snapshot(100))
  expect((await t.query(api.catalog.get, {}))?.customCatalog[0].rate).toBe(100)
})
it('reproduces year-crossing edit retaining old financial year', async () => {
  const t = await shop()
  const first = await t.mutation(api.billLedger.postBill,{bill:bill()})
  await t.mutation(api.billLedger.postBill,{bill:{...first.bill,date:'2026-04-01'}})
  const voucher = await t.run(ctx=>ctx.db.get(first.voucherId))
  expect(voucher?.fy).not.toBe(fyOf(voucher!.date))
})
it('reproduces posting accepting stale edit despite another device lock', async () => {
  const t = await shop()
  const first = await t.mutation(api.billLedger.postBill,{bill:bill()})
  await t.mutation(api.billLocks.claim,{billId:'audit-bill',deviceId:'counter-a',deviceName:'A'})
  expect((await t.mutation(api.billLocks.claim,{billId:'audit-bill',deviceId:'counter-b',deviceName:'B'})).ok).toBe(false)
  await t.mutation(api.billLedger.postBill,{bill:{...first.bill,total:2000}})
  await t.mutation(api.billLedger.postBill,{bill:first.bill})
  expect((await t.run(ctx=>ctx.db.get(first.voucherId)))?.amount).toBe(1000)
})
it('reproduces editor roundtrip moving cash receipt to default bank', async () => {
  const t = await shop()
  const first = await t.mutation(api.billLedger.postBill,{bill:bill({id:'vch-audit',kind:'receipt',paymentMode:'cash',moneyAmount:1000}),keepAsBill:false})
  const details = await t.query(api.vouchers.detail,{id:first.voucherId})
  expect(details).not.toHaveProperty('paymentMode')
  await t.mutation(api.billLedger.postBill,{bill:bill({id:`vch-${first.voucherId}`,voucherId:first.voucherId,kind:'receipt',paymentMode:'upi',moneyAmount:details!.amount}),keepAsBill:false})
  const bank = await t.run(ctx=>ctx.db.query('ledgers').filter(q=>q.eq(q.field('name'),'Bank')).first())
  const lines = await t.run(ctx=>ctx.db.query('voucherEntries').collect())
  expect(lines.some(l=>l.ledgerId===bank!._id&&l.amount===1000)).toBe(true)
})
it('reproduces cash pending assignment failing while posting disabled', async () => {
  const t = await shop()
  const ledgerId = await t.mutation(api.billLedger.ensureParty,{name:'Audit Customer'})
  await t.mutation(api.cash.push,{ops:[{t:'entry',entryId:'audit-note',date:'2026-10-08',kind:'in',mode:'cash',name:'Audit Customer',amount:100,at:1,updatedAt:1}]})
  await expect(t.mutation(api.cash.assign,{entryId:'audit-note',ledgerId})).rejects.toThrow('The books did not take this note')
})
it('reproduces quotation conversion retaining quotation number', async () => {
  const t = await shop()
  await t.mutation(api.bills.save,{bills:[bill({kind:'quotation',number:'Q-1',updatedAt:1})],billSeq:0})
  const posted = await t.mutation(api.billLedger.postBill,{bill:bill({number:'2',fromQuote:'Q-1'})})
  expect(posted.number).toBe('Q-1')
  expect((await t.run(ctx=>ctx.db.get(posted.voucherId)))?.refNo).toBe('BILL-Q-1')
})
it('reproduces failed local edit overwriting bill without updating voucher', async () => {
  const t = await shop()
  const posted = await t.mutation(api.billLedger.postBill,{bill:bill()})
  await t.mutation(api.bills.save,{bills:[{...posted.bill,total:2000,postError:'Offline',updatedAt:Date.now()+10000}],billSeq:1})
  expect((await t.query(api.bills.get,{}))?.bills[0].total).toBe(2000)
  expect((await t.run(ctx=>ctx.db.get(posted.voucherId)))?.amount).toBe(1000)
})
it('reproduces unposted sale included in profit', () => {
  const item = {id:'audit-line',description:'Audit Board',qty:1,unit:'Pc',amount:600,customEntryId:'audit-item'}
  const purchase:any = bill({id:'purchase',kind:'purchase',items:[item],total:600})
  const unposted:any = bill({id:'sale',items:[{...item,amount:1000}],postError:'Posting failed'})
  expect(totalsOf(profitLines([purchase,unposted])).profit).toBe(400)
})
it('reproduces lump sum sale absent even from uncosted profit list', () => {
  const lump:any = bill({items:[{id:'line',description:'Bill',qty:1,amount:12000}],total:12000})
  expect(profitLines([lump])).toHaveLength(0)
})
it('reproduces voucher roundtrip changing discount into money', async () => {
  const t = await shop()
  const discountId = await t.run(async ctx=>{
    const group = await ctx.db.query('groups').first()
    return ctx.db.insert('ledgers',{name:'Discount Allowed',groupId:group!._id,openingBalance:0,openingSide:'Dr',openingAsOf:1,active:true,createdAt:1,updatedAt:1})
  })
  const first = await t.mutation(api.billLedger.postBill,{bill:bill({id:'vch-audit',kind:'receipt',paymentMode:'upi',moneyAmount:900,discount:100}),keepAsBill:false})
  const details = await t.query(api.vouchers.detail,{id:first.voucherId})
  expect(details).not.toHaveProperty('discount')
  await t.mutation(api.billLedger.postBill,{bill:bill({id:`vch-${first.voucherId}`,voucherId:first.voucherId,kind:'receipt',paymentMode:'upi',moneyAmount:details!.amount,discount:0}),keepAsBill:false})
  const lines = await t.run(ctx=>ctx.db.query('voucherEntries').collect())
  expect(lines.some(l=>l.ledgerId===discountId)).toBe(false)
  const bank = await t.run(ctx=>ctx.db.query('ledgers').filter(q=>q.eq(q.field('name'),'Bank')).first())
  expect(lines.find(l=>l.ledgerId===bank!._id)?.amount).toBe(1000)
})
it('reproduces silent local storage failure', () => {
  vi.stubGlobal('localStorage',{setItem:()=>{throw new Error('QuotaExceededError')}})
  try { expect(()=>localAdapter.save({} as any)).not.toThrow() }
  finally { vi.unstubAllGlobals() }
})
