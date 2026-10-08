import { v } from "convex/values";
import { mutation, query } from "./lib/guarded";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { record } from "./lib/history";

/**
 * The shop's marks: what the seven colours are called here, and which of them
 * is stamped on a photograph as it is taken.
 *
 * The palette itself is fixed in the app — seven colours you can tell apart at
 * a glance. All that lives here is the meaning the shop has put on them, which
 * is the part the app has no business deciding.
 */
const KEY = "shop";

async function row(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
}

export const settings = query({
  args: {},
  handler: async (ctx) => {
    const held = await row(ctx);
    return {
      tagNames: held?.tagNames ?? [],
      autoTag: held?.autoTag ?? null,
    };
  },
});

/** The mark to put on every new photograph, or null to stop marking them. */
export const setAutoTag = mutation({
  args: { tag: v.union(v.string(), v.null()) },
  handler: async (ctx, { tag }) => {
    const held = await row(ctx);
    const autoTag = tag ?? undefined;
    if (held) await ctx.db.patch(held._id, { autoTag, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { key: KEY, autoTag, updatedAt: Date.now() });
    await record(
      ctx,
      "tags.auto",
      tag ? `New photographs are marked ${tag}` : "New photographs are no longer marked"
    );
    return { autoTag: tag };
  },
});

/** What this shop calls one of the colours. An empty name goes back to none. */
export const nameTag = mutation({
  args: { tag: v.string(), name: v.string() },
  handler: async (ctx, { tag, name }) => {
    const held = await row(ctx);
    const kept = (held?.tagNames ?? []).filter((t) => t.id !== tag);
    const clean = name.trim();
    const tagNames = clean ? [...kept, { id: tag, name: clean }] : kept;
    if (held) await ctx.db.patch(held._id, { tagNames, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { key: KEY, tagNames, updatedAt: Date.now() });
    return { tagNames };
  },
});

/**
 * Adds or removes a mark on one bill.
 *
 * Given a photograph still in the pile it marks the photograph; given a
 * voucher it marks the voucher. The same mark has to work on both or it would
 * be lost the moment a bill was approved, which is precisely when the shop
 * starts wanting to find it again.
 */
export const toggleOnBill = mutation({
  args: {
    tag: v.string(),
    inboxId: v.optional(v.id("inbox")),
    voucherId: v.optional(v.id("vouchers")),
  },
  handler: async (ctx, { tag, inboxId, voucherId }) => {
    const id = inboxId ?? voucherId;
    if (!id) throw new Error("Name the photograph or the voucher to mark");

    const doc: any = await ctx.db.get(id as any);
    if (!doc) throw new Error("That bill is no longer there");

    const held: string[] = doc.tags ?? [];
    const tags = held.includes(tag) ? held.filter((t) => t !== tag) : [...held, tag];

    // Every sheet of a bill carries the same marks — the mark is on the bill,
    // not on whichever page happened to be clicked.
    if (inboxId && doc.groupId) {
      const pages = await ctx.db
        .query("inbox")
        .withIndex("by_group", (q) => q.eq("groupId", doc.groupId))
        .collect();
      for (const page of pages) await ctx.db.patch(page._id, { tags });
    } else {
      await ctx.db.patch(id as any, { tags });
    }
    return tags;
  },
});

/** The mark to stamp on a photograph being taken now, if the shop set one. */
export async function autoTagFor(ctx: MutationCtx): Promise<string[] | undefined> {
  const held = await row(ctx);
  return held?.autoTag ? [held.autoTag] : undefined;
}
