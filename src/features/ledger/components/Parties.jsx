import React from 'react';
import { useLive } from '../lib/cache';
import { rupees, phoneDisplay, phoneHref } from '../lib/format';
import { TAGS } from '../lib/tags';
import TagDots from './TagDots';

/**
 * An account that is not finished with: money still on it either way, or a
 * bill filed without a price — an amount nobody knows yet is no more settled
 * than an amount nobody has paid.
 */
const Unsettled = () => (
  <svg className="alertmark" viewBox="0 0 24 24" aria-label="Not settled" role="img">
    <path
      d="M12 3.6 22 20.4H2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinejoin="round"
    />
    <path
      d="M12 10v4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
    <circle cx="12" cy="17.4" r="1.15" fill="currentColor" />
  </svg>
);
import { CardsSkeleton, TableSkeleton } from './Skeleton';

/**
 * One side of the party ledgers. Suppliers and customers are the same report
 * read in opposite directions, so they are the same screen: only which side of
 * the account counts as movement in, and what the total is called, differ.
 */
export default function Parties({
  fnRef,
  cacheKey,
  totalLabel,
  nameLabel,
  movement,
  onOpen,
  onPrint,
  // Owing a supplier is the normal state of a trade account, not something to
  // flag — so the mark is only worth showing where a balance means someone
  // has not paid the shop.
  showUnsettled = true,
}) {
  const data = useLive(fnRef, {}, cacheKey);
  // Which colours the list is narrowed to. Nothing picked shows everyone.
  const [onlyTags, setOnlyTags] = React.useState([]);
  // Thirty-seven accounts is already too many to run an eye down, and the shop
  // knows the name it is looking for. Matches the place and the phone too: a
  // customer is as often remembered as "the one from Chainpur".
  const [q, setQ] = React.useState('');

  // Only ever true on a device that has not held these figures before.
  if (data === undefined) {
    return (
      <>
        <CardsSkeleton count={3} />
        <TableSkeleton cols={5} rows={6} wide={1} />
      </>
    );
  }

  const all = data?.rows ?? [];
  const needle = q.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (onlyTags.length && !(r.ledger.tags ?? []).some((t) => onlyTags.includes(t))) return false;
    if (!needle) return true;
    const l = r.ledger;
    return [l.name, l.place, l.phone, l.gstin]
      .some((field) => String(field ?? '').toLowerCase().includes(needle));
  });
  // Only offer colours that are actually in use, so the row is never a
  // palette of seven where six find nothing.
  const inUse = TAGS.filter((t) => all.some((r) => (r.ledger.tags ?? []).includes(t.id)));
  const totals = data?.totals ?? {
    debits: 0, credits: 0, closing: 0, closingSide: 'Cr', pendingCount: 0,
  };

  return (
    <>
      <div className="summary">
        <div className="card total">
          <div className="card-name">{totalLabel}</div>
          <div className="card-amt">{rupees(totals.closing)}</div>
          <div className="card-meta">{rows.length} ledgers</div>
        </div>
        {movement.map((col) => (
          <div className="card" key={col.label}>
            <div className="card-name">{col.label}</div>
            <div className="card-amt">{rupees(totals[col.key])}</div>
            <div className="card-meta">to date</div>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <div className="count">
          {rows.length} {nameLabel.toLowerCase()}
          {(onlyTags.length > 0 || needle) && ` of ${all.length}`}
        </div>

        <input
          className="partysearch"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${nameLabel.toLowerCase()}, place or phone`}
          aria-label={`Search ${nameLabel.toLowerCase()}`}
          // Esc clears rather than closing the screen behind it.
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || !q) return;
            e.preventDefault();
            e.stopPropagation();
            setQ('');
          }}
        />
        {inUse.length > 0 && (
          <div className="tagfilter">
            {inUse.map((t) => (
              <button
                key={t.id}
                className={`tagswatch small t-${t.id}${onlyTags.includes(t.id) ? ' on' : ''}`}
                title={`Only ${t.name}`}
                onClick={() =>
                  setOnlyTags((held) =>
                    held.includes(t.id) ? held.filter((x) => x !== t.id) : [...held, t.id]
                  )
                }
              />
            ))}
            {onlyTags.length > 0 && (
              <button className="link" onClick={() => setOnlyTags([])}>all</button>
            )}
          </div>
        )}
        <button className="btn ghost" onClick={onPrint}>Print</button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {needle || onlyTags.length
            ? `No ${nameLabel.toLowerCase()} match that.`
            : `No ${nameLabel.toLowerCase()} yet.`}
        </div>
      ) : (
        <div className="table-wrap">
          <div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{nameLabel}</th>
                  <th className="num">Opening</th>
                  {movement.map((col) => (
                    <th className="num" key={col.label}>{col.label}</th>
                  ))}
                  <th className="num">Closing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ledger._id} className="clickable" onClick={() => onOpen(r.ledger._id)}>
                    <td className="particulars" data-label={nameLabel}>
                      {/* Name over place, with the chip sitting against the
                          middle of both rather than hanging off the last line. */}
                      <div className="partycell">
                        <div>
                          <div className="party">
                            {r.ledger.name}
                            <TagDots tags={r.ledger.tags} />
                          </div>
                          {/* Most parties have a place; the rest at least have
                              a number, which beats a dash. Tapping it calls
                              rather than opening the ledger underneath. */}
                          {r.ledger.place ? (
                            <div className="ref">{r.ledger.place}</div>
                          ) : r.ledger.phone ? (
                            <a
                              className="ref phone"
                              href={phoneHref(r.ledger.phone)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {phoneDisplay(r.ledger.phone)}
                            </a>
                          ) : (
                            <div className="ref">—</div>
                          )}
                        </div>
                        {r.pendingCount > 0 && (
                          <span className="chip-unpriced">{r.pendingCount} unpriced</span>
                        )}
                      </div>
                    </td>
                    <td className="num" data-label="Opening">
                      {rupees(r.opening)} <span className="side">{r.openingSide}</span>
                    </td>
                    {movement.map((col) => (
                      <td className="num" data-label={col.label} key={col.label}>
                        {rupees(r[col.key])}
                      </td>
                    ))}
                    <td className="num bal" data-label="Closing">
                      {showUnsettled && (r.closing > 0.005 || r.pendingCount > 0) && (
                        <Unsettled />
                      )}
                      {rupees(r.closing)} <span className="side">{r.closingSide}</span>
                    </td>
                  </tr>
                ))}
                <tr className="opening">
                  <td data-label="">Total</td>
                  <td className="num" data-label="Opening" />
                  {movement.map((col) => (
                    <td className="num" data-label={col.label} key={col.label}>
                      {rupees(totals[col.key])}
                    </td>
                  ))}
                  <td className="num bal" data-label="Closing">
                    {rupees(totals.closing)} <span className="side">{totals.closingSide}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

    </>
  );
}
