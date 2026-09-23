/// <reference types="vite/client" />
/**
 * What a copy has to contain before it counts as a backup.
 *
 * The old check asked two questions — are there vouchers, are there ledgers —
 * so a copy missing every bill, the cash book, the item list or the whole
 * attendance register reported itself healthy. The worst kind of backup is one
 * that is trusted and half empty.
 *
 * The inventory needed its own answer. The whole item list lives inside a
 * single `catalogStore` document, so counting rows returns 1 whether the list
 * holds two hundred items or none — which is exactly how the hardware list
 * emptied on 10 September 2026 with every backup that night, and every night
 * after, calling itself good.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'backup-job', 'backup.mjs'), 'utf8')

/** The MUST_HAVE list, read out of the script so the two cannot drift. */
const mustHave = (() => {
  const block = /const MUST_HAVE = \[([\s\S]*?)\]/.exec(source)
  if (!block) throw new Error('MUST_HAVE is not in backup.mjs any more')
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
})()

describe('the tables a copy must have', () => {
  it('covers the books themselves', () => {
    for (const t of ['vouchers', 'voucherEntries', 'ledgers', 'groups', 'voucherTypes']) {
      expect(mustHave).toContain(t)
    }
  })

  /**
   * Balances are not stored; they are added up from voucherEntries. A copy
   * with vouchers but no entries restores a set of books in which every
   * account reads zero — and the old check would have passed it.
   */
  it('insists on the entries, not just the vouchers', () => {
    expect(mustHave).toContain('voucherEntries')
  })

  it('covers what the counter wrote', () => {
    expect(mustHave).toContain('bills')
    expect(mustHave).toContain('billLines')
  })

  it('covers the item list', () => {
    expect(mustHave).toContain('catalogStore')
  })

  /** Restoring without these repeats bill and voucher numbers already issued. */
  it('covers the numbering', () => {
    expect(mustHave).toContain('counters')
  })

  /**
   * A table that is legitimately empty on a quiet day must not be in the list,
   * or a true empty is reported as a broken backup every time.
   */
  it('leaves out anything that can honestly be empty', () => {
    for (const t of ['trash', 'printJobs', 'inbox', 'billsTrash', 'whatsappInbox', 'filingStations']) {
      expect(mustHave).not.toContain(t)
    }
  })
})

describe('the script itself', () => {
  it('counts the inventory inside its row, not by rows', () => {
    expect(source).toMatch(/function countInventory/)
    expect(source).toMatch(/customCatalog/)
    expect(source).toMatch(/hardwareCatalog/)
  })

  /**
   * A copy that shows a loss is still a true copy. Refusing to keep it would
   * throw away the evidence of the very thing worth knowing about.
   */
  it('warns about a shrinking list rather than refusing to save', () => {
    const body = source.slice(source.indexOf('export async function backup'))
    expect(body).toMatch(/warning/)
    // The only throw on contents is for a missing table, never for a small one.
    const throws = [...body.matchAll(/throw new Error\(`([^`]*)`/g)].map((m) => m[1])
    expect(throws.some((t) => /missing/.test(t))).toBe(true)
    expect(throws.some((t) => /dropped|shrunk|fewer/.test(t))).toBe(false)
  })

  it('still refuses a copy that is missing a table outright', () => {
    expect(source).toMatch(/MUST_HAVE\.filter\(\(t\) => !countRows\(/)
  })

  it('notes what each copy held, so the next one can be compared with it', () => {
    expect(source).toMatch(/function rememberInventory/)
    expect(source).toMatch(/function lastInventory/)
  })
})
