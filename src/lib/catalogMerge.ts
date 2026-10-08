/**
 * The price list is one row on the server, saved whole. Two counters editing
 * it used to be a race: whichever saved last wrote its entire copy, so a
 * device holding an old list put old rates back and dropped items added
 * elsewhere in the meantime.
 *
 * Now a device saves against the version it last had. When the server has
 * moved on, the device takes the newer list and replays onto it only what
 * it changed itself — which item, which rate, which set — never the rest of
 * its old copy.
 */
import type { BrandSet, CustomCatalogEntry, HardwareCatalog } from './types'

export interface CatalogSnap {
  hardwareCatalog: HardwareCatalog
  customCatalog: CustomCatalogEntry[]
  sets: BrandSet[]
}

/** What one device changed: entries written or replaced, and entries removed. */
export interface CatalogDiff {
  hardware: { put: Record<string, unknown>; del: string[] }
  custom: { put: CustomCatalogEntry[]; del: string[] }
  sets: { put: BrandSet[]; del: string[] }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function diffById<T extends { id: string }>(base: T[], local: T[]) {
  const was = new Map(base.map((e) => [e.id, e]))
  const now = new Set(local.map((e) => e.id))
  return {
    put: local.filter((e) => !was.has(e.id) || !same(was.get(e.id), e)),
    del: base.filter((e) => !now.has(e.id)).map((e) => e.id),
  }
}

function applyById<T extends { id: string }>(target: T[], change: { put: T[]; del: string[] }): T[] {
  const gone = new Set(change.del)
  const put = new Map(change.put.map((e) => [e.id, e]))
  const out = target.filter((e) => !gone.has(e.id)).map((e) => put.get(e.id) ?? e)
  const there = new Set(out.map((e) => e.id))
  for (const e of change.put) if (!there.has(e.id)) out.push(e)
  return out
}

export function catalogDiff(base: CatalogSnap, local: CatalogSnap): CatalogDiff {
  const hwBase = (base.hardwareCatalog ?? {}) as Record<string, unknown>
  const hwLocal = (local.hardwareCatalog ?? {}) as Record<string, unknown>
  const put: Record<string, unknown> = {}
  for (const [k, e] of Object.entries(hwLocal)) if (!(k in hwBase) || !same(hwBase[k], e)) put[k] = e
  return {
    hardware: { put, del: Object.keys(hwBase).filter((k) => !(k in hwLocal)) },
    custom: diffById(base.customCatalog ?? [], local.customCatalog ?? []),
    sets: diffById(base.sets ?? [], local.sets ?? []),
  }
}

export const isEmptyDiff = (d: CatalogDiff) =>
  !Object.keys(d.hardware.put).length && !d.hardware.del.length &&
  !d.custom.put.length && !d.custom.del.length && !d.sets.put.length && !d.sets.del.length

export function applyCatalogDiff(target: CatalogSnap, d: CatalogDiff): CatalogSnap {
  const hardware = { ...((target.hardwareCatalog ?? {}) as Record<string, unknown>) }
  for (const k of d.hardware.del) delete hardware[k]
  Object.assign(hardware, d.hardware.put)
  return {
    hardwareCatalog: hardware as HardwareCatalog,
    customCatalog: applyById(target.customCatalog ?? [], d.custom),
    sets: applyById(target.sets ?? [], d.sets),
  }
}
