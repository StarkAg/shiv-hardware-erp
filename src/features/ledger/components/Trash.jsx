import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, shortDate } from '../lib/format';
import Confirm from './Confirm';
import { TableSkeleton } from './Skeleton';

const when = (ms) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

/**
 * Everything ever deleted, kept whole and kept for good. Restoring puts a
 * voucher back under its own number with its lines and bill photo intact.
 *
 * There is no way to destroy anything from here on purpose: a record that has
 * been written should not be removable by whoever is at the counter. Purging
 * exists only on the command line, for whoever runs the books.
 */
export default function Trash({ onViewBill }) {
  const live = useLive(api.trash.list, {}, 'trash');
  const rows = live ?? [];
  const restore = useMutation(api.trash.restore);
  const [restoring, setRestoring] = useState(null);

  if (live === undefined) return <TableSkeleton cols={7} rows={5} wide={5} />;

  if (rows.length === 0) {
    return <div className="empty">Nothing deleted.</div>;
  }

  return (
    <>
      <div className="toolbar">
        <div className="count">{rows.length} deleted</div>
      </div>

      <div className="table-wrap">
        <div className="scroller">
          <table className="ledger">
            <thead>
              <tr>
                <th className="w-date">Date</th>
                <th className="w-no">Vch</th>
                <th className="w-type">Type</th>
                <th>Party</th>
                <th className="w-ref">Ref</th>
                <th className="num">Amount</th>
                <th className="w-date">Deleted</th>
                <th className="w-clip" />
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td className="mono" data-label="Date">{shortDate(r.date)}</td>
                  <td className="mono entryno" data-label="Vch">{r.vchLabel}</td>
                  <td className="vchtype" data-label="Type">{r.vchType}</td>
                  <td className="particulars" data-label="Party">
                    {r.party}
                    {r.narration && <div className="ref">{r.narration}</div>}
                  </td>
                  <td className="ref mono" data-label="Ref">{r.refNo || '—'}</td>
                  <td className="num" data-label="Amount">
                    {r.status === 'pending' ? (
                      <span className="warn">unpriced</span>
                    ) : (
                      rupees(r.amount)
                    )}
                  </td>
                  <td className="ref" data-label="Deleted">{when(r.deletedAt)}</td>
                  <td className="w-clip" data-label="">
                    {r.attachmentUrls.length > 0 && (
                      <button className="clip" onClick={() => onViewBill(r)} aria-label="Bill photo">
                        ▣
                      </button>
                    )}
                  </td>
                  <td className="rowacts" data-label="">
                    <button className="btn small" onClick={() => setRestoring(r)}>
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {restoring && (
        <Confirm
          title={`Restore ${restoring.vchLabel}?`}
          body={`${restoring.vchType} of ${
            restoring.amount != null ? rupees(restoring.amount) : 'no amount'
          } dated ${shortDate(restoring.date)} goes back into the books and moves ${
            restoring.party
          }'s balance.`}
          requireText={restoring.party}
          requireLabel="Type the party name to restore"
          confirmLabel="Restore"
          onConfirm={() => restore({ id: restoring._id })}
          onClose={() => setRestoring(null)}
        />
      )}
    </>
  );
}
