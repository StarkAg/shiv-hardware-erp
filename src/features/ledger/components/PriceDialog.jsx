import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import Combo from './Combo';
import { shortDate, today } from '../lib/format';
import { groupLabel } from '../lib/groups';

/** Fills in the amount on a bill that was filed without one. */
// Which account the other side of the voucher belongs to.
const ACCOUNT_GROUP = { Purchase: 'Purchase Accounts', Sale: 'Sales Accounts' };

export default function PriceDialog({ voucher, ledgers, groups, onClose }) {
  const groupName = ACCOUNT_GROUP[voucher.vchType] ?? 'Purchase Accounts';
  const accounts = ledgers.filter((l) => l.groupName === groupName);
  const [amount, setAmount] = useState('');
  const [refNo, setRefNo] = useState(voucher.refNo || '');
  const [accountId, setAccountId] = useState(accounts[0]?._id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2>{voucher.party ? `${voucher.party} · ` : ''}{shortDate(voucher.date)}</h2>
        {voucher.narration && <div className="hint">{voucher.narration}</div>}

        {voucher.attachmentUrls?.length > 0 && (
          <img
            className="thumb"
            src={voucher.attachmentUrls[0].previewUrl ?? voucher.attachmentUrls[0].url}
            alt=""
          />
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
    </div>
  );
}
