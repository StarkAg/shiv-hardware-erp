import React from 'react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees } from '../lib/format';
import { PartiesView } from './Parties';

const round2 = (n) => Math.round(n * 100) / 100;

/** Finished with: nothing owed either way, and no bill left unpriced. */
const settled = (r) => Math.abs(r.signedClosing) < 0.005 && r.pendingCount === 0;

/**
 * Customers and suppliers in one list.
 *
 * The two reports it is made of are the same ones the Customers and Suppliers
 * tabs read, under the same cache keys, so it opens as fast as either of them.
 * Movement is shown the way the books keep it — Debit and Credit — because
 * "Sold" means nothing on a supplier's row and "Paid" nothing on a customer's.
 * Each row says which side it is on, and a search for "supplier" finds them.
 */
export default function AllParties({ onOpen, onPrint }) {
  const payables = useLive(api.reports.outstanding, {}, 'payables');
  const receivables = useLive(api.reports.receivables, {}, 'receivables');

  const data = React.useMemo(() => {
    if (payables === undefined || receivables === undefined) return undefined;
    const rows = [
      ...(receivables?.rows ?? []).map((r) => ({ ...r, kind: 'Customer' })),
      ...(payables?.rows ?? []).map((r) => ({ ...r, kind: 'Supplier' })),
    ];
    // Whatever still needs doing first, the biggest balances at the top of it.
    rows.sort(
      (a, b) =>
        Number(settled(a)) - Number(settled(b)) ||
        b.closing - a.closing ||
        a.ledger.name.localeCompare(b.ledger.name)
    );
    // Netted the way the reports net their own totals: Dr counts up, Cr down.
    const net = round2(rows.reduce((t, r) => t + r.signedClosing, 0));
    return {
      rows,
      totals: {
        debits: round2(rows.reduce((t, r) => t + r.debits, 0)),
        credits: round2(rows.reduce((t, r) => t + r.credits, 0)),
        closing: Math.abs(net),
        closingSide: net >= 0 ? 'Dr' : 'Cr',
        pendingCount: rows.reduce((t, r) => t + r.pendingCount, 0),
      },
    };
  }, [payables, receivables]);

  const customers = receivables?.rows?.length ?? 0;
  const suppliers = payables?.rows?.length ?? 0;
  const cards = [
    {
      name: 'Due from customers',
      amount: rupees(receivables?.totals?.closing ?? 0),
      meta: `${customers} ${customers === 1 ? 'customer' : 'customers'}`,
    },
    {
      name: 'Payable to suppliers',
      amount: rupees(payables?.totals?.closing ?? 0),
      meta: `${suppliers} ${suppliers === 1 ? 'supplier' : 'suppliers'}`,
    },
  ];

  return (
    <PartiesView
      data={data}
      nameLabel="Parties"
      movement={[
        { label: 'Debit', key: 'debits' },
        { label: 'Credit', key: 'credits' },
      ]}
      cards={cards}
      // Owing a supplier is the normal state of a trade account; only a
      // customer's balance is flagged as unsettled, as on the Customers tab.
      showUnsettled={(r) => r.kind === 'Customer'}
      onOpen={onOpen}
      onPrint={onPrint}
    />
  );
}
