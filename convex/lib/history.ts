import type { MutationCtx } from "../_generated/server";
import { nextSeal, voucherState } from "./seal";

/**
 * Writes a line into the history, sealed onto the chain. Every mutation that
 * changes anything calls this; nothing ever removes what it writes.
 *
 * The seal (./seal.ts) is the line's fingerprint over what it says and over
 * the fingerprint of the line before it, made in the same transaction as the
 * change it records. A line about a voucher also takes the fingerprint of the
 * voucher as it now stands.
 *
 * It is deliberately forgiving: a failure to record must never be the reason
 * a voucher fails to save. A voucher left without a sealed line that way is
 * found by the nightly check instead (convex/chain.ts).
 */
export async function record(
  ctx: MutationCtx,
  action: string,
  summary: string,
  extra?: { entity?: string; entityId?: string; detail?: unknown; quiet?: boolean }
) {
  try {
    let state: string | undefined;
    if (extra?.entity === "voucher" && extra.entityId) {
      const id = ctx.db.normalizeId("vouchers", extra.entityId);
      state = (id ? await voucherState(ctx, id) : null) ?? undefined;
    }
    const line = {
      at: Date.now(),
      action,
      summary,
      entity: extra?.entity,
      entityId: extra?.entityId,
      detail: extra?.detail === undefined ? undefined : JSON.stringify(extra.detail),
      state,
    };
    await ctx.db.insert("history", {
      ...line,
      ...(extra?.quiet ? { quiet: true } : {}),
      ...(await nextSeal(ctx, line)),
    });
  } catch {
    /* history is a record of the work, never a gate on it */
  }
}

/** "1,580.00" — money as the history states it. */
export const money = (n?: number | null) =>
  n === undefined || n === null
    ? "—"
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** "22-Aug-26", matching how dates read everywhere else. */
export const day = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS[d.getUTCMonth()]}-${String(
    d.getUTCFullYear()
  ).slice(2)}`;
};
