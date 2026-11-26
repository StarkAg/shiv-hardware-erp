import React from 'react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, rupeesInWords, shortDate, longDate, inputDate, aadhaarMasked, phoneDisplay, rowType } from '../lib/format';

const SHOP = 'Shiv Hardware Store';

/** Typeset letterhead — the shop on the left, the document on the right. */
function Head({ title, till }) {
  return (
    <header className="letterhead">
      <div className="lh-shop">
        <div className="lh-name">{SHOP}</div>
        <div className="lh-line">Shivaji Road, Near Gandhi Highschool, Ramgarh Cantt – 829122</div>
        {/* No GSTIN on the letterhead. Nothing printed from here is a tax
            invoice — these are statements of account — and a GST number at the
            top of one reads as a claim that it is. The number belongs on the
            bill itself, which is printed elsewhere. */}
        <div className="lh-line">8092850954, 9835350954</div>
      </div>
      <div className="lh-doc">
        <div className="lh-title">{title}</div>
        {till && <div className="lh-date">Up to {longDate(till)}</div>}
        <div className="lh-date">Printed {longDate(Date.now())}</div>
      </div>
    </header>
  );
}

function Sign() {
  return (
    <div className="sign">
      <div className="sign-box">
        <div className="sign-for">For {SHOP}</div>
        <div className="sign-line">Proprietor</div>
      </div>
    </div>
  );
}

function Foot({ left }) {
  return (
    <div className="sheet-foot">
      <span>{left}</span>
      <span>{SHOP} · Shivaji Road, Ramgarh Cantt</span>
    </div>
  );
}

/** Which way a balance points, said plainly rather than in Dr/Cr. */
const standing = (side) =>
  side === 'Cr' ? `Payable by ${SHOP}` : `Receivable by ${SHOP}`;

/** Cover sheet, the account itself, then a page for every bill photo. */
function PartyPacket({ ledgerId, till }) {
  // A till date ends the statement there: entries after it are left out and the
  // closing balance is the balance on that day (reports.ledger `to`).
  const data = useLive(
    api.reports.ledger,
    till ? { ledgerId, to: till } : { ledgerId },
    till ? `ledger:${ledgerId}:to:${till}` : `ledger:${ledgerId}`,
  );
  if (!data) return null;

  const { account } = data;
  // A printed statement can end up in other hands, so the Aadhaar shows only
  // its last four digits — enough to recognise the account, not enough to use.
  const contact = [
    account.place,
    phoneDisplay(account.phone),
    account.gstin && `GSTIN ${account.gstin}`,
    account.aadhaar && `Aadhaar ${aadhaarMasked(account.aadhaar)}`,
  ].filter(Boolean);
  const withShots = data.rows.filter((r) => r.attachmentUrls.length > 0);

  // The opening balance belongs in its own column, so that the two columns and
  // the closing figure add up the way a ledger is meant to.
  const openingDr = data.openingSide === 'Dr';
  const totalDr = data.totals.debit + (openingDr ? data.opening : 0);
  const totalCr = data.totals.credit + (openingDr ? 0 : data.opening);
  const closingOnDebit = totalCr > totalDr;
  const grand = Math.max(totalDr, totalCr);

  return (
    <>
      <div className="sheet">
        <Head title="Statement of Account" till={till} />

        <div className="statement-head">
          <div className="to-block">
            <div className="to-label">Account</div>
            <div className="to-name">{account.name}</div>
            {contact.map((line) => (
              <div className="to-line" key={line}>{line}</div>
            ))}
          </div>

          <table className="figures">
            <tbody>
              <tr>
                <td>Opening as at {shortDate(data.openingAsOf)}</td>
                <td className="num">{rupees(data.opening)} {data.openingSide}</td>
              </tr>
              <tr>
                <td>Total debit</td>
                <td className="num">{rupees(data.totals.debit)}</td>
              </tr>
              <tr>
                <td>Total credit</td>
                <td className="num">{rupees(data.totals.credit)}</td>
              </tr>
              <tr className="closing">
                <td>Closing balance</td>
                <td className="num">{rupees(data.closing)} {data.closingSide}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="in-words">
          {rupeesInWords(data.closing)} — {standing(data.closingSide)}
        </p>

        <table className="print">
          <thead>
            <tr>
              <th className="w-date">Date</th>
              <th>Vch</th>
              <th>Type</th>
              <th>Ref</th>
              <th>Particulars</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            <tr className="rule">
              <td>{shortDate(data.openingAsOf)}</td>
              <td colSpan={4}>{openingDr ? 'To' : 'By'} Opening Balance</td>
              <td className="num">{openingDr ? rupees(data.opening) : ''}</td>
              <td className="num">{openingDr ? '' : rupees(data.opening)}</td>
            </tr>
            {data.rows.map((r, i) => (
              <tr key={`${r.voucherId}-${i}`}>
                <td>{shortDate(r.date)}</td>
                <td>{r.vchLabel}</td>
                <td>{r.side === 'Dr' ? 'To' : 'By'} {rowType(r)}</td>
                <td>{r.refNo || '—'}</td>
                <td>
                  {(r.contra ?? []).join(', ') || '—'}
                  {r.narration && r.narration !== r.vchType ? ` — ${r.narration}` : ''}
                </td>
                <td className="num">{r.side === 'Dr' ? rupees(r.amount) : ''}</td>
                <td className="num">{r.side === 'Cr' ? rupees(r.amount) : ''}</td>
              </tr>
            ))}
            {/* Tally's footer: the two columns as they stand, the closing
                balance entered on the lighter side to square them, then the
                grand totals — equal, which is the proof. */}
            <tr className="subtotal">
              <td colSpan={5} />
              <td className="num">{rupees(totalDr)}</td>
              <td className="num">{rupees(totalCr)}</td>
            </tr>
            <tr className="closing-line">
              <td colSpan={5}>{closingOnDebit ? 'To' : 'By'} Closing Balance</td>
              <td className="num">{closingOnDebit ? rupees(data.closing) : ''}</td>
              <td className="num">{closingOnDebit ? '' : rupees(data.closing)}</td>
            </tr>
            <tr className="grand">
              <td colSpan={5} />
              <td className="num">{rupees(grand)}</td>
              <td className="num">{rupees(grand)}</td>
            </tr>
          </tbody>
        </table>

        {data.pendingCount > 0 && (
          <p className="caveat">
            {data.pendingCount} {data.pendingCount === 1 ? 'bill is' : 'bills are'} filed without
            an amount and {data.pendingCount === 1 ? 'is' : 'are'} not included above.
          </p>
        )}

        <Sign />
        <Foot left={`Statement of Account · ${account.name}`} />
      </div>

      {withShots.map((r) =>
        r.attachmentUrls.map((shot, n) => (
          <div className="sheet bill-page" key={`${r.voucherId}-${shot.storageId}`}>
            <div className="bill-head">
              <div className="bill-head-title">
                <b>{SHOP}</b>
                <span>Document attached to voucher {r.vchLabel}</span>
              </div>
              {/* Label over value, each its own block — a table here left an
                  empty Ref collapsing a column and shunting the next label
                  halfway across the strip. */}
              <dl className="bill-meta">
                <div>
                  <dt>Document</dt>
                  <dd style={{ textTransform: 'capitalize' }}>{shot.label}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{account.name}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{shortDate(r.date)}</dd>
                </div>
                {r.refNo && (
                  <div>
                    <dt>Ref</dt>
                    <dd>{r.refNo}</dd>
                  </div>
                )}
                {r.amount != null && (
                  <div>
                    <dt>Amount</dt>
                    <dd>{rupees(r.amount)}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="bill-frame">
              <img src={shot.previewUrl ?? shot.url} alt="" />
            </div>
            <Foot
              left={
                r.attachmentUrls.length > 1
                  ? `${r.vchLabel} · sheet ${n + 1} of ${r.attachmentUrls.length}`
                  : r.vchLabel
              }
            />
          </div>
        ))
      )}
    </>
  );
}

function PartyTable({ rows, totals, nameLabel, movement }) {
  return (
    <table className="print">
      <thead>
        <tr>
          <th>{nameLabel}</th>
          <th className="num">Opening</th>
          {movement.map((c) => (
            <th className="num" key={c.label}>{c.label}</th>
          ))}
          <th className="num">Closing</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ledger._id}>
            <td>
              {r.ledger.name}
              {r.ledger.place ? <span className="muted"> · {r.ledger.place}</span> : null}
            </td>
            <td className="num">{rupees(r.opening)} {r.openingSide}</td>
            {movement.map((c) => (
              <td className="num" key={c.label}>{rupees(r[c.key])}</td>
            ))}
            <td className="num">{rupees(r.closing)} {r.closingSide}</td>
          </tr>
        ))}
        <tr className="rule total">
          <td>Total</td>
          <td className="num" />
          {movement.map((c) => (
            <td className="num" key={c.label}>{rupees(totals[c.key])}</td>
          ))}
          <td className="num">{rupees(totals.closing)} {totals.closingSide}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** One sheet: both sides of the book — what is owed, and what is due in. */
function AllPacket() {
  const payables = useLive(api.reports.outstanding, {}, 'payables');
  const receivables = useLive(api.reports.receivables, {}, 'receivables');
  if (!payables) return null;

  return (
    <div className="sheet">
      <Head title="Outstanding Statement" />

      <div className="statement-head">
        <div className="to-block">
          <div className="to-label">As at</div>
          <div className="to-name">{longDate(Date.now())}</div>
          <div className="to-line">All ledgers carrying a balance</div>
        </div>

        <table className="figures">
          <tbody>
            <tr>
              <td>Payable to suppliers</td>
              <td className="num">{rupees(payables.totals.closing)} {payables.totals.closingSide}</td>
            </tr>
            <tr>
              <td>Due from customers</td>
              <td className="num">
                {rupees(receivables?.totals.closing ?? 0)} {receivables?.totals.closingSide ?? 'Dr'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="in-words">
        {rupeesInWords(payables.totals.closing)} — {standing(payables.totals.closingSide)}
      </p>

      <h2>Payable to suppliers</h2>
      <PartyTable
        rows={payables.rows}
        totals={payables.totals}
        nameLabel="Supplier"
        movement={[
          { label: 'Purchases', key: 'credits' },
          { label: 'Paid', key: 'debits' },
        ]}
      />
      {payables.totals.pendingCount > 0 && (
        <p className="caveat">
          {payables.totals.pendingCount} bills are filed without an amount and are not included
          above.
        </p>
      )}

      {receivables && receivables.rows.length > 0 && (
        <>
          <h2>Due from customers</h2>
          <PartyTable
            rows={receivables.rows}
            totals={receivables.totals}
            nameLabel="Customer"
            movement={[
              { label: 'Sold', key: 'debits' },
              { label: 'Received', key: 'credits' },
            ]}
          />
        </>
      )}

      <Sign />
      <Foot left="Outstanding Statement" />
    </div>
  );
}

export default function PrintPacket({ scope, ledgerId, onBack }) {
  // "Till date" (owner's ask, 26 Nov 2026): the statement up to a chosen day.
  // Entry dates are UTC midnights (format.js inputDate), so the end of that
  // UTC day keeps every entry dated on it. Empty: everything, as before.
  const [tillDay, setTillDay] = React.useState('');
  const till = tillDay ? Date.parse(`${tillDay}T23:59:59.999Z`) : undefined;
  return (
    <div className="packet">
      <div className="packet-bar no-print">
        <button className="link" onClick={onBack}>← Back</button>
        {scope === 'party' && (
          <label className="packet-till">
            Till date
            <input type="date" value={tillDay} max={inputDate(Date.now())} onChange={(e) => setTillDay(e.target.value)} />
            {tillDay && <button className="link" onClick={() => setTillDay('')}>All</button>}
          </label>
        )}
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>
      {scope === 'party' ? <PartyPacket ledgerId={ledgerId} till={till} /> : <AllPacket />}
    </div>
  );
}
