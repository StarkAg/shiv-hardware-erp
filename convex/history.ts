import { query } from "./lib/guarded";
import { v } from "convex/values";

/** Everything that has been done, newest first. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("history")
      .withIndex("by_at")
      .order("desc")
      // Lines written for the seal alone say nothing a person needs to read.
      .filter((q) => q.neq(q.field("quiet"), true))
      .take(limit ?? 300);
    return rows.map((r) => ({
      _id: r._id,
      at: r.at,
      action: r.action,
      summary: r.summary,
      entity: r.entity ?? null,
      detail: r.detail ?? null,
    }));
  },
});
