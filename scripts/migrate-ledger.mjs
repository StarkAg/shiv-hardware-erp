#!/usr/bin/env node
/**
 * Move the ShivLedger books into the panel's Convex deployment.
 *
 * Ids are regenerated (Convex ids can't cross deployments), so tables are
 * walked parents-first and every reference is rewritten from an old->new map
 * built as we go. Run with --prod to target production; without it, dev.
 *
 *   node scripts/migrate-ledger.mjs <export.zip> [--prod]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [zip, ...flags] = process.argv.slice(2)
const prod = flags.includes('--prod')
if (!zip) { console.error('usage: migrate-ledger.mjs <export.zip> [--prod]'); process.exit(1) }

// Parents before children, so a reference is always resolvable when we hit it.
// [table, references, requiredRefs] — a row that loses a required reference is
// an orphan in the source (its parent was deleted) and is skipped rather than
// written broken.
const ORDER = [
  ['groups', {}, []],
  ['voucherTypes', {}, []],
  ['ledgers', { groupId: 'groups' }, ['groupId']],
  ['vouchers', { typeId: 'voucherTypes', partyLedgerId: 'ledgers' }, ['typeId', 'partyLedgerId']],
  ['voucherEntries', { voucherId: 'vouchers', ledgerId: 'ledgers' }, ['voucherId', 'ledgerId']],
  ['billLines', { voucherId: 'vouchers', partyLedgerId: 'ledgers' }, ['voucherId', 'partyLedgerId']],
  ['trash', { typeId: 'voucherTypes', partyLedgerId: 'ledgers' }, ['typeId', 'partyLedgerId']],
  ['papers', { ledgerId: 'ledgers' }, ['ledgerId']],
  ['inbox', {}, []],
  ['readings', { inboxId: 'inbox' }, []],
  ['counters', {}, []],
  ['settings', {}, []],
  ['lessons', { ledgerId: 'ledgers' }, []],
  ['history', {}, []],
]

const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
execFileSync('unzip', ['-q', '-o', zip, '-d', dir])

const map = {}
const convex = (args) => execFileSync('npx', ['convex', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

let skipped = 0
for (const [table, refs, required] of ORDER) {
  const file = join(dir, table, 'documents.jsonl')
  if (!existsSync(file)) { console.log(`${table.padEnd(16)} - not in export, skipped`); continue }
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  if (!rows.length) { console.log(`${table.padEnd(16)} 0`); continue }

  const prepared = []
  let orphans = 0
  for (const r of rows) {
    const { _id, _creationTime, ...doc } = r
    let drop = false
    for (const [field, target] of Object.entries(refs)) {
      if (doc[field] == null) continue
      const mapped = map[target]?.[doc[field]]
      if (mapped) doc[field] = mapped
      else if (required.includes(field)) { drop = true; break }
      else delete doc[field]
    }
    // Nested lines inside a trashed voucher carry their own ledger references.
    if (table === 'trash' && Array.isArray(doc.entries)) {
      const lines = []
      for (const e of doc.entries) {
        const mapped = map.ledgers?.[e.ledgerId]
        if (mapped) lines.push({ ...e, ledgerId: mapped })
      }
      if (lines.length !== doc.entries.length) { orphans++; continue }
      doc.entries = lines
    }
    if (drop) { orphans++; continue }
    prepared.push({ ...doc, __oldId: _id })
  }
  skipped += orphans

  map[table] = {}
  const BATCH = 50
  for (let i = 0; i < prepared.length; i += BATCH) {
    const slice = prepared.slice(i, i + BATCH)
    const args = JSON.stringify({ table, rows: slice })
    const out = convex(['run', ...(prod ? ['--prod'] : []), 'migrateLedger:insertRows', args])
    for (const { oldId, newId } of JSON.parse(out)) map[table][oldId] = newId
  }
  console.log(`${table.padEnd(16)} ${String(prepared.length).padStart(4)} rows${orphans ? `  (${orphans} orphaned, skipped)` : ''}`)
}

console.log(`\ndone - ${Object.keys(map).length} tables, ${skipped} orphaned rows skipped`)
