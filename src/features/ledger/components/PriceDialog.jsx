import React, { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../../lib/store';
import { api } from '../../../../convex/_generated/api';
import Combo from './Combo';
import { shortDate, today } from '../lib/format';
import { groupLabel } from '../lib/groups';
import BillViewer from './BillViewer';
import { AttachmentThumbnail } from '../../../components/AttachmentViewer';

/** Fills in the amount on a bill that was filed without one. */
// Which account the other side of the voucher belongs to.
const ACCOUNT_GROUP = { Purchase: 'Purchase Accounts', Sale: 'Sales Accounts' };

export default function PriceDialog({ voucher, ledgers, groups, onClose }) {
  /**
   * A bill filed without an amount is priced in the bill itself, the way
   * Tally changes an invoice: the books refuse a price put on its voucher
   * alone (vouchers.price), which left bill 76 saying 0 against a voucher of
   * 12,600. Same lookup as VoucherEditor.
   */
  const bills = useStore((st) => st.bills);
  const navigate = useNavigate();
  const ref = String(voucher.refNo ?? '');
  const fromBill = bills.find((b) => String(b.voucherId ?? '') === String(voucher._id))
    ?? (ref.startsWith('BILL-') ? bills.find((b) => String(b.number) === ref.slice(5)) : null);
  useEffect(() => {
    if (!fromBill) return;
    onClose();
    navigate(`/bills/${fromBill.id}`);
  }, [fromBill, navigate, onClose]);
  const groupName = ACCOUNT_GROUP[voucher.vchType] ?? 'Purchase Accounts';
  const accounts = ledgers.filter((l) => l.groupName === groupName);
  const [amount, setAmount] = useState('');
  const [refNo, setRefNo] = useState(voucher.refNo || '');
  const [accountId, setAccountId] = useState(accounts[0]?._id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(false);
  const price = useMutation(api.vouchers.price);
  const createLedger = useMutation(api.masters.createLedger);

  const openAccount = async (name) => {
    const group = groups.find((g) => g.name === groupName);
    if (!group) throw new Error(`No group named ${groupName}`);
    return createLedger({
      name,
      groupId: group._id,
      openingBalance: 0,
      openingSide: groupName === 'Sales Accounts' ? 'Cr' : 'Dr',
      openingAsOf: today(),
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) return setError('Enter an amount above zero');
    setBusy(true);
    try {
      await price({
        id: voucher._id,
        amount: value,
        accountLedgerId: accountId,
        refNo: refNo.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
    return undefined;
  };

  if (fromBill) return null;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2>{voucher.party ? `${voucher.party} · ` : ''}{shortDate(voucher.date)}</h2>
        {voucher.narration && <div className="hint">{voucher.narration}</div>}

        {voucher.attachmentUrls?.length > 0 && (
          <button type="button" className="shotbtn thumb" aria-label="Preview bill attachments" onClick={() => setViewing(true)}>
            <AttachmentThumbnail file={voucher.attachmentUrls[0]} />
          </button>
        )}

        <div className="row">
          <label>
            Amount
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label>
            Bill no.
            <input value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </label>
        </div>

        <label>
          {groupName === 'Sales Accounts' ? 'Sales account' : 'Purchase account'}
          <Combo
            options={accounts.map((l) => ({ id: l._id, name: l.name }))}
            value={accountId}
            onChange={setAccountId}
            onCreate={openAccount}
            createGroup={groupLabel(groupName)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      {viewing && <BillViewer voucher={voucher} onClose={() => setViewing(false)} />}
    </div>
  );
}
