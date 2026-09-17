import React, { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, shortDate } from '../lib/format';
import { CardsSkeleton, TableSkeleton } from './Skeleton';

/** Amber from 3 days, red from 7: a supplier who has not billed in a week is chased. */
const tone = (days) => (days >= 7 ? 'late' : days >= 3 ? 'due' : '');
const waited = (days) => (days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);
const qty = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

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
          <div className="card-meta">oldest delivery first</div>
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
                  <tr key={r.voucherId} className={`received open ${tone(r.days)}`}>
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
                      {r.receivedBy && <div className="ref">checked by {r.receivedBy}</div>}
                    </td>
                    <td data-label="Waiting">
                      <span className={`waited ${tone(r.days)}`}>{waited(r.days)}</span>
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

