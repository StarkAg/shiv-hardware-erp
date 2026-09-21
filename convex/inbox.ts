import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { record } from "./lib/history";
import { autoTagFor } from "./tags";

/** Photos waiting to be filed, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("inbox").withIndex("by_at").order("desc").take(60);
    return Promise.all(
      rows.map(async (r) => ({
        _id: r._id,
        storageId: r.storageId,
        at: r.at,
        note: r.note ?? "",
        groupId: r.groupId,
        stack: r.stack,
        url: await ctx.storage.getUrl(r.storageId),
      }))
    );
  },
});

/** The phone just took a picture. */
export const add = mutation({
  args: {
    storageId: v.id("_storage"),
    note: v.optional(v.string()),
    groupId: v.optional(v.string()),
    stack: v.optional(v.string()),
  },
  handler: async (ctx, { storageId, note, groupId, stack }) => {
    // Same rule at the other door: nothing enters the inbox as a PDF either.
    const meta = await ctx.db.system.get(storageId);
    if (meta?.contentType === "application/pdf") {
      throw new Error(
        "PDFs are not stored — render the pages to images before sending them in"
      );
    }
    // Marked here rather than by whoever is holding the phone: the one door
    // every photograph comes through, so the mark cannot be forgotten at the
    // counter — which is the only place it would ever be forgotten.
    const tags = await autoTagFor(ctx);
    const id = await ctx.db.insert("inbox", {
      storageId,
      at: Date.now(),
      note,
      groupId,
      stack,
      tags,
    });
    await record(ctx, "inbox.add", "Photo taken on the phone", { entity: "inbox", entityId: id });
    return id;
  },
});

/**
 * Takes a photo out of the inbox once it has been filed against a voucher.
 * The file itself is left alone — by then the voucher owns it.
 */
export const claim = mutation({
  args: { id: v.id("inbox") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/** Throws away a photo nobody wants, and the file with it. */
export const discard = mutation({
  args: { id: v.id("inbox") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await ctx.storage.delete(row.storageId).catch(() => {});
    await ctx.db.delete(id);
    await record(ctx, "inbox.discard", "Discarded a photo from the phone");
  },
});
