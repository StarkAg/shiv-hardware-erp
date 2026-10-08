/**
 * Stock on hand, worked out from the bills — for the Inventory site.
 *
 * There is no stock ledger to read: goods come in on a supplier's bill and go
 * out on a customer's, so stock is counted from those. Purchases and goods
 * received add; sales take away; a goods return goes back to whichever side it
 * came from (a customer's return adds, a return to a supplier takes away).
 * Quotations move nothing.
 *
 * The shelf has the last word. A count typed in from the godown resets an item
 * to what is actually there, and only the bills after that count move it again
 * — so stock bought before the panel existed, breakage and theft are all
 * absorbed the first time somebody counts.
 *
 * An item is the My Items entry a bill line was picked from (a line typed
 * freehand is matched by its name), with the pairs in `itemSame` followed to
 * the end, exactly as the profit page does. Lines in another unit are counted
 * through the item's pack size ("1 Box = 10 Pc") when one is set, and shown
 * apart when not, rather than added in the wrong unit.
 *
 * Reading stock is open. Editing counts and settings requires the Inventory
 * PIN, kept in the deployment environment. The shop-facing list is restricted
 * to the supplied plywood and 30 mm Signature door rows through seedList.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./lib/guarded";
import type { QueryCtx } from "./_generated/server";
import { readBills } from "./lib/billRows";
import { canonicalUnit } from "./lib/text";
import { INVENTORY_SEED, seedRefForName } from "./lib/inventorySeed";
import { requireInventoryPin } from "./lib/inventoryPin";

/* ── which item a line is (same rules as src/lib/profit.ts) ─────────────── */

const foldItemName = (d: unknown) =>
  String(d ?? "")
    .replace(/[×✕]/g, "x") // emoji-ok: reads a typed cross
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .toLowerCase()
    .replace(/(\d)\s*x\s*(\d)/g, "$1x$2")
    .replace(/[^a-z0-9x/+".' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const refOf = (i: { description?: string; customEntryId?: string }) =>
  i.customEntryId ? `id:${i.customEntryId}` : `name:${foldItemName(i.description)}`;

function resolver(pairs: { from: string; to: string }[]) {
  const next = new Map(pairs.map((p) => [p.from, p.to]));
  return (ref: string) => {
    let at = ref;
    const seen = new Set([at]);
    for (;;) {
      const to = next.get(at);
      if (!to || seen.has(to)) return at;
      seen.add(to);
      at = to;
    }
  };
}

/** Pc, Nos, Sheet and no unit at all are one count of pieces. */
const PIECES = new Set(["", "pc", "pcs", "piece", "pieces", "nos", "no", "sheet", "sheets", "sht"]);
const unitKey = (u: unknown) => {
  const k = String(u ?? "").trim().toLowerCase().replace(/\.$/, "");
  return PIECES.has(k) ? "pc" : k;
};

const CHARGE = /^(fare|freight|transport|labou?r|loading|unloading|cartage|delivery|packing|round ?off|discount|gst|cgst|sgst|igst|tax)\b/i;
// A bare amount ("Bill", "Goods") is money with no item behind it.
const LUMP = /^(?:bill|goods|cash return|amount|balance)$/i;
const isGoods = (i: any) =>
  Boolean(String(i?.description ?? "").trim()) &&
  !LUMP.test(String(i?.description ?? "").trim()) &&
  Number(i?.qty) > 0 &&
  !i.isRoundup && !i.isDiscount && !i.auto &&
  !CHARGE.test(String(i.description).trim());

const dayOf = (d: unknown) => String(d ?? "").slice(0, 10);

/* ── the movements ──────────────────────────────────────────────────────── */

type Move = {
  ref: string;
  day: string;
  at: number; // when the bill was last saved, to order a count made mid-day
  kind: "in" | "out";
  why: string; // Purchase, Sale, Goods Received, Return in, Return out
  qty: number;
  unit: string;
  each: number | null;
  party: string;
  number: string;
  billId: string;
  name: string;
  // The stock-list item it was picked as, when the bill named one outright.
  stockRef?: string;
};

async function moves(ctx: QueryCtx) {
  const [bills, same, groups, ledgers, entries] = await Promise.all([
    readBills(ctx),
    ctx.db.query("itemSame").collect(),
    ctx.db.query("groups").collect(),
    ctx.db.query("ledgers").collect(),
    catalog(ctx),
  ]);
  // A line typed freehand under a My Items name (or one of its other names)
  // is that item — unless the shop has already paired the name elsewhere.
  const paired = new Set(same.map((p) => p.from));
  const byName = new Map<string, string>();
  for (const e of entries) {
    for (const n of [e.name, ...((e.alsoKnownAs ?? []) as string[])]) {
      const key = `name:${foldItemName(n)}`;
      if (!paired.has(key) && !byName.has(key)) byName.set(key, `id:${e.id}`);
    }
  }
  const pairs = resolver(same);
  const resolve = (ref: string) => pairs(byName.get(ref) ?? ref);
  const groupName = new Map(groups.map((g) => [String(g._id), g.name]));
  const sideOf = new Map(ledgers.map((l) => [String(l._id), groupName.get(String(l.groupId)) ?? ""]));

  const out: Move[] = [];
  for (const bill of bills) {
    if (!bill || bill.deleted) continue;
    const kind = bill.kind ?? "sale";
    let dir: "in" | "out" | null = null;
    let why = "";
    if (kind === "purchase") { dir = "in"; why = "Purchase"; }
    else if (kind === "grn") { dir = "in"; why = "Goods received"; }
    else if (kind === "sale") { dir = "out"; why = "Sale"; }
    else if (kind === "return") {
      const supplier = sideOf.get(String(bill.ledgerId ?? "")) === "Sundry Creditors";
      dir = supplier ? "out" : "in";
      why = supplier ? "Returned to supplier" : "Customer return";
    }
    if (!dir) continue;
    for (const item of bill.items ?? []) {
      if (!isGoods(item)) continue;
      const qty = Number(item.qty);
      const amount = Number(item.amount);
      out.push({
        ref: resolve(refOf(item)),
        day: dayOf(bill.date),
        at: Number(bill.updatedAt ?? 0),
        kind: dir,
        why,
        qty,
        unit: canonicalUnit(item.unit) || "Pc",
        each: amount > 0 ? Math.round((amount / qty) * 100) / 100 : null,
        party: String(bill.customerName ?? ""),
        number: String(bill.number ?? ""),
        billId: String(bill.id ?? ""),
        name: String(item.description ?? "").trim(),
      });
    }
    // A bill entered as its total still says what it took off or put on the
    // shelf, picked from the stock list rather than written as lines.
    for (const line of bill.stock ?? []) {
      const qty = Number(line?.qty);
      if (!line?.ref || !(qty > 0)) continue;
      const name = String(line.name ?? "").trim();
      out.push({
        ref: resolve(`name:${foldItemName(name)}`),
        stockRef: String(line.ref),
        day: dayOf(bill.date),
        at: Number(bill.updatedAt ?? 0),
        kind: dir,
        why,
        qty,
        unit: "Pc",
        each: null,
        party: String(bill.customerName ?? ""),
        number: String(bill.number ?? ""),
        billId: String(bill.id ?? ""),
        name,
      });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at);
}

/** A line came after a count if its bill is dated later, or the same day and saved after it. */
const afterCount = (m: Move, c: { day: string; at: number }) =>
  m.day > c.day || (m.day === c.day && m.at > c.at);

/* ── the items ──────────────────────────────────────────────────────────── */

async function catalog(ctx: QueryCtx) {
  const row = await ctx.db.query("catalogStore").first();
  return ((row?.customCatalog ?? []) as any[]).filter((e) => e && e.id && e.name);
}

async function settings(ctx: QueryCtx) {
  const [items, counts] = await Promise.all([
    ctx.db.query("stockItems").collect(),
    ctx.db.query("stockCounts").collect(),
  ]);
  const lastCount = new Map<string, (typeof counts)[number]>();
  for (const c of counts.sort((a, b) => a.at - b.at)) lastCount.set(c.ref, c);
  return { items: new Map(items.map((i) => [i.ref, i])), lastCount };
}

/** Most common unit among an item's lines, pieces if none. */
function usualUnit(list: Move[]) {
  const n = new Map<string, number>();
  for (const m of list) n.set(m.unit, (n.get(m.unit) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Pc";
}

/** Converts a line to the item's main unit, or null if no pack size says how. */
function inMain(m: Move, main: string, packs: Record<string, number> | undefined) {
  if (unitKey(m.unit) === unitKey(main)) return m.qty;
  const per = packs?.[m.unit] ?? packs?.[canonicalUnit(m.unit)];
  return per && per > 0 ? m.qty * per : null;
}

function summarise(ref: string, list: Move[], setting: any, count: any, entry: any) {
  const main = setting?.unit || entry?.unit ? canonicalUnit(setting?.unit || entry?.unit) : usualUnit(list);
  const since = count ? list.filter((m) => afterCount(m, count)) : list;
  let stock = count ? count.qty : 0;
  let bought = 0, sold = 0;
  const other = new Map<string, number>();
  for (const m of since) {
    const q = inMain(m, main, setting?.packs);
    if (q === null) {
      other.set(m.unit, (other.get(m.unit) ?? 0) + (m.kind === "in" ? m.qty : -m.qty));
      continue;
    }
    if (m.kind === "in") { stock += q; bought += q; } else { stock -= q; sold += q; }
  }
  const buys = list.filter((m) => m.kind === "in" && m.each !== null && m.why !== "Customer return");
  const sales = list.filter((m) => m.why === "Sale" && m.each !== null);
  const lastBuy = buys[buys.length - 1] ?? null;
  const lastSale = sales[sales.length - 1] ?? null;
  // Cost of one in the main unit, when the last purchase was in it.
  const costEach = lastBuy && unitKey(lastBuy.unit) === unitKey(main) ? lastBuy.each : null;
  const lastMove = list[list.length - 1] ?? null;
  const min = setting?.min ?? null;
  const rounded = Math.round(stock * 1000) / 1000;
  return {
    ref,
    name: entry?.name ?? lastMove?.name ?? ref.replace(/^name:/, ""),
    listed: Boolean(entry),
    aliases: (entry?.alsoKnownAs ?? []) as string[],
    unit: main,
    stock: rounded,
    bought: Math.round(bought * 1000) / 1000,
    sold: Math.round(sold * 1000) / 1000,
    otherUnits: [...other].filter(([, q]) => q !== 0).map(([unit, qty]) => ({ unit, qty })),
    min,
    place: setting?.place ?? "",
    note: setting?.note ?? "",
    packs: setting?.packs ?? null,
    counted: count ? { qty: count.qty, day: count.day, at: count.at, note: count.note ?? "" } : null,
    lastBuy: lastBuy && { day: lastBuy.day, each: lastBuy.each, unit: lastBuy.unit, party: lastBuy.party },
    lastSale: lastSale && { day: lastSale.day, each: lastSale.each, unit: lastSale.unit },
    rate: typeof entry?.rate === "number" ? entry.rate : null,
    value: costEach !== null && rounded > 0 ? Math.round(costEach * rounded) : null,
    lastMove: lastMove?.day ?? null,
    moves: list.length,
    // Below zero with no count: more went out on bills than came in on them
    // (stock from before the panel) — a count is what settles it.
    status: !count && rounded < 0 ? "check" : rounded <= 0 ? "out" : min !== null && rounded <= min ? "low" : "ok",
  };
}

/**
 * Every item with its stock. My Items entries always appear (stock 0 until a
 * bill or count moves them); a name only ever typed freehand appears when it
 * has moved, marked as not in My Items.
 */
export const list = query({
  args: { pin: v.optional(v.string()) },
  handler: async (ctx) => {
    const [all, entries, s] = await Promise.all([moves(ctx), catalog(ctx), settings(ctx)]);
    const byRef = new Map<string, Move[]>();
    for (const m of all) byRef.set(m.ref, [...(byRef.get(m.ref) ?? []), m]);
    const entryByRef = new Map(entries.map((e) => [`id:${e.id}`, e]));
    const refs = new Set([...entryByRef.keys(), ...byRef.keys(), ...s.lastCount.keys(), ...s.items.keys()]);
    const items = [...refs].map((ref) =>
      summarise(ref, byRef.get(ref) ?? [], s.items.get(ref), s.lastCount.get(ref), entryByRef.get(ref)),
    );
    return items.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One item: its stock and every movement and count, newest first. */
export const item = query({
  args: { pin: v.optional(v.string()), ref: v.string() },
  handler: async (ctx, { ref }) => {
    const [all, entries, s, counts] = await Promise.all([
      moves(ctx),
      catalog(ctx),
      settings(ctx),
      ctx.db.query("stockCounts").withIndex("by_ref", (q) => q.eq("ref", ref)).collect(),
    ]);
    const mine = all.filter((m) => m.ref === ref);
    const entry = entries.find((e) => `id:${e.id}` === ref);
    return {
      ...summarise(ref, mine, s.items.get(ref), s.lastCount.get(ref), entry),
      history: [
        ...mine.map((m) => ({ type: "move" as const, ...m })),
        ...counts.map((c) => ({ type: "count" as const, day: c.day, at: c.at, qty: c.qty, note: c.note ?? "" })),
      ].sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at),
    };
  },
});

/** The latest movements across every item, for the Moves tab. */
export const recent = query({
  args: { pin: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const all = await moves(ctx);
    return all.slice(-(limit ?? 150)).reverse();
  },
});

/** "There are 14 on the shelf" — resets the item to what was counted. */
export const count = mutation({
  args: { pin: v.optional(v.string()), ref: v.string(), qty: v.number(), note: v.optional(v.string()), day: v.optional(v.string()) },
  handler: async (ctx, { pin, ref, qty, note, day }) => {
    requireInventoryPin(pin);
    if (!Number.isFinite(qty) || qty < 0) throw new Error("Count must be zero or more");
    const at = Date.now();
    await ctx.db.insert("stockCounts", {
      ref,
      qty,
      day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date(at + 5.5 * 3600_000).toISOString().slice(0, 10),
      at,
      note: note?.trim() || undefined,
    });
    return { ok: true };
  },
});

/** Reorder level, rack/shelf, main unit and pack sizes for one item. */
export const setItem = mutation({
  args: {
    pin: v.optional(v.string()),
    ref: v.string(),
    min: v.optional(v.union(v.number(), v.null())),
    place: v.optional(v.string()),
    unit: v.optional(v.string()),
    packs: v.optional(v.union(v.record(v.string(), v.number()), v.null())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { pin, ref, ...patch }) => {
    requireInventoryPin(pin);
    const row = await ctx.db.query("stockItems").withIndex("by_ref", (q) => q.eq("ref", ref)).first();
    const next = {
      min: patch.min === undefined ? row?.min : patch.min ?? undefined,
      place: patch.place === undefined ? row?.place : patch.place.trim() || undefined,
      unit: patch.unit === undefined ? row?.unit : canonicalUnit(patch.unit) || undefined,
      packs: patch.packs === undefined ? row?.packs : patch.packs ?? undefined,
      note: patch.note === undefined ? row?.note : patch.note.trim() || undefined,
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("stockItems", { ref, ...next });
    return { ok: true };
  },
});

/** Unlocking the editor is read-only; mutations also check the PIN themselves. */
export const checkPin = query({
  args: { pin: v.optional(v.string()) },
  handler: async (_ctx, { pin }) => {
    requireInventoryPin(pin);
    return true;
  },
});

const today = (at: number) => new Date(at + 5.5 * 3600_000).toISOString().slice(0, 10);

async function seededStock(ctx: QueryCtx) {
  const [all, s, products] = await Promise.all([moves(ctx), settings(ctx), ctx.db.query("inventoryProducts").collect()]);
  const customByName = new Map(products.map(product => [foldItemName(product.name), product.ref]));
  const mapped = new Map<string, Move[]>();
  for (const move of all) {
    const ref = move.stockRef ?? seedRefForName(move.name) ?? customByName.get(foldItemName(move.name));
    if (ref) mapped.set(ref, [...(mapped.get(ref) ?? []), move]);
  }
  const at = Date.now();
  const catalogue = [
    ...INVENTORY_SEED.map(seed => ({ ...seed, category: seed.ref.startsWith("seed:door:") ? "door" : "ply" })),
    ...products.map(product => ({ ...product, qty: 0 })),
  ];
  return catalogue.map((seed) => {
    const count = s.lastCount.get(seed.ref);
    // Until initialization, display the supplied opening quantity without
    // applying historical bills to a notebook date the shop hasn't confirmed.
    const baseline = count ?? { qty: seed.qty, day: today(at), at, note: "Supplied opening stock" };
    return { ...summarise(seed.ref, count ? mapped.get(seed.ref) ?? [] : [],
      { min: 2, ...s.items.get(seed.ref), unit: "Pc" }, baseline,
      { name: seed.name, unit: "Pc" }), brand: seed.brand, mm: seed.mm, size: seed.size, category: seed.category,
      ...("label" in seed && seed.label ? { label: seed.label } : {}) };
  });
}

export const seedList = query({
  args: {},
  handler: seededStock,
});

/** New shelf items belong to the inventory catalogue, with an opening count. */
export const addItem = mutation({
  args: {
    pin: v.string(), category: v.union(v.literal("ply"), v.literal("door"), v.literal("other")),
    brand: v.string(),
    mm: v.optional(v.number()), height: v.optional(v.number()), width: v.optional(v.number()), qty: v.number(),
    label: v.optional(v.string()), packSize: v.optional(v.string()),
  },
  handler: async (ctx, { pin, category, brand: rawBrand, mm, height, width, qty, label: rawLabel, packSize }) => {
    requireInventoryPin(pin);
    const clean = (value: string) => value.trim().replace(/\s+/g, " ");
    const enteredBrand = clean(rawBrand);
    if (!enteredBrand || enteredBrand.length > 60) throw new ConvexError("Enter a brand of 1 to 60 characters, or use Unbranded.");
    const products = await ctx.db.query("inventoryProducts").collect();
    const brands = ["Signature", "Signature Gold", "Milton", "Fevicol", ...products.map(product => product.brand)];
    const brand = brands.find(value => value.toLowerCase() === enteredBrand.toLowerCase()) ?? enteredBrand;
    if (category !== "other" && ![mm, height, width].every(value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1000)) {
      throw new ConvexError("Enter a thickness and dimensions greater than zero and no more than 1000.");
    }
    if (!Number.isSafeInteger(qty) || qty < 0) throw new ConvexError("Opening quantity must be a whole number of zero or more.");
    const label = clean(rawLabel ?? "");
    const size = category === "other" ? clean(packSize ?? "") : `${height}x${width}`;
    if (category === "other" && (!label || label.length > 100 || !size || size.length > 60)) {
      throw new ConvexError("Enter a product name (up to 100 characters) and pack size or unit (up to 60 characters).");
    }
    const key = (value: string) => encodeURIComponent(value.toLowerCase().replace(/\s+/g, ""));
    const ref = category === "other" ? `custom:other:${key(brand)}:${key(label)}:${key(size)}`
      : `custom:${category}:${brand.toLowerCase().replace(/ /g, "-")}:${mm}:${size}`;
    const existing = await ctx.db.query("inventoryProducts").withIndex("by_ref", q => q.eq("ref", ref)).first();
    if (existing || INVENTORY_SEED.some(seed => seed.brand === brand && seed.mm === mm && seed.size === size
      && seed.ref.startsWith(`seed:${category}:`))) {
      throw new ConvexError("This item already exists. Use its quantity buttons in Edit.");
    }
    const product = category === "other"
      ? { ref, name: `${brand} ${label} ${size}`, category, brand, label, size }
      : { ref, name: `${mm}mm ${brand} ${height} x ${width}`, category, brand, mm, size };
    await ctx.db.insert("inventoryProducts", product);
    const at = Date.now();
    await ctx.db.insert("stockCounts", { ref, qty, day: today(at), at, note: "Opening quantity from Inventory Add" });
    return { ...product, stock: qty, min: 2, unit: "Pc" };
  },
});

/** One-time opening stock. Re-running never resets an existing count or edit. */
export const initializeSeed = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    requireInventoryPin(pin);
    const at = Date.now();
    let inserted = 0;
    for (const seed of INVENTORY_SEED) {
      const existing = await ctx.db.query("stockCounts").withIndex("by_ref", q => q.eq("ref", seed.ref)).first();
      if (existing) continue;
      await ctx.db.insert("stockCounts", {
        ref: seed.ref, qty: seed.qty, day: today(at), at,
        note: "Opening stock from the supplied plywood and door list; loaded on entry date",
      });
      inserted++;
    }
    return { inserted, items: INVENTORY_SEED.length };
  },
});

/** Read and adjust in the same transaction so simultaneous taps cannot overwrite one another. */
export const adjustSeed = mutation({
  args: {
    pin: v.string(),
    ref: v.string(),
    delta: v.union(v.literal(-1), v.literal(1)),
    // Generated on the device before the tap appears on screen. A lost
    // response can therefore be retried without counting the same tap twice.
    operationId: v.optional(v.string()),
  },
  handler: async (ctx, { pin, ref, delta, operationId }) => {
    requireInventoryPin(pin);
    if (!INVENTORY_SEED.some(i => i.ref === ref)
      && !await ctx.db.query("inventoryProducts").withIndex("by_ref", q => q.eq("ref", ref)).first()) {
      throw new ConvexError("This item is not in your stock list.");
    }
    if (operationId) {
      const previous = await ctx.db
        .query("inventorySyncOps")
        .withIndex("by_operation", q => q.eq("operationId", operationId))
        .unique();
      if (previous) {
        if (previous.ref !== ref || previous.delta !== delta) throw new ConvexError("That device operation does not match this stock change.");
        return { qty: previous.qty, duplicate: true };
      }
    }
    const item = (await seededStock(ctx)).find(i => i.ref === ref)!;
    // A physical shelf count starts at zero when old bills show a deficit.
    const qty = Math.max(0, item.stock) + delta;
    if (qty < 0) throw new ConvexError("Stock cannot go below zero.");
    const at = Date.now();
    await ctx.db.insert("stockCounts", {
      ref, qty, day: today(at), at, note: `Inventory Edit: ${delta > 0 ? "+1" : "-1"}`,
    });
    if (operationId) await ctx.db.insert("inventorySyncOps", { operationId, ref, delta, qty, at });
    return { qty, duplicate: false };
  },
});
