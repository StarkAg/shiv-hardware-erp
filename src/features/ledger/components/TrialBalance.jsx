import React from 'react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees } from '../lib/format';
import { TableSkeleton } from './Skeleton';
import { groupLabel } from '../lib/groups';

/**
 * Proof the books are square. The opening balances came off the suppliers'
 * statements with nothing to enter them against, so they are shown on their own
 * line — the same line Tally calls "Difference in Opening Balances".
 */
export default function TrialBalance() {
  const data = useLive(api.reports.trialBalance, {}, 'trial');
  if (data === undefined) return <TableSkeleton cols={3} rows={9} wide={1} />;

  const rows = data?.rows ?? [];
  const diff = data?.openingDifference ?? { debit: 0, credit: 0 };
  const held = data?.notMaintained ?? { debit: 0, credit: 0, count: 0 };

  let lastGroup = null;

  return (
    <div className="table-wrap">
      <div className="scroller">
        <table className="ledger">
          <thead>
            <tr>
              <th>Ledger</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const head = r.group !== lastGroup ? ((lastGroup = r.group), r.group) : null;
              return (
                <React.Fragment key={r.ledgerId}>
                  {head && (
                    <tr className="grouprow">
                      <td colSpan={3}>{groupLabel(head)}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="particulars" data-label="Ledger">{r.name}</td>
                    <td className="num" data-label="Debit">{r.debit ? rupees(r.debit) : ''}</td>
                    <td className="num" data-label="Credit">{r.credit ? rupees(r.credit) : ''}</td>
                  </tr>
                </React.Fragment>
              );
            })}
            <tr>
              <td className="particulars muted-cell" data-label="Ledger">
                Difference in Opening Balances
              </td>
              <td className="num" data-label="Debit">{diff.debit ? rupees(diff.debit) : ''}</td>
              <td className="num" data-label="Credit">{diff.credit ? rupees(diff.credit) : ''}</td>
            </tr>
            {held.count > 0 && (
              <tr>
                <td className="particulars muted-cell" data-label="Ledger">
                  Cash &amp; bank — not maintained
                </td>
                <td className="num" data-label="Debit">{held.debit ? rupees(held.debit) : ''}</td>
                <td className="num" data-label="Credit">{held.credit ? rupees(held.credit) : ''}</td>
              </tr>
            )}
            <tr className="opening">
              <td data-label="">Total</td>
              <td className="num bal" data-label="Debit">{rupees(data?.debit ?? 0)}</td>
              <td className="num bal" data-label="Credit">{rupees(data?.credit ?? 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
