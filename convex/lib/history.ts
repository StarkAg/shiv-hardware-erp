import type { MutationCtx } from "../_generated/server";

/**
 * Writes a line into the history. Every mutation that changes anything calls
 * this; nothing ever removes what it writes.
 *
 * It is deliberately forgiving — a failure to record must never be the reason
 * a voucher fails to save.
 */
export async function record(
  ctx: MutationCtx,
  action: string,
  summary: string,
  extra?: { entity?: string; entityId?: string; detail?: unknown }
) {
  try {
    await ctx.db.insert("history", {
      at: Date.now(),
      action,
      summary,
      entity: extra?.entity,
      entityId: extra?.entityId,
      detail: extra?.detail === undefined ? undefined : JSON.stringify(extra.detail),
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
