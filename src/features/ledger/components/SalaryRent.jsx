import React, { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
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
 * and what is still owed on each. A month is charged to everyone at once;
 * paying is an ordinary payment against the one account.
 */
export default function SalaryRent({ onOpen, onPay }) {
  const data = useLive(api.monthly.board, {}, 'monthly');
  const choices = monthChoices();
  const [month, setMonth] = useState(choices[1].id);
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
  const staffDue = data?.totals.staff.due ?? 0;
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

  return (
    <>
      <div className="summary">
        <div className="card total">
          <div className="card-name">Owed now</div>
          <div className="card-amt">{rupees(staffDue + rentDue)}</div>
          <div className="card-meta">salary and rent together</div>
        </div>
        <div className="card">
          <div className="card-name">Salaries owed</div>
          <div className="card-amt">{rupees(staffDue)}</div>
          <div className="card-meta">{rupees(data?.totals.staff.monthly ?? 0)} a month</div>
        </div>
        <div className="card">
          <div className="card-name">Rent owed</div>
          <div className="card-amt">{rupees(rentDue)}</div>
          <div className="card-meta">{rupees(data?.totals.rent.monthly ?? 0)} a month</div>
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
                    ? `${label} charged ✓`
                    : `Charge ${label} · ${rupees(pending.reduce((t, r) => t + r.monthly, 0))}`}
                </button>
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
                        <th>Charged</th>
                        <th className="num">Paid</th>
                        <th className="num">Owed</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.ledgerId}
                          // Paid up — but only once something has fallen due;
                          // an account never charged is not settled, just new.
                          className={`clickable${
                            Math.abs(r.due) < 0.005 && (r.charged > 0 || r.opening > 0) ? ' settled' : ''
                          }`}
                          onClick={() => onOpen(r.ledgerId)}
                        >
                          <td className="particulars" data-label={section.nameLabel}>
                            <div className="party">
                              {r.name}
                              <TagDots tags={r.tags} />
                            </div>
                            {(r.payee || r.phone) && (
                              <div className="ref">
                                {r.payee}
                                {r.payee && r.phone && ' · '}
                                {r.phone && (
                                  <a
                                    className="phone"
                                    href={phoneHref(r.phone)}
                                    onClick={(e) => e.stopPropagation()}
                                  >
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
                          <td data-label="Charged">
                            <MonthRun row={r} />
                          </td>
                          <td className="num" data-label="Paid">{rupees(r.paid)}</td>
                          <td className="num bal" data-label="Owed">
                            {rupees(Math.abs(r.due))}{' '}
                            <span className="side">{r.due < 0 ? 'ahead' : ''}</span>
                          </td>
                          <td className="rowacts" data-label="">
                            <button
                              className="btn small ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPay(r.ledgerId, r.due > 0 ? r.due : undefined);
                              }}
                            >
                              Pay
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="opening">
                        <td data-label="">Total</td>
                        <td className="num" data-label="Monthly">{rupees(totals.monthly)}</td>
                        <td data-label="" />
                        <td className="num" data-label="Paid">{rupees(totals.paid)}</td>
                        <td className="num bal" data-label="Owed">{rupees(totals.due)}</td>
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

/** The months on the account, with arrears carried in shown first. */
function MonthRun({ row }) {
  const chips = row.months.map((m) => m.label.replace(/ (\d{2})(\d{2})$/, ' $2'));
  return (
    <div className="chips tiny monthrun">
      {row.opening > 0 && (
        <span className="chip" title="Owed from before">
          before · {rupees(row.opening)}
        </span>
      )}
      {chips.length === 0 && row.opening <= 0 && <span className="ref">—</span>}
      {chips.map((c) => (
        <span className="chip" key={c}>{c}</span>
      ))}
    </div>
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
        <p className="hint">Months already charged keep their old figure.</p>
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
