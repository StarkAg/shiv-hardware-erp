import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePin } from "./lib/pin";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => await ctx.storage.getUrl(storageId),
});

/** Resolve saved attachments together, including types for extensionless URLs. */
export const describe = query({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { storageIds }) => Promise.all(storageIds.map(async (storageId) => {
    const meta = await ctx.db.system.get(storageId);
    return {
      storageId,
      url: meta ? await ctx.storage.getUrl(storageId) : null,
      contentType: meta?.contentType ?? null,
    };
  })),
});

export const remove = mutation({
  args: { pin: v.string(), storageId: v.id("_storage")},
  handler: async (ctx, { pin, storageId }) => {
    requirePin(pin);
    await ctx.storage.delete(storageId);
  },
});
