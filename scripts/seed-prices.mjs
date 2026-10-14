#!/usr/bin/env node
/**
 * Puts a maker's rate list (CSV) into the Price List (convex/prices.ts).
 *
 *   node scripts/seed-prices.mjs prices-web/seed/godrej_olive_basket_rates.csv          dev
 *   node scripts/seed-prices.mjs prices-web/seed/godrej_olive_basket_rates.csv --prod   the shop's
 *   … --replace   the list overwrites rates corrected in the app since
 *   … --dry-run   only print what would go in
 *
 * Columns: Brand, Grade, Product Code, Product, Size, MRP, After CD,
 * After Margin, Wire, Finish. The net rate is After CD or After Margin,
 * whichever the maker's list gives. Sent in batches, because Windows will not
 * pass a long argument to a command.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [file, ...flags] = process.argv.slice(2)
if (!file) { console.error('Which CSV?'); process.exit(1) }
const category = flags.find((f) => f.startsWith('--category='))?.slice(11) ?? 'Kitchen basket'

/** One CSV line, with "quoted, fields" allowed. */
function cells(line) {
  const out = []; let cur = ''; let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const text = readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, '')
const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.trim())
const cols = cells(head)
const at = (row, name) => row[cols.indexOf(name)] ?? ''
const num = (s) => (s === '' ? undefined : Number(s))

const rows = []
const skipped = []
for (const line of lines) {
  const r = cells(line)
  const brand = at(r, 'Brand'), product = at(r, 'Product'), size = at(r, 'Size')
  const mrp = num(at(r, 'MRP')), cd = num(at(r, 'After CD')), margin = num(at(r, 'After Margin'))
  const code = at(r, 'Product Code')
  // A heading the list carries between its rows ("17×18 range"), not an item.
  if (!code && mrp === undefined && cd === undefined && margin === undefined && /range/i.test(size)) { skipped.push(line); continue }
  if (!brand || !product) { skipped.push(line); continue }
  const finish = at(r, 'Finish')
  const net = cd ?? margin
  rows.push({
    category, brand, product, size,
    ...(at(r, 'Grade') ? { grade: at(r, 'Grade') } : {}),
    ...(code ? { code } : {}),
    ...(at(r, 'Wire') ? { wire: at(r, 'Wire') } : {}),
    // Most lists repeat the product as the finish; only a different one says anything.
    ...(finish && finish.toLowerCase() !== product.toLowerCase() ? { finish } : {}),
    ...(mrp !== undefined ? { mrp } : {}),
    ...(net !== undefined ? { net, netLabel: cd !== undefined ? 'After CD' : 'After margin' } : {}),
  })
}
for (const row of rows) {
  for (const k of ['mrp', 'net']) if (row[k] !== undefined && !Number.isFinite(row[k])) throw new Error(`Not a number: ${JSON.stringify(row)}`)
}

const by = rows.reduce((m, r) => ({ ...m, [r.brand]: (m[r.brand] ?? 0) + 1 }), {})
console.log(`${rows.length} items (${Object.entries(by).map(([b, n]) => `${b} ${n}`).join(', ')}); skipped ${skipped.length}: ${skipped.join(' | ')}`)
if (flags.includes('--dry-run')) process.exit(0)

const convex = path.join(root, 'node_modules', 'convex', 'bin', 'main.js')
const total = { added: 0, updated: 0, kept: 0 }
for (let i = 0; i < rows.length; i += 40) {
  const args = JSON.stringify({ rows: rows.slice(i, i + 40), ...(flags.includes('--replace') ? { replace: true } : {}) })
  const res = spawnSync(process.execPath, [convex, 'run', ...(flags.includes('--prod') ? ['--prod'] : []), 'prices:seed', args], { cwd: root, encoding: 'utf8' })
  if (res.status !== 0) { console.error(res.stdout, res.stderr); process.exit(1) }
  const got = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')))
  for (const k of Object.keys(total)) total[k] += got[k]
}
console.log(`Added ${total.added}, updated ${total.updated}, kept ${total.kept}.`)
