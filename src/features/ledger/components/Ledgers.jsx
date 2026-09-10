import React, { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, shortDate, phoneDisplay } from '../lib/format';
import { TableSkeleton } from './Skeleton';
import LedgerForm from './LedgerForm';
import Confirm from './Confirm';

/**
 * Every account in the books, as a list to be worked on.
 *
 * The Customers and Suppliers screens answer "who owes what" — they are
 * reports, and their rows open a statement. This is the other question: what
 * accounts exist, is this one spelled right, and can that empty duplicate go.
 * So the same names appear here with an edit and a delete against them, and
 * nothing else: no balances to read, no statement to open.
 */

const TABS = [
  ['customers', 'Customers', 'Sundry Debtors'],
  ['suppliers', 'Suppliers', 'Sundry Creditors'],
  ['other', 'Other accounts', null],
];

export default function Ledgers({ tab = 'customers', onTab, onOpenLedger }) {
  const masters = useLive(api.masters.all, {}, 'masters');
  // What is posted to each account, so a row can say whether it can go.
  const usage = useLive(api.masters.usage, {}, 'ledger-usage') ?? {};
  const remove = useMutation(api.masters.removeLedger);

  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');

  const here = TABS.find(([id]) => id === tab) ?? TABS[0];
  const group = here[2];

  const all = masters?.ledgers ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((l) =>
        // "Other accounts" is everything that is not a party: Sales, Purchases,
        // Bank, Cash, the expense heads. They are opened by the books rather
        // than by hand, and are here to be looked at, not tidied.
        group ? l.groupName === group : !['Sundry Debtors', 'Sundry Creditors'].includes(l.groupName)
      )
      .filter((l) =>
        !needle ||
        [l.name, l.place, l.phone, l.gstin].some((f) =>
          String(f ?? '').toLowerCase().includes(needle)
        )
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, group, q]);

  /**
   * Where an account's statement lives. Party accounts are filed under the two
   * party tabs; anything else (Sales, Bank, an expense head) has no tab of its
   * own, and the customers side shows it perfectly well.
   */
  const statementPath = (l) =>
    `/ledger/${l.groupName === 'Sundry Creditors' ? 'suppliers' : 'customers'}/${l._id}`;

  /**
   * Opened in a window of its own, because the reason to open two of these is
   * to hold them side by side — three spellings of the same customer, and the
   * question of which one has the money on it.
   */
  const openInPanel = (l) => {
    const { origin, pathname } = window.location;
    window.open(`${origin}${pathname}#${statementPath(l)}`, '_blank', 'noopener');
  };

  const drop = async (ledger) => {
    setError('');
    const pin = window.prompt(`Delete "${ledger.name}"? Enter the code to confirm.`);
    if (!pin) return;
    try {
      await remove({ id: ledger._id, pin });
      setDeleting(null);
    } catch (err) {
      // The refusals are the useful part: an account with vouchers against it
      // cannot go, and saying so is better than a silent failure. A thrown
      // ConvexError arrives in `data`; anything else only has a message.
      setError(String(err?.data ?? err?.message ?? err));
      setDeleting(null);
    }
  };

  return (
    <>
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`tab${tab === id ? ' on' : ''}`}
            onClick={() => onTab?.(id)}
          >
            {label}
            {masters && (
              <span className="pill">
                {all.filter((l) =>
                  TABS.find(([t]) => t === id)[2]
                    ? l.groupName === TABS.find(([t]) => t === id)[2]
                    : !['Sundry Debtors', 'Sundry Creditors'].includes(l.groupName)
                ).length}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="toolbar">
        <div className="count">
          {rows.length} {here[1].toLowerCase()}
          {q.trim() && ` of ${all.filter((l) => (group ? l.groupName === group : true)).length}`}
        </div>
        <input
          className="partysearch"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, place or phone"
          aria-label="Search ledgers"
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || !q) return;
            e.preventDefault();
            e.stopPropagation();
            setQ('');
          }}
        />
        {group && (
          <button className="btn" onClick={() => setAdding(true)}>+ Ledger</button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {masters === undefined ? (
        <TableSkeleton cols={5} rows={8} wide={1} />
      ) : rows.length === 0 ? (
        <div className="empty">
          {q.trim() ? 'No accounts match that.' : 'No accounts here yet.'}
        </div>
      ) : (
        <div className="table-wrap">
          <div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Group</th>
                  <th>Details</th>
                  <th className="num">Entries</th>
                  <th className="num">Opening</th>
                  <th className="w-acts" />
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l._id}>
                    <td className="particulars" data-label="Name">
                      <button className="link plain" onClick={() => onOpenLedger?.(statementPath(l))}>
                        {l.name}
                      </button>
                    </td>
                    <td className="ref" data-label="Group">{l.groupName}</td>
                    <td className="ref" data-label="Details">
                      {[l.place, phoneDisplay(l.phone), l.gstin && `GSTIN ${l.gstin}`]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="num" data-label="Entries">
                      {usage[l._id] ? `${usage[l._id]} vch` : <span className="ref">empty</span>}
                    </td>
                    <td className="num" data-label="Opening">
                      {l.openingBalance
                        ? `${rupees(l.openingBalance)} ${l.openingSide}`
                        : '—'}
                      {l.openingAsOf ? <div className="ref">{shortDate(l.openingAsOf)}</div> : null}
                    </td>
                    <td className="rowacts" data-label="">
                      <button
                        className="xbtn"
                        aria-label="Open in a new panel"
                        title="Open in a new panel"
                        onClick={() => openInPanel(l)}
                      >
                        ↗
                      </button>
                      <button className="xbtn" aria-label="Edit" onClick={() => setEditing(l)}>✎</button>
                      {/* Offered only where it can succeed. An account with
                          anything posted to it can never be deleted — the
                          books would lose the other side of those entries. */}
                      {usage[l._id] ? (
                        <span
                          className="xbtn muted"
                          title={`${usage[l._id]} vouchers are posted to this account — it cannot be deleted`}
                          aria-hidden="true"
                        >
                          ✕
                        </span>
                      ) : (
                        <button className="xbtn del" aria-label="Delete" onClick={() => setDeleting(l)}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(editing || adding) && (
        <LedgerForm
          groups={masters?.groups ?? []}
          edit={editing ?? undefined}
          onClose={() => { setEditing(null); setAdding(false); }}
        />
      )}

      {deleting && (
        <Confirm
          title={`Delete ${deleting.name}?`}
          body="An account with any voucher against it cannot be deleted — only an empty one. You will be asked for the code."
          confirmLabel="Delete"
          danger
          onConfirm={() => drop(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
