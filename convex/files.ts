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

export const remove = mutation({
  args: { pin: v.string(), storageId: v.id("_storage")},
  handler: async (ctx, { pin, storageId }) => {
    requirePin(pin);
    await ctx.storage.delete(storageId);
  },
});
