/**
 * Amounts are rupees to two decimals. At the magnitudes this shop deals in
 * (lakhs) float64 is exact well past the paisa, so the only discipline needed
 * is rounding on write and comparing with a tolerance below half a paisa.
 */
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const balanced = (signedTotal: number) => Math.abs(signedTotal) < 0.005;

/** Positive = Debit, negative = Credit. */
export const signed = (side: "Dr" | "Cr", amount: number) =>
  side === "Dr" ? amount : -amount;

export const sideOf = (signedAmount: number): "Dr" | "Cr" =>
  signedAmount >= 0 ? "Dr" : "Cr";

/** Financial year containing a date — April to March, as India runs it. */
export const fyOf = (ms: number): string => {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
};
