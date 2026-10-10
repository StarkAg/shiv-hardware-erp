const prefix = 'shiv-mechanic:'
export function read(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(prefix + key) || 'null') ?? fallback } catch { return fallback }
}
export function write(key, value) {
  try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true } catch { return false }
}
export function remove(key) {
  try { localStorage.removeItem(prefix + key) } catch { /* a retained draft is safe */ }
}

export function makeDraft(order) {
  const saved = new Map((order.sizes?.pieces ?? []).map((p) => [p.key, p]))
  const rows = order.pieces.map((p) => ({ key: p.key, what: p.what, w: '', h: '', note: '', ...saved.get(p.key) }))
  const keys = new Set(rows.map((p) => p.key))
  for (const p of saved.values()) if (!keys.has(p.key)) rows.push({ ...p })
  return { baseAt: order.sizes?.at ?? 0, unit: order.sizes?.unit ?? 'in', pieces: rows, notes: order.sizes?.notes ?? '' }
}
