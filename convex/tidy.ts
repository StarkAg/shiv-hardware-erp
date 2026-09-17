import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { foldName, properItem, properText } from './lib/text'
import { tidyBill } from './lib/billText'
import { tidyCatalog } from './catalog'
import { withCourtesy } from './masters'
import { readBills, writeBills } from './lib/billRows'

/**
 * One pass that brings what is already stored in line with the naming rule.
 *
 *   - account names: proper case, codes in capitals, "M/s" on parties;
 *   - My Items and the hardware catalogue: the shop's spelling, names, units,
 *     and entries that become one name merged into one;
 *   - bills: party names, item names (spelling included) and units, and any
 *     line pointing at a merged My Items entry pointed at the one kept;
 *   - scanned bill lines: item names in the shop's spelling;
 *   - quotation customers: proper case, one record per person.
 *
 * Amounts are never touched. Run with dryRun first: it reports every change
 * and writes nothing. Internal, so only `npx convex run` can reach it.
 */
export const everything = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const now = Date.now()
    const report = {
      ledgers: [] as string[],
      ledgerClashes: [] as string[],
      catalog: [] as string[],
      catalogMerged: [] as string[],
      bills: [] as string[],
      scannedChanged: 0,
      scannedExamples: [] as string[],
      customersRenamed: [] as string[],
      customersMerged: [] as string[],
    }

    // ── Accounts ──────────────────────────────────────────────────────────
    const groups = await ctx.db.query('groups').collect()
    const groupName = new Map(groups.map((g) => [g._id as string, g.name]))
    const ledgers = await ctx.db.query('ledgers').collect()
    const planned = new Map<string, string>()
    for (const l of ledgers) {
      const next = withCourtesy(l.name, groupName.get(l.groupId as string))
      if (next !== l.name) planned.set(l._id as string, next)
    }
    for (const l of ledgers) {
      const next = planned.get(l._id as string)
      if (!next) continue
      // Two accounts must never end up answering to one name.
      const clash = ledgers.find(
        (o) => o._id !== l._id && (planned.get(o._id as string) ?? o.name) === next,
      )
      if (clash) {
        report.ledgerClashes.push(`${l.name} → ${next} (already ${clash.name})`)
        continue
      }
      report.ledgers.push(`${l.name} → ${next}`)
      if (!dryRun) await ctx.db.patch(l._id, { name: next, updatedAt: now })
    }

    // ── My Items and hardware catalogue (first: bills follow its merges) ──
    let remap: Record<string, string> = {}
    const catalog = await ctx.db.query('catalogStore').first()
    if (catalog) {
      const before = catalog.customCatalog ?? []
      const tidy = tidyCatalog({
        hardwareCatalog: catalog.hardwareCatalog,
        customCatalog: before,
        sets: catalog.sets ?? [],
      })
      remap = tidy.remap
      const byId = new Map(before.map((e: any) => [e?.id, e]))
      for (const after of tidy.customCatalog) {
        const was = byId.get(after?.id) as any
        if (!was) continue
        if (after.name !== was.name) report.catalog.push(`"${was.name}" → "${after.name}"`)
        if (after.unit !== was.unit && was.unit) report.catalog.push(`${after.name}: ${was.unit} → ${after.unit}`)
      }
      for (const [gone, kept] of Object.entries(remap)) {
        report.catalogMerged.push(`"${(byId.get(gone) as any)?.name}" merged into "${tidy.customCatalog.find((e: any) => e?.id === kept)?.name}"`)
      }
      for (const [key, e] of Object.entries(catalog.hardwareCatalog ?? {})) {
        const after = (tidy.hardwareCatalog as Record<string, any>)[key]
        if ((e as any)?.unit !== after?.unit) report.catalog.push(`${key}: ${(e as any)?.unit} → ${after?.unit}`)
      }
      if ((report.catalog.length || report.catalogMerged.length) && !dryRun) {
        await ctx.db.patch(catalog._id, {
          customCatalog: tidy.customCatalog,
          hardwareCatalog: tidy.hardwareCatalog,
          savedAt: now,
        })
      }
    }

    // ── Bills ─────────────────────────────────────────────────────────────
    {
      const tidied: any[] = []
      for (const b of await readBills(ctx)) {
        const tidy = tidyBill(b) as any
        if (Array.isArray(tidy.items)) {
          tidy.items = tidy.items.map((item: any) =>
            item && item.customEntryId && remap[item.customEntryId]
              ? { ...item, customEntryId: remap[item.customEntryId] }
              : item,
          )
        }
        if (JSON.stringify(tidy) === JSON.stringify(b)) continue
        const notes: string[] = []
        if (tidy.customerName !== b.customerName) notes.push(`"${b.customerName}" → "${tidy.customerName}"`)
        ;(b.items ?? []).forEach((item: any, i: number) => {
          const after = tidy.items?.[i]
          if (!after) return
          if (after.description !== item.description) notes.push(`"${item.description}" → "${after.description}"`)
          if (after.unit !== item.unit) notes.push(`${item.unit} → ${after.unit}`)
          if (after.customEntryId !== item.customEntryId) notes.push(`My Items link → kept entry`)
        })
        report.bills.push(`#${b.number}: ${notes.join('; ')}`)
        // Stamped newer, so a device holding the old copy takes this one.
        tidied.push({ ...tidy, updatedAt: now })
      }
      if (tidied.length && !dryRun) await writeBills(ctx, tidied)
    }

    // ── Scanned bill lines ────────────────────────────────────────────────
    for (const row of await ctx.db.query('billLines').collect()) {
      const desc = properItem(row.desc)
      if (!desc || desc === row.desc) continue
      report.scannedChanged++
      if (report.scannedExamples.length < 40) report.scannedExamples.push(`"${row.desc}" → "${desc}"`)
      if (!dryRun) await ctx.db.patch(row._id, { desc })
    }

    // ── Quotation customers ───────────────────────────────────────────────
    const customers = await ctx.db.query('customers').collect()
    const byPerson = new Map<string, typeof customers>()
    for (const c of customers) {
      const key = foldName(c.name)
      if (!key) continue
      // A different mobile under the same name is a different person.
      const mobiles = new Set(customers.filter((o) => foldName(o.name) === key && o.mobile).map((o) => o.mobile))
      const group = mobiles.size > 1 && c.mobile ? `${key}|${c.mobile}` : key
      byPerson.set(group, [...(byPerson.get(group) ?? []), c])
    }
    for (const same of byPerson.values()) {
      const [keep, ...rest] = [...same].sort((a, b) => b.updatedAt - a.updatedAt)
      const name = properText(keep.name)
      const fill = {
        mobile: keep.mobile ?? rest.find((r) => r.mobile)?.mobile,
        altMobile: keep.altMobile ?? rest.find((r) => r.altMobile)?.altMobile,
        uid: keep.uid ?? rest.find((r) => r.uid)?.uid,
        address: keep.address ?? rest.find((r) => r.address)?.address,
      }
      if (rest.length) {
        report.customersMerged.push(`${name}: ${same.length} records → 1 (${same.map((c) => `"${c.name}"`).join(', ')})`)
      } else if (name !== keep.name) {
        report.customersRenamed.push(`"${keep.name}" → "${name}"`)
      }
      if (dryRun || (!rest.length && name === keep.name)) continue
      await ctx.db.patch(keep._id, {
        name,
        ...Object.fromEntries(Object.entries(fill).filter(([, value]) => value !== undefined)),
        updatedAt: now,
      })
      for (const r of rest) await ctx.db.delete(r._id)
    }

    return { dryRun: !!dryRun, ...report }
  },
})
