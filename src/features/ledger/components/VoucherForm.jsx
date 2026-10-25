import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react'
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useUploader } from '../lib/upload';
import Combo from './Combo';
import BillDrop from './BillDrop';
import BillViewer from './BillViewer';
import { AttachmentThumbnail } from '../../../components/AttachmentViewer';
import Confirm from './Confirm';
import { inputDate, today, fromInputDate, longDate } from '../lib/format';
import { confirmPostingDate } from '../../../lib/dateCheck';
import { groupLabel } from '../lib/groups';
import { nextStep } from '../lib/walk';
import { usePhonePhotoActions } from '../../../lib/phonePhotos';
import { toast } from '../../../components/Toast';

/**
 * The four vouchers this shop writes. Each is the same form — a party, an
 * account, an amount — differing only in which ledgers may appear on either
 * side, so they are described here rather than written out four times.
 */
const KINDS = {
  purchase: {
    title: 'Purchase',
    partyGroup: 'Sundry Creditors',
    partyLabel: 'Supplier',
    accountLabel: 'Purchase account',
    accountGroups: ['Purchase Accounts'],
    refLabel: 'Bill no.',
    docKind: 'bill',
    particulars: 'Purchase',
    unpriced: true,           // a bill may be filed before anyone prices it
  },
  payment: {
    title: 'Payment',
    partyGroup: 'Sundry Creditors',
    partyLabel: 'Supplier',
    accountLabel: 'Paid from',
    accountGroups: ['Cash-in-Hand', 'Bank Accounts'],
    createAccountUnder: 'Bank Accounts',
    refLabel: 'Voucher no.',
    docKind: 'receipt',
    particulars: 'Payment',
  },
  sale: {
    title: 'Sale on credit',
    partyGroup: 'Sundry Debtors',
    partyLabel: 'Customer',
    accountLabel: 'Sales account',
    accountGroups: ['Sales Accounts'],
    refLabel: 'Bill no.',
    docKind: 'bill',
    particulars: 'Sale',
    unpriced: true,        // goods leave on a slip long before a price exists
  },
  receipt: {
    title: 'Receipt',
    partyGroup: 'Sundry Debtors',
    partyLabel: 'Customer',
    accountLabel: 'Received into',
    accountGroups: ['Cash-in-Hand', 'Bank Accounts'],
    createAccountUnder: 'Bank Accounts',
    refLabel: 'Receipt no.',
    docKind: 'receipt',
    particulars: 'Receipt',
  },
};

/**
 * The date, asked as its own question.
 *
 * Opens on the day the voucher is being written and takes one Enter to accept,
 * so the common case costs a keystroke and the uncommon one - a bill written up
 * days later - can no longer be filed under today by accident.
 */
function DateStep({ label, value, onChange, onDone }) {
  const field = useRef(null);
  const opened = useRef(value);   // what Escape puts back
  useEffect(() => {
    field.current?.focus();
    field.current?.select?.();
  }, []);

  const keys = (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    // The voucher form behind is listening for both; this one is answered here.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') onChange(opened.current);
    onDone();
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onDone()}>
      <div className="modal narrow" role="dialog" aria-label={`${label} date`}>
        <h2>Date of this {label.toLowerCase()}</h2>
        <label>
          Day it belongs to
          <input ref={field} type="date" value={value} required
            onChange={(e) => onChange(e.target.value)} onKeyDown={keys} />
        </label>
        <p className="hint">Enter to accept.</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onDone}>Use this date</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Writes a voucher, or rewrites one. In edit mode the type and number are
 * fixed — a corrected entry keeps its identity — but both ledgers, the amount,
 * the date and the wording can all be put right.
 */
export default function VoucherForm({
  kind, edit, defaultPartyId, defaultAmount, ledgers, groups, onViewBill, onClose,
}) {
  const editing = Boolean(edit);
  const spec = KINDS[editing ? edit.kind : kind];
  const parties = ledgers.filter((l) => l.groupName === spec.partyGroup);
  const accounts = ledgers.filter((l) => spec.accountGroups.includes(l.groupName));
  const createAccountUnder = spec.createAccountUnder ?? spec.accountGroups[0];

  // The bill being read off while this voucher is filled in.
  const [preview, setPreview] = useState(null);
  const [removing, setRemoving] = useState(null);

  // The ledger behind must not scroll while this is open — on a trackpad it
  // slides away under the form and leaves you somewhere else on closing.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  const [date, setDate] = useState(inputDate(edit ? edit.date : today()));
  const [partyId, setPartyId] = useState(edit?.partyLedgerId ?? defaultPartyId ?? '');
  const [accountId, setAccountId] = useState(
    edit?.accountLedgerId ?? accounts[0]?._id ?? ''
  );
  // Settling an account in full is the common case, so that figure is already
  // in the box — typed over in a second when it is a part payment.
  const [amount, setAmount] = useState(
    edit?.amount != null ? String(edit.amount) : defaultAmount != null ? String(defaultAmount) : ''
  );
  const [refNo, setRefNo] = useState(edit?.refNo ?? '');
  // One word per voucher — Purchase, Payment, Sale, Receipt — filled in and
  // still editable, so a challan can describe itself when it needs to.
  const [narration, setNarration] = useState(edit ? edit.narration : spec.particulars);
  const [files, setFiles] = useState([]);
  const [picked, setPicked] = useState([]);   // photos taken on the phone
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The date sat first on the form and last in anyone's attention: the party
  // picker takes the cursor when the voucher opens, so Enter walked straight
  // past the date and vouchers were filed under today whatever day they were
  // written for. It is a step of its own now - Enter reaches it after the
  // party, and it has to be answered once before the rest of the voucher.
  const [askDate, setAskDate] = useState(null);   // 'walk' | 'field' while open
  const [dateAsked, setDateAsked] = useState(editing);

  const createPurchase = useMutation(api.vouchers.createPurchase);
  const createPayment = useMutation(api.vouchers.createPayment);
  const createSale = useMutation(api.vouchers.createSale);
  const createReceipt = useMutation(api.vouchers.createReceipt);
  const createLedger = useMutation(api.masters.createLedger);
  const editVoucher = useMutation(api.vouchers.edit);
  const addAttachments = useMutation(api.vouchers.addAttachments);
  const removeAttachment = useMutation(api.vouchers.removeAttachment);
  const phonePhotos = usePhonePhotoActions();
  const upload = useUploader();
  /**
   * The phone photos this voucher took, off the queue. The voucher is saved by
   * now, so a queue that will not let go is said, not thrown: thrown, it kept
   * the form open over a voucher already in the books, asking to be saved twice.
   */
  const filePicked = async () => {
    if (!(await phonePhotos.file(picked))) toast('Voucher saved, but its photo is still in the phone queue.', 'error');
  };

  // The account is safe to default, and does so once the masters arrive on a
  // device opening the app for the first time. The party never is.
  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0]._id);
  }, [accountId, accounts]);

  // A name typed into a picker that is not on the list opens a ledger under
  // the group that kind of account belongs to.
  const openLedger = (groupName, side) => async (name) => {
    const group = groups.find((g) => g.name === groupName);
    if (!group) throw new Error(`No group named ${groupName}`);
    return createLedger({
      name,
      groupId: group._id,
      openingBalance: 0,
      openingSide: side,
      openingAsOf: today(),
    });
  };

  const asOptions = (list) =>
    list.map((l) => ({ id: l._id, name: l.name, hint: l.place || undefined }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const value = amount.trim() === '' ? undefined : Number(amount);
    if (value !== undefined && !(value > 0) && !(kind === 'purchase' && value === 0))
      return setError('Enter an amount above zero');
    if (!spec.unpriced && value === undefined) return setError('Enter an amount');
    if (!partyId || !accountId) return setError('Pick both ledgers');
    if (!confirmPostingDate(date)) return;

    setBusy(true);
    try {
      // Documents come from two places: files chosen here, and photos the
      // phone already sent in. Both are stamped with what this voucher's
      // paperwork normally is.
      const uploaded = files.length ? await upload(files) : [];
      const attachments = [
        ...uploaded.map((storageId) => ({ storageId, kind: spec.docKind })),
        ...picked.map((p) => ({ storageId: p.storageId, kind: spec.docKind })),
      ];

      if (editing) {
        await editVoucher({
          id: edit._id,
          date: fromInputDate(date),
          partyLedgerId: partyId,
          accountLedgerId: accountId,
          amount: value,
          refNo: refNo.trim() || undefined,
          narration: narration.trim() || undefined,
        });
        if (attachments.length) {
          await addAttachments({ id: edit._id, documents: attachments });
        }
        await filePicked();
        onClose();
        return undefined;
      }

      const common = {
        date: fromInputDate(date),
        partyLedgerId: partyId,
        refNo: refNo.trim() || undefined,
        narration: narration.trim() || undefined,
        attachments,
      };
      if (kind === 'purchase') {
        await createPurchase({ ...common, purchaseLedgerId: accountId, amount: value });
      } else if (kind === 'payment') {
        await createPayment({ ...common, paidFromLedgerId: accountId, amount: value });
      } else if (kind === 'sale') {
        await createSale({ ...common, salesLedgerId: accountId, amount: value });
      } else {
        await createReceipt({ ...common, receivedIntoLedgerId: accountId, amount: value });
      }
      await filePicked();
      onClose();
    } catch (err) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
    return undefined;
  };

  /**
   * Enter walks the voucher, field by field, and accepts it at the end — the
   * way it is written in Tally, and the way the bill builder already works.
   * Without this the form was a web form: Enter submitted from wherever the
   * cursor happened to be, half the voucher unfilled.
   *
   * The fields are taken from the DOM in the order they are drawn, so adding a
   * field to the voucher puts it in the walk without listing it anywhere. The
   * date is the one exception: it is a stop that opens a step rather than takes
   * the cursor (see nextStep in lib/walk.js).
   */
  const formRef = useRef(null);
  const stops = () => [...(formRef.current?.querySelectorAll('[data-vf]') ?? [])];

  /** Focus the stop after the party - where the walk resumes once the date is in. */
  const afterParty = () => {
    const fields = stops();
    const at = fields.findIndex((f) => f.dataset.vfId === 'party');
    fields[at + 1]?.focus();
  };

  /** Focus the date itself - where the cursor was when the date was opened by hand. */
  const focusDate = () => stops().find((f) => f.dataset.vfId === 'date')?.focus();

  const walk = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || !formRef.current) return;
    const fields = stops();
    const from = e.target.closest?.('[data-vf]') ?? e.target;
    const at = fields.indexOf(from);
    if (at === -1) return;
    e.preventDefault();
    // Fields without an id of their own are known by where they stand.
    const ids = fields.map((f, i) => f.dataset.vfId ?? `field-${i}`);
    const step = nextStep({ stops: ids, from: ids[at], dateAsked });
    if (step.do === 'ask-date') {
      return setAskDate(step.then === 'submit' ? 'accept'
        : from.dataset.vfId === 'date' ? 'field' : 'walk');
    }
    if (step.do === 'focus') return fields[ids.indexOf(step.stop)]?.focus();
    if (step.do === 'submit') formRef.current.requestSubmit();
    return undefined;
  };

  return (
    <div
      className="modal-bg"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" ref={formRef} onSubmit={submit} onKeyDown={walk}>
        <h2>{editing ? `Edit ${edit.vchLabel}` : spec.title}</h2>

        <div className="row">
          <div className="labelled">
            <span>Date</span>
            <button
              type="button"
              data-vf
              data-vf-id="date"
              className="fixedfield datefield"
              onClick={() => setAskDate('field')}
            >
              {longDate(fromInputDate(date))}
            </button>
          </div>
          <label>
            {spec.refLabel}
            <input data-vf value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </label>
        </div>

        <label>
          {spec.partyLabel}
          {editing ? (
            // Editing corrects a voucher; it does not re-file it under someone
            // else. The party the voucher belongs to is stated, not offered.
            <div className="fixedfield">
              {parties.find((l) => l._id === partyId)?.name ?? '—'}
            </div>
          ) : (
            <Combo
              nav
              options={asOptions(parties)}
              value={partyId}
              onChange={setPartyId}
              onCreate={openLedger(
                spec.partyGroup,
                spec.partyGroup === 'Sundry Debtors' ? 'Dr' : 'Cr'
              )}
              createGroup={groupLabel(spec.partyGroup)}
              navId="party"
              autoFocus={!defaultPartyId}
            />
          )}
        </label>

        <label>
          {spec.accountLabel}
          <Combo
            nav
            options={asOptions(accounts)}
            value={accountId}
            onChange={setAccountId}
            onCreate={openLedger(createAccountUnder, 'Dr')}
            createGroup={groupLabel(createAccountUnder)}
          />
        </label>

        <label>
          Amount
          <input
            data-vf
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={kind === 'purchase' ? 'blank — Goods Received' : spec.unpriced ? 'blank — file it unpriced' : ''}
            autoFocus={editing || Boolean(defaultPartyId)}
          />
        </label>

        <label>
          Particulars
          <input data-vf value={narration} onChange={(e) => setNarration(e.target.value)} />
        </label>

        <div className="labelled">
          <span>{spec.partyGroup === 'Sundry Debtors' ? 'Slip photo' : 'Bill photo'}</span>

          {editing && edit.attachments.length > 0 && (
            <div className="shots">
              {edit.attachments.map((shot) => (
                <div className="shot-tile" key={shot.storageId}>
                  <button type="button" className="shot-pick" aria-label="Preview attached file"
                    onClick={() => setPreview({ ...edit, attachmentUrls: edit.attachments, initialIndex: edit.attachments.indexOf(shot) })}>
                    <AttachmentThumbnail file={shot} />
                  </button>
                  <button
                    type="button"
                    className="shot-x"
                    aria-label="Remove"
                    onClick={() => setRemoving(shot)}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <BillDrop
            files={files}
            onChange={setFiles}
            picked={picked}
            onPick={setPicked}
            onViewBill={setPreview}
          />
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : kind === 'purchase' && !(Number(amount) > 0) ? 'Save Goods Received' : 'Save'}
          </button>
        </div>
      </form>

      {askDate && (
        <DateStep
          label={spec.title}
          value={date}
          onChange={setDate}
          onDone={() => {
            const from = askDate;
            setAskDate(null);
            setDateAsked(true);
            // After the overlay has gone, or the focus lands under it.
            requestAnimationFrame(() => {
              if (from === 'accept') formRef.current?.requestSubmit();
              else if (from === 'walk') afterParty();
              else focusDate();
            });
          }}
        />
      )}

      {preview && <BillViewer voucher={preview} onClose={() => setPreview(null)} />}
      {removing && <Confirm title="Delete this attachment?"
        body="This removes the file from the voucher permanently."
        confirmLabel="Delete attachment" danger requireText="delete" requireLabel="Type delete to confirm"
        onConfirm={() => removeAttachment({ id: edit._id, storageId: removing.storageId })}
        onClose={() => setRemoving(null)} />}
    </div>
  );
}
