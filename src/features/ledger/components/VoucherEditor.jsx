import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { useStore } from '../../../lib/store';

/**
 * Every edit opens the bill builder.
 *
 * A voucher and a bill are the same event written down, so there is one editor
 * for both. A voucher posted from a bill opens that bill; one written on the
 * ledger's own form, or approved from a photograph, opens as a bill with no
 * lines and the photograph attached — empty is a fair description of a slip
 * nobody has priced, and the lines can be typed whenever someone knows them.
 *
 * The old modal form is still used for writing a *new* voucher quickly; it is
 * no longer used to change one.
 */
export default function VoucherEditor({ id, onClose }) {
  const navigate = useNavigate();
  const bills = useStore((st) => st.bills);
  const detail = useLive(api.vouchers.detail, { id }, `voucher:${id}`);

  const ref = detail?.refNo || '';
  const fromBill = ref.startsWith('BILL-')
    ? bills.find((b) => String(b.number) === ref.slice('BILL-'.length))
    : null;

  useEffect(() => {
    if (!detail) return;
    onClose?.();
    navigate(fromBill ? `/bills/${fromBill.id}` : `/bills/voucher/${id}`);
  }, [detail, fromBill, id, navigate, onClose]);

  return null;
}
