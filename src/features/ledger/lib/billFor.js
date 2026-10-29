/**
 * The shop's own bill behind a voucher, from the bills held on this device.
 *
 * The bill names its voucher outright; the BILL-n reference the posting
 * writes (and the operator cannot overwrite) is the fallback for bills saved
 * before they did. One test for every list that shows a voucher's bill — the
 * party ledger, Advances — so a bill found on one is found on all.
 */
export function billFor(bills, row) {
  if (!row) return null;
  if (row.billId) {
    const byId = bills.find((b) => b.id === row.billId);
    if (byId) return byId;
  }
  const id = String(row.voucherId ?? row._id ?? '');
  const named = id && bills.find((b) => String(b.voucherId ?? '') === id);
  if (named) return named;
  const ref = String(row.refNo ?? '');
  if (!ref.startsWith('BILL-')) return null;
  const number = ref.slice(5);
  return bills.find((b) => String(b.number) === number) ?? null;
}
