import React, { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { Check } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, phoneDisplay, phoneHref, inputDate, today, fromInputDate } from '../lib/format';
import Combo from './Combo';
import TagDots from './TagDots';
import { CardsSkeleton, TableSkeleton } from './Skeleton';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const keyOf = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const shortOf = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${y}`;
};

/** "Oct '26": a month as a column heads it. */
const colOf = (key) => shortOf(key).replace(/ 20(\d\d)$/, " '$1");

/** The four months up to the one picked, oldest first — the columns. */
function monthsUpTo(key, count = 4) {
  const [y, m] = key.split('-').map(Number);
  const out = [];
  for (let back = count - 1; back >= 0; back--) {
    const d = new Date(y, m - 1 - back, 1);
    out.push(keyOf(d.getFullYear(), d.getMonth()));
  }
  return out;
}

/** This month, the eleven before it and the next — what anyone would charge. */
function monthChoices() {
  const now = new Date();
  const out = [];
  for (let back = -1; back <= 11; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    out.push({
      id: keyOf(d.getFullYear(), d.getMonth()),
      name: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return out;
}

const SECTIONS = [
  {
    kind: 'staff',
    title: 'Salaries',
    nameLabel: 'Staff',
    what: 'salary',
  },
  {
    kind: 'rent',
    title: 'Rents',
    nameLabel: 'Premises',
    what: 'rent',
  },
];

/**
 * Salaries and rents — what falls due every month, what has been handed over,
 * and what is still owed on each, laid out month by month: a rent shows each
 * month's rent and what was paid in it, a salary what was paid in it. A month
 * is charged to everyone at once; paying is an ordinary payment against the
 * one account. A landlord letting the shop several premises is one account.
 */
export default function SalaryRent({ onOpen, onPay }) {
  const choices = monthChoices();
  const [month, setMonth] = useState(choices[1].id);
  const data = useLive(api.monthly.board, { month }, `monthly:${month}`);
  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState('');
  const chargeMonth = useMutation(api.monthly.chargeMonth);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(''), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  if (data === undefined) {
    return (
      <>
        <CardsSkeleton count={3} />
        <TableSkeleton cols={6} rows={6} wide={1} />
      </>
    );
  }

  const label = shortOf(month);
  const wagesPaid = data?.totals.staff.paidInMonth ?? 0;
  const rentDue = data?.totals.rent.due ?? 0;

  const charge = async (section, pending) => {
    setBusy(section.kind);
    try {
      const { posted } = await chargeMonth({ kind: section.kind, month });
      setFlash(
        posted.length
          ? `${label} ${section.what} charged to ${posted.length} — ${pending.map((r) => r.name).join(', ')}`
          : `${label} ${section.what} was already charged to everyone`
      );
    } catch (err) {
      setFlash(err.message ?? String(err));
    } finally {
      setBusy('');
    }
  };

  // Month by month, oldest first, ending at the month picked.
  const cols = monthsUpTo(month);
  const cellOf = (r, key) => (r.byMonth ?? []).find((m) => m.key === key) ?? { charged: 0, paid: 0 };
  // Owed as the first month shown began: from before, and every month before it.
  const carried = (r) => r.opening + (r.byMonth ?? [])
    .filter((m) => m.key < cols[0])
    .reduce((t, m) => t + m.charged - m.paid, 0);
  const before = `Before ${colOf(cols[0])}`;

  const rowFor = (section, r) => {
    const rent = section.kind === 'rent';
    const brought = carried(r);
    const payee = r.payee && r.payee !== r.name ? r.payee : null;
    return (
      <tr
        key={r.ledgerId}
        // Paid up — but only once something has fallen due;
        // an account never charged is not settled, just new.
        className={`clickable${
          rent && Math.abs(r.due) < 0.005 && (r.charged > 0 || r.opening > 0) ? ' settled' : ''
        }`}
        onClick={() => onOpen(r.ledgerId)}
      >
        <td className="particulars" data-label={section.nameLabel}>
          <div className="party">
            {r.name}
            <TagDots tags={r.tags} />
          </div>
          {(payee || r.phone) && (
            <div className="ref">
              {payee}
              {payee && r.phone && ' · '}
              {r.phone && (
                <a className="phone" href={phoneHref(r.phone)} onClick={(e) => e.stopPropagation()}>
                  {phoneDisplay(r.phone)}
                </a>
              )}
            </div>
          )}
        </td>
        <td className="num" data-label="Monthly">
          <button
            className="link"
            title="Change the monthly figure"
            onClick={(e) => {
              e.stopPropagation();
              setEditing({ section, row: r });
            }}
          >
            {rupees(r.monthly)}
          </button>
        </td>
        {rent && (
          <td className="num" data-label={before}>
            {Math.abs(brought) < 0.005 ? <span className="mnone">—</span> : rupees(brought)}
          </td>
        )}
        {cols.map((key) => {
          const cell = cellOf(r, key);
          return (
            <td key={key} className={`num mcell${key === month ? ' now' : ''}`} data-label={colOf(key)}>
              {rent ? (
                <>
                  {cell.charged > 0 ? <span className="mdue">{rupees(cell.charged)}</span> : <span className="mnone">—</span>}
                  {cell.paid > 0 && <span className="mpaid">paid {rupees(cell.paid)}</span>}
                </>
              ) : cell.paid > 0 ? (
                rupees(cell.paid)
              ) : (
                <span className="mnone">—</span>
              )}
            </td>
          );
        })}
        {rent && (
          <td className="num bal" data-label="Owed">
            {rupees(Math.abs(r.due))}{' '}
            <span className="side">{r.due < 0 ? 'ahead' : ''}</span>
          </td>
        )}
        <td className="rowacts" data-label="">
          <button
            className="btn small ghost"
            onClick={(e) => {
              e.stopPropagation();
              onPay(r.ledgerId, rent && r.due > 0 ? r.due : undefined);
            }}
          >
            Pay
          </button>
        </td>
      </tr>
    );
  };

  return (
    <>
      <div className="summary">
        <div className="card total">
          <div className="card-name">Rent owed</div>
          <div className="card-amt">{rupees(rentDue)}</div>
          <div className="card-meta">{rupees(data?.totals.rent.monthly ?? 0)} a month</div>
        </div>
        {/* Wages are paid by the day: this is what went out, not what is owed. */}
        <div className="card">
          <div className="card-name">Wages paid · {label}</div>
          <div className="card-amt">{rupees(wagesPaid)}</div>
          <div className="card-meta">salary sheet {rupees(data?.totals.staff.monthly ?? 0)} a month</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="monthpick">
          <span className="count">Month</span>
          <Combo options={choices} value={month} onChange={(id) => id && setMonth(id)} />
        </div>
        <button className="btn" onClick={() => onPay()}>+ Payment</button>
      </div>

      {flash && <div className="note monthly-flash">{flash}</div>}

      {SECTIONS.map((section) => {
        const rows = data?.[section.kind] ?? [];
        const totals = data?.totals[section.kind] ?? { monthly: 0, due: 0, paid: 0 };
        // Who has a figure and has not been charged the month picked.
        const pending = rows.filter(
          (r) => r.monthly > 0 && !r.months.some((m) => m.label === label)
        );
        const done = rows.length > 0 && pending.length === 0;

        return (
          <section className="monthly" key={section.kind}>
            <div className="monthly-head">
              <h2>{section.title}</h2>
              <div className="monthly-acts">
                {section.kind === 'rent' && (
                <button
                  className={`btn small${done ? ' ghost' : ''}`}
                  disabled={done || busy === section.kind || rows.length === 0}
                  onClick={() => charge(section, pending)}
                  title={
                    done
                      ? `Everyone has ${label} ${section.what} on their account`
                      : `Puts ${label} ${section.what} on ${pending.map((r) => r.name).join(', ')}`
                  }
                >
                  {done
                    ? <>{label} charged <Check size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /></>
                    : `Charge ${label} · ${rupees(pending.reduce((t, r) => t + r.monthly, 0))}`}
                </button>
                )}
                <button className="btn small ghost" onClick={() => setAdding(section)}>
                  + {section.nameLabel}
                </button>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="empty">No {section.nameLabel.toLowerCase()} yet.</div>
            ) : (
              <div className="table-wrap">
                <div className="scroller">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>{section.nameLabel}</th>
                        <th className="num">Monthly</th>
                        {section.kind === 'rent' && <th className="num">{before}</th>}
                        {cols.map((key) => (
                          <th key={key} className={`num${key === month ? ' now' : ''}`}>
                            {colOf(key)}
                            {section.kind === 'staff' && <small className="mhead">paid</small>}
                          </th>
                        ))}
                        {section.kind === 'rent' && <th className="num">Owed</th>}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => rowFor(section, r))}
                      <tr className="opening">
                        <td data-label="">Total</td>
                        <td className="num" data-label="Monthly">{rupees(totals.monthly)}</td>
                        {section.kind === 'rent' && (
                          <td className="num" data-label={before}>{rupees(rows.reduce((t, r) => t + carried(r), 0))}</td>
                        )}
                        {cols.map((key) => {
                          const charged = rows.reduce((t, r) => t + cellOf(r, key).charged, 0);
                          const paid = rows.reduce((t, r) => t + cellOf(r, key).paid, 0);
                          return (
                            <td key={key} className={`num mcell${key === month ? ' now' : ''}`} data-label={colOf(key)}>
                              {section.kind === 'rent' ? (
                                <>
                                  {charged > 0 ? <span className="mdue">{rupees(charged)}</span> : <span className="mnone">—</span>}
                                  {paid > 0 && <span className="mpaid">paid {rupees(paid)}</span>}
                                </>
                              ) : (
                                rupees(paid)
                              )}
                            </td>
                          );
                        })}
                        {section.kind === 'rent' && <td className="num bal" data-label="Owed">{rupees(totals.due)}</td>}
                        <td data-label="" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        );
      })}

      {adding && <AccountForm section={adding} onClose={() => setAdding(null)} />}
      {editing && (
        <MonthlyForm
          section={editing.section}
          row={editing.row}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function useNoScroll() {
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
}

/** A new member of staff, or a newly rented premises. */
function AccountForm({ section, onClose }) {
  useNoScroll();
  const addAccount = useMutation(api.monthly.addAccount);
  const rent = section.kind === 'rent';
  const [name, setName] = useState('');
  const [payee, setPayee] = useState('');
  const [phone, setPhone] = useState('');
  const [monthly, setMonthly] = useState('');
  const [owed, setOwed] = useState('');
  const [asOf, setAsOf] = useState(inputDate(today()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError(rent ? 'Name the premises' : 'Give the name');
    if (!(Number(monthly) > 0)) return setError('Enter the monthly amount');
    setBusy(true);
    try {
      await addAccount({
        kind: section.kind,
        name: name.trim(),
        monthly: Number(monthly),
        payee: rent ? payee.trim() || undefined : undefined,
        phone: phone.trim() || undefined,
        owed: Number(owed) || undefined,
        owedAsOf: fromInputDate(asOf),
      });
      onClose();
    } catch (err) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2>{rent ? 'New rented premises' : 'New member of staff'}</h2>
        <label>
          {rent ? 'Premises' : 'Name'}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={rent ? 'Front Godown' : ''}
            autoFocus
          />
        </label>
        {rent && (
          <label>
            Landlord
            <input value={payee} onChange={(e) => setPayee(e.target.value)} />
          </label>
        )}
        <div className="row">
          <label>
            {rent ? 'Rent a month' : 'Salary a month'}
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          </label>
          <label>
            Phone
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        {rent && (
        <div className="row">
          <label>
            Already owed
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={owed}
              onChange={(e) => setOwed(e.target.value)}
              placeholder="0"
            />
          </label>
          <label>
            As of
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </label>
        </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * A raise, a new rent, a new landlord. Months already charged stay at what
 * they were — the new figure applies from the next month charged.
 */
function MonthlyForm({ section, row, onClose }) {
  useNoScroll();
  const updateLedger = useMutation(api.masters.updateLedger);
  const rent = section.kind === 'rent';
  const [monthly, setMonthly] = useState(String(row.monthly || ''));
  // For staff this is the salary sheet's figure, kept for reference; nothing is charged from it.
  const [payee, setPayee] = useState(row.payee ?? '');
  const [phone, setPhone] = useState(row.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(monthly) > 0)) return setError('Enter the monthly amount');
    setBusy(true);
    try {
      await updateLedger({
        id: row.ledgerId,
        monthly: Number(monthly),
        phone: phone.trim() || undefined,
        ...(rent ? { payee: payee.trim() || undefined } : {}),
      });
      onClose();
    } catch (err) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2>{row.name}</h2>
        <label>
          {rent ? 'Rent a month' : 'Salary a month'}
          <input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            autoFocus
          />
        </label>
        {rent && (
          <label>
            Landlord
            <input value={payee} onChange={(e) => setPayee(e.target.value)} />
          </label>
        )}
        <label>
          Phone
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <p className="hint">
          {rent ? 'Months already charged keep their old figure.' : 'For reference — wages are recorded as they are paid.'}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
