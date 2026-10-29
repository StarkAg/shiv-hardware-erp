import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Paperclip, Pencil, ReceiptText } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, shortDate } from '../lib/format';
import { groupLabel } from '../lib/groups';
import { TableSkeleton } from './Skeleton';
import VoucherBillPreview from './VoucherBillPreview';
import { photoStrip } from './BillViewer';
import { billFor } from '../lib/billFor';
import { useStore } from '../../../lib/store';

/**
 * Every advance voucher, newest first.
 *
 * Money taken from a customer before the sale, or paid to a supplier before
 * their bill. Each is its own ADV voucher, written from the Advance bill
 * (Alt+F5, or + Advance on an account), so this list is the series itself
 * rather than a guess at which receipts were advances.
 */
export default function Advances({ onOpen, onNew, onViewBill }) {
  const navigate = useNavigate();
  const live = useLive(api.reports.advances, {}, 'advances');
  const [side, setSide] = useState('');
  // Hide the parties whose work is done: their account is back to zero, the
  // advance used up against the goods or the bill. Remembered on this device.
  const [hidePaid, setHidePaid] = useState(() => {
    try { return localStorage.getItem('shiv-panel:advances-hide-paid') === '1'; } catch { return false; }
  });
  const toggleHidePaid = () => setHidePaid((on) => {
    try { localStorage.setItem('shiv-panel:advances-hide-paid', on ? '0' : '1'); } catch { /* private window */ }
    return !on;
  });
  const bills = useStore((st) => st.bills);
  const [previewing, setPreviewing] = useState(null);

  if (live === undefined) {
    return (
      <>
        <TableSkeleton cols={6} rows={6} wide={2} />
      </>
    );
  }

  const all = live ?? [];
  const paidCount = all.filter((r) => r.settled).length;
  const rows = all
    .filter((r) => !side || r.direction === side)
    .filter((r) => !hidePaid || !r.settled);
  const open = (r) => navigate(r.billId ? `/bills/${r.billId}` : `/bills/voucher/${r._id}`);
  // The photographed slip: the voucher's own, else the bill's it came from.
  const photosOf = (r) => (r.attachmentUrls?.length ? r.attachmentUrls : billFor(bills, r)?.attachments ?? []);
  // Every photo on the list as it stands, opened at the row clicked, as the
  // party ledger and Quotations do: the arrows go on to the next advance's.
  const showPhotos = (r) => onViewBill?.(photoStrip(
    rows.map((x) => ({
      key: x._id,
      vchType: 'Advance',
      vchLabel: x.vchLabel,
      date: x.date,
      party: x.party,
      amount: x.amount,
      refNo: x.refNo,
      attachmentUrls: photosOf(x),
    })),
    r._id,
    'Advances',
  ));

  return (
    <>
      <div className="toolbar">
        <div className="chips">
          <button className={`chip${side ? '' : ' on'}`} onClick={() => setSide('')}>All</button>
          <button className={`chip${side === 'received' ? ' on' : ''}`} onClick={() => setSide('received')}>
            Received
          </button>
          <button className={`chip${side === 'paid' ? ' on' : ''}`} onClick={() => setSide('paid')}>
            Given
          </button>
          <span className="chips-gap" />
          <button
            className={`chip${hidePaid ? ' on' : ''}`}
            onClick={toggleHidePaid}
            title="Hide parties whose account is back to zero: the advance is used up and the work is done"
          >
            Hide paid ({paidCount})
          </button>
        </div>
        <button className="btn" onClick={onNew}>+ Advance</button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {all.length && hidePaid ? 'Every advance here is paid: the work is done. Turn off Hide paid to see them.' : 'No advances yet. Write one with + Advance or Alt+F5.'}
        </div>
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
                  <th className="w-clip" />
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
                        {r.settled
                          ? <span className="adv-paid"> · Paid</span>
                          : r.partyBalance > 0 && <span> · balance {rupees(r.partyBalance)} {r.partySide}</span>}
                      </div>
                    </td>
                    <td data-label="Received / paid">
                      {r.direction === 'paid' ? 'Paid from' : 'Received into'} {r.via.join(', ') || '—'}
                    </td>
                    <td className="particulars" data-label="Particulars">{r.narration || '—'}</td>
                    <td className="num" data-label="Amount">{rupees(r.amount)}</td>
                    <td className="w-clip" data-label="">
                      {photosOf(r).length > 0 && (
                        <button className="clip" onClick={() => showPhotos(r)} aria-label="Slip photo" title="Photos">
                          <Paperclip size={13} aria-hidden="true" /> {photosOf(r).length > 1 ? photosOf(r).length : ''}
                        </button>
                      )}
                      {/* The bill this advance was written on, drawn from its figures. */}
                      {billFor(bills, r) && (
                        <button className="clip" onClick={() => setPreviewing(billFor(bills, r))} aria-label="Show the bill" title="Show the bill">
                          <ReceiptText size={13} aria-hidden="true" />
                        </button>
                      )}
                    </td>
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

      {previewing && (
        <VoucherBillPreview bill={previewing} onClose={() => setPreviewing(null)} />
      )}
    </>
  );
}
