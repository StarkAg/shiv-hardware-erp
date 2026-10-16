import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { CalendarClock, Paperclip, Pencil, Plus } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { fromInputDate, inputDate, rupees, shortDate, today } from '../lib/format';
import { CardsSkeleton, TableSkeleton } from './Skeleton';

/** Amber from 3 days, red from 7: a supplier who has not billed in a week is chased. */
const waitTone = (days) => (days >= 7 ? 'late' : days >= 3 ? 'due' : '');
const DAY = 86_400_000;
/** Days from today to the day the bill was promised; negative once it has passed. */
const untilDue = (due) => Math.round((due - today()) / DAY);
/**
 * A delivery with a promised day is judged by that day instead: calm until
 * it, amber on it, red once it has passed.
 */
const tone = (r) => {
  if (!r.billDue) return waitTone(r.days);
  const left = untilDue(r.billDue);
  return left < 0 ? 'late' : left === 0 ? 'due' : '';
};
const dueWords = (due) => {
  const left = untilDue(due);
  if (left === 0) return 'today';
  if (left === 1) return 'tomorrow';
  if (left === -1) return 'was due yesterday';
  return left > 0 ? `in ${left} days` : `was due ${-left} days ago`;
};
const waited = (days) => (days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);
const qty = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * What the supplier said about the bill, and the day it should come: read
 * as one line under the goods, and written in place.
 */
function BillNote({ row }) {
  const save = useMutation(api.receipts.setBillNote);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = row.billNote ?? '';
  const when = row.billDue ?? null;

  const start = () => {
    setNote(text);
    setDue(when ? inputDate(when) : '');
    setError('');
    setOpen(true);
  };
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await save({ voucherId: row.voucherId, note, due: due ? fromInputDate(due) : null });
      setOpen(false);
    } catch {
      setError('Not saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    return (
      <form
        className="billnote-form"
        onSubmit={submit}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Bill note"
          maxLength={300}
          autoFocus
          aria-label="Bill note"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Bill expected on"
        />
        <button type="submit" className="btn small on" disabled={busy}>Save</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        {error && <span className="billnote-error">{error}</span>}
      </form>
    );
  }

  if (!text && !when) {
    return (
      <button type="button" className="billnote-add" onClick={start}>
        <Plus size={12} aria-hidden="true" /> Bill note
      </button>
    );
  }

  return (
    <button type="button" className={`billnote ${when ? tone(row) : ''}`} onClick={start}>
      <CalendarClock size={13} aria-hidden="true" />
      <span>
        {when && (
          <strong>
            Bill {shortDate(when)}, {dueWords(when)}
          </strong>
        )}
        {when && text ? ' · ' : ''}
        {text}
      </span>
      <Pencil size={11} className="billnote-edit" aria-hidden="true" />
    </button>
  );
}

/**
 * Goods in, bills not.
 *
 * Every delivery nobody has billed yet, oldest first, with what it is likely
 * to cost at the rates last paid. This is the list the shop phones suppliers
 * from; "Enter bill" writes the purchase against the delivery when the bill
 * finally comes.
 */
export default function BillsToCome({ onOpen, onEnterBill, onViewBill }) {
  const data = useLive(api.receipts.open, {}, 'receipts:open');
  const [who, setWho] = useState('');

  if (data === undefined) {
    return (
      <>
        <CardsSkeleton count={3} />
        <TableSkeleton cols={6} rows={5} wide={2} />
      </>
    );
  }

  const all = (data?.rows ?? []).filter((r) => !r.billedHere);
  const parties = [...new Set(all.map((r) => r.party))].sort();
  const rows = who ? all.filter((r) => r.party === who) : all;
  const late = all.filter((r) => r.days >= 7).length;
  const promised = all.filter((r) => r.billDue).length;
  const guessed = all.reduce((t, r) => t + r.estimate, 0);
  const blind = all.filter((r) => r.unpricedLines > 0).length;

  return (
    <>
      <div className="summary">
        <div className="card total">
          <div className="card-name">Waiting for a bill</div>
          <div className="card-amt">{all.length}</div>
          <div className="card-meta">
            {all.length === 1 ? 'delivery' : 'deliveries'}
            {late > 0 && <em className="warn"> · {late} over a week</em>}
          </div>
        </div>
        <div className="card">
          <div className="card-name">Worth about</div>
          <div className="card-amt">{rupees(guessed)}</div>
          <div className="card-meta">
            at the rates last paid{blind > 0 ? ` · ${blind} with items never bought before` : ''}
          </div>
        </div>
        <div className="card">
          <div className="card-name">Suppliers to chase</div>
          <div className="card-amt">{parties.length}</div>
          <div className="card-meta">
            oldest delivery first{promised > 0 ? ` · ${promised} with a bill day` : ''}
          </div>
        </div>
      </div>

      {parties.length > 1 && (
        <div className="toolbar">
          <div className="chips">
            <button className={`chip${who ? '' : ' on'}`} onClick={() => setWho('')}>All</button>
            {parties.map((p) => (
              <button key={p} className={`chip${who === p ? ' on' : ''}`} onClick={() => setWho(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">Every delivery has its bill.</div>
      ) : (
        <div className="table-wrap">
          <div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="w-date">Came</th>
                  <th className="w-no">GRN</th>
                  <th>Supplier and goods</th>
                  <th>Waiting</th>
                  <th className="num">About</th>
                  <th className="w-clip" />
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.voucherId} className={`received open ${tone(r)}`}>
                    <td className="mono" data-label="Came">{shortDate(r.date)}</td>
                    <td className="mono entryno" data-label="GRN">{r.vchLabel}</td>
                    <td className="particulars" data-label="Supplier">
                      <button className="link plain" onClick={() => onOpen(r.partyLedgerId)}>
                        {r.party}
                      </button>
                      <div className="billgoods">
                        {r.items.length === 0 && <span className="good">no lines written</span>}
                        {r.items.map((i, n) => (
                          <span key={n} className="good">
                            {i.description} {qty(i.qty)} {i.unit}
                            {i.rate > 0 ? ` · ~${rupees(i.value)}` : ''}
                          </span>
                        ))}
                      </div>
                      <BillNote row={r} />
                      {r.receivedBy && <div className="ref">checked by {r.receivedBy}</div>}
                    </td>
                    <td data-label="Waiting">
                      <span className={`waited ${waitTone(r.days)}`}>{waited(r.days)}</span>
                    </td>
                    <td className="num" data-label="About">
                      {r.estimate > 0 ? rupees(r.estimate) : '—'}
                    </td>
                    <td className="w-clip" data-label="">
                      {r.photos.length > 0 && (
                        <button
                          className="clip"
                          aria-label="Challan photo"
                          onClick={() =>
                            onViewBill({
                              _id: r.voucherId,
                              vchLabel: r.vchLabel,
                              vchType: 'Goods Received',
                              date: r.date,
                              party: r.party,
                              refNo: r.refNo,
                              attachmentUrls: r.photos.map((url, n) => ({
                                url,
                                previewUrl: url,
                                kind: 'challan',
                                label: r.photos.length > 1 ? `challan ${n + 1} of ${r.photos.length}` : 'challan',
                              })),
                            })
                          }
                        >
                          <Paperclip size={13} aria-hidden="true" /> {r.photos.length > 1 ? r.photos.length : ''}
                        </button>
                      )}
                    </td>
                    <td className="rowacts" data-label="">
                      <button className="btn small" onClick={() => onEnterBill(r)}>Enter bill</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

