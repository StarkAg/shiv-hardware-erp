import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { inputDate, today, fromInputDate, aadhaarGroups } from '../lib/format';

// Two kinds of ledger get opened by hand: the people the shop buys from and
// the people it sells to. Purchases, Sales, Cash and Bank already exist and are
// never created here — so they are not offered, and the two that are get
// called what they are rather than what Tally calls them.
const KINDS = [
  { group: 'Sundry Creditors', label: 'Supplier' },
  { group: 'Sundry Debtors', label: 'Customer' },
];

// `edit` is the ledger being changed; without it the form opens as a new one.
export default function LedgerForm({ groups: allGroups, edit, onClose }) {
  const editing = Boolean(edit);
  const groups = KINDS.map((k) => ({
    ...allGroups.find((g) => g.name === k.group),
    label: k.label,
  })).filter((g) => g._id);
  const creditorGroup = groups.find((g) => g.name === 'Sundry Creditors');
  const [name, setName] = useState(edit?.name ?? '');
  const [groupId, setGroupId] = useState(edit?.groupId ?? creditorGroup?._id ?? groups[0]?._id ?? '');
  const [opening, setOpening] = useState(edit?.openingBalance ? String(edit.openingBalance) : '');
  // A new account's opening sits on its group's normal side — a customer owes
  // (Dr), a supplier is owed (Cr) — and follows the group until it is set by hand.
  const sideOf = (id) => groups.find((g) => g._id === id)?.normalSide ?? 'Cr';
  const [side, setSide] = useState(edit?.openingSide ?? sideOf(edit?.groupId ?? creditorGroup?._id ?? groups[0]?._id));
  const [sideSet, setSideSet] = useState(Boolean(edit));
  const [asOf, setAsOf] = useState(inputDate(edit?.openingAsOf ?? today()));
  const [phone, setPhone] = useState(edit?.phone ?? '');
  const [phone2, setPhone2] = useState(edit?.phone2 ?? '');
  const [aadhaar, setAadhaar] = useState(aadhaarGroups(edit?.aadhaar ?? ''));
  const [notes, setNotes] = useState(edit?.notes ?? '');
  // Only customers are brought in by anybody — a supplier owes the shop no
  // commission, so the field is not offered on that side of the books.
  const [commissionTo, setCommissionTo] = useState(edit?.commissionTo ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isCustomer = groups.find((g) => g._id === groupId)?.name === 'Sundry Debtors';

  const createLedger = useMutation(api.masters.createLedger);
  const updateLedger = useMutation(api.masters.updateLedger);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the ledger a name');
    setBusy(true);
    try {
      if (editing) {
        // The group stays put: moving a party between suppliers and customers
        // would strand every voucher already written against them.
        await updateLedger({
          id: edit._id,
          name: name.trim(),
          // Sent even when empty, like the commission below: a box sent as
          // nothing never reaches the server, so a number cleared stayed.
          phone: phone.trim(),
          phone2: phone2.trim(),
          aadhaar: aadhaar.trim(),
          openingBalance: Number(opening) || 0,
          openingSide: side,
          openingAsOf: fromInputDate(asOf),
          notes: notes.trim(),
          // Sent even when empty: the server turns a blank into an unset, so
          // taking the carpenter off an account actually takes him off.
          commissionTo: isCustomer ? commissionTo.trim() : '',
        });
        onClose();
        return undefined;
      }
      await createLedger({
        name: name.trim(),
        groupId,
        phone: phone.trim() || undefined,
        phone2: phone2.trim() || undefined,
        aadhaar: aadhaar.trim() || undefined,
        openingBalance: Number(opening) || 0,
        openingSide: side,
        openingAsOf: fromInputDate(asOf),
        notes: notes.trim() || undefined,
        commissionTo: (isCustomer && commissionTo.trim()) || undefined,
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
        <h2>{editing ? `Edit ${edit.name}` : 'New ledger'}</h2>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>

        {/* Six groups that never change — a click each, rather than an OS
            dropdown that looks nothing like the rest of the app. */}
        <div className="labelled">
          <span>Under</span>
          {editing ? (
            <div className="fixedfield">
              {groups.find((g) => g._id === groupId)?.label ?? '—'}
            </div>
          ) : (
            <div className="chips">
              {groups.map((g) => (
                <button
                  type="button"
                  key={g._id}
                  className={`chip${groupId === g._id ? ' on' : ''}`}
                  onClick={() => {
                    setGroupId(g._id);
                    if (!sideSet) setSide(sideOf(g._id));
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="row">
          <label>
            Opening balance
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </label>
          <div className="labelled">
            <span>Side</span>
            <div className="chips">
              {['Cr', 'Dr'].map((s_) => (
                <button
                  type="button"
                  key={s_}
                  className={`chip${side === s_ ? ' on' : ''}`}
                  onClick={() => { setSide(s_); setSideSet(true); }}
                >
                  {s_}
                </button>
              ))}
            </div>
          </div>
          <label>
            As of
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} required />
          </label>
        </div>

        <div className="row">
          <label>
            Contact
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="off"
            />
          </label>
          <label>
            Second contact
            <input
              value={phone2}
              onChange={(e) => setPhone2(e.target.value)}
              inputMode="tel"
              autoComplete="off"
              placeholder="if they have one"
            />
          </label>
          <label>
            Aadhaar
            <input
              value={aadhaar}
              onChange={(e) => setAadhaar(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="if they have one"
            />
          </label>
        </div>

        <label>
          Note
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {/* Naming somebody here is what turns the per-bill commission tick on
            for this account. Left empty — which is most accounts — the ledger
            never mentions commission at all. */}
        {isCustomer && (
          <label>
            Commission to
            <input
              value={commissionTo}
              onChange={(e) => setCommissionTo(e.target.value)}
              placeholder="the carpenter who brings them, if any"
            />
          </label>
        )}

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
