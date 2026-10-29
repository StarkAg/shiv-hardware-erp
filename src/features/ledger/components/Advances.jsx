import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, shortDate } from '../lib/format';
import { groupLabel } from '../lib/groups';
import { CardsSkeleton, TableSkeleton } from './Skeleton';

/**
 * Every advance voucher, newest first.
 *
 * Money taken from a customer before the sale, or paid to a supplier before
 * their bill. Each is its own ADV voucher, written from the Advance bill
 * (Alt+F5, or + Advance on an account), so this list is the series itself
 * rather than a guess at which receipts were advances.
 */
export default function Advances({ onOpen, onNew }) {
  const navigate = useNavigate();
  const live = useLive(api.reports.advances, {}, 'advances');
  const [side, setSide] = useState('');

  if (live === undefined) {
    return (
      <>
        <CardsSkeleton count={3} />
        <TableSkeleton cols={6} rows={6} wide={2} />
      </>
    );
  }

  const all = live ?? [];
  const rows = side ? all.filter((r) => r.direction === side) : all;
  const total = (dir) => all.filter((r) => r.direction === dir).reduce((t, r) => t + r.amount, 0);
  const received = all.filter((r) => r.direction === 'received');
  const paid = all.filter((r) => r.direction === 'paid');
  const open = (r) => navigate(r.billId ? `/bills/${r.billId}` : `/bills/voucher/${r._id}`);

  return (
    <>
      <div className="summary">
        <div className="card total">
          <div className="card-name">Advances</div>
          <div className="card-amt">{all.length}</div>
          <div className="card-meta">vouchers in the ADV series</div>
        </div>
        <div className="card">
          <div className="card-name">Received from customers</div>
          <div className="card-amt">{rupees(total('received'))}</div>
          <div className="card-meta">{received.length} {received.length === 1 ? 'advance' : 'advances'}</div>
        </div>
        <div className="card">
          <div className="card-name">Paid to suppliers</div>
          <div className="card-amt">{rupees(total('paid'))}</div>
          <div className="card-meta">{paid.length} {paid.length === 1 ? 'advance' : 'advances'}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          <button className={`chip${side ? '' : ' on'}`} onClick={() => setSide('')}>All</button>
          <button className={`chip${side === 'received' ? ' on' : ''}`} onClick={() => setSide('received')}>
            Received
          </button>
          <button className={`chip${side === 'paid' ? ' on' : ''}`} onClick={() => setSide('paid')}>
            Paid
          </button>
        </div>
        <button className="btn" onClick={onNew}>+ Advance</button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No advances yet. Write one with + Advance or Alt+F5.</div>
      ) : (
        <div className="table-wrap">
          <div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="w-date">Date</th>
                  <th className="w-no">Vch</th>
                  <th>Party</th>
                  <th>Received / paid</th>
                  <th>Particulars</th>
                  <th className="num">Amount</th>
                  <th className="w-acts" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td className="mono" data-label="Date">{shortDate(r.date)}</td>
                    <td className="mono entryno" data-label="Vch">{r.vchLabel}</td>
                    <td className="particulars" data-label="Party">
                      <button className="link plain" onClick={() => onOpen(r.partyLedgerId)}>
                        {r.party}
                      </button>
                      <div className="ref">
                        {[groupLabel(r.partyGroup), r.refNo].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td data-label="Received / paid">
                      {r.direction === 'paid' ? 'Paid from' : 'Received into'} {r.via.join(', ') || '—'}
                    </td>
                    <td className="particulars" data-label="Particulars">{r.narration || '—'}</td>
                    <td className="num" data-label="Amount">{rupees(r.amount)}</td>
                    <td className="rowacts" data-label="">
                      <button className="xbtn" onClick={() => open(r)} aria-label="Open">
                        <Pencil size={13} aria-hidden="true" />
                      </button>
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
