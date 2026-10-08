import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Mica Match — the shop's own colour list of laminate chips.
 *
 * Every chip of every catalog is shot once and kept here as its shades; a
 * customer's sample is then measured the same way on the phone and compared
 * against all of them there. Matching runs on the phone because the list is
 * small and the answer is wanted the instant the photo is taken.
 */

const shade = v.object({ L: v.number(), a: v.number(), b: v.number(), w: v.number() });

const clean = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

/** The code as the catalog prints it, in one spelling: "122 - hdg" → "122-HDG". */
const codeOf = (s: string) => clean(s).toUpperCase().replace(/\s*-\s*/g, "-");

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Every chip, newest first, with its photo ready to show. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const chips = await ctx.db.query("micaChips").order("desc").collect();
    return Promise.all(
      chips.map(async (c) => ({ ...c, photoUrl: c.photo ? await ctx.storage.getUrl(c.photo) : null }))
    );
  },
});

/**
 * Saves a chip. The same code from the same brand and catalog is the same
 * chip, so shooting it again replaces the reading rather than adding a twin.
 */
export const save = mutation({
  args: {
    brand: v.string(),
    catalog: v.optional(v.string()),
    code: v.string(),
    finish: v.optional(v.string()),
    shades: v.array(shade),
    texture: v.number(),
    corrected: v.boolean(),
    photo: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const brand = clean(args.brand);
    const code = codeOf(args.code);
    if (!brand) throw new ConvexError("Enter the brand.");
    if (!code) throw new ConvexError("Enter the chip's code.");
    if (!args.shades.length) throw new ConvexError("No colour was read from the photo.");
    const catalog = clean(args.catalog) || undefined;
    const finish = clean(args.finish) || undefined;
    const now = Date.now();

    const same = (await ctx.db.query("micaChips").withIndex("by_code", (q) => q.eq("code", code)).collect())
      .find((c) => c.brand.toLowerCase() === brand.toLowerCase() && (c.catalog ?? "") === (catalog ?? ""));
    const fields = { brand, catalog, code, finish, shades: args.shades, texture: args.texture, corrected: args.corrected, photo: args.photo, updatedAt: now };
    if (same) {
      await ctx.db.patch(same._id, fields);
      if (same.photo && same.photo !== args.photo) await ctx.storage.delete(same.photo);
      return { id: same._id, replaced: true };
    }
    const id = await ctx.db.insert("micaChips", { ...fields, createdAt: now });
    return { id, replaced: false };
  },
});

/** Corrects a chip's name, catalog or finish without reshooting it. */
export const rename = mutation({
  args: {
    id: v.id("micaChips"),
    brand: v.string(),
    catalog: v.optional(v.string()),
    code: v.string(),
    finish: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...rest }) => {
    const brand = clean(rest.brand);
    const code = codeOf(rest.code);
    if (!brand || !code) throw new ConvexError("Brand and code are both needed.");
    await ctx.db.patch(id, {
      brand, code, catalog: clean(rest.catalog) || undefined, finish: clean(rest.finish) || undefined, updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("micaChips") },
  handler: async (ctx, { id }) => {
    const chip = await ctx.db.get(id);
    if (!chip) return;
    await ctx.db.delete(id);
    if (chip.photo) await ctx.storage.delete(chip.photo);
  },
});
