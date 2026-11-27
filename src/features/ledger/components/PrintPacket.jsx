import React from 'react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, rupeesInWords, shortDate, longDate, inputDate, aadhaarMasked, phoneDisplay, statementDetails } from '../lib/format';

const SHOP = 'Shiv Hardware Store';

/** Typeset letterhead — the shop on the left, the document on the right. */
function Head({ title, from, till }) {
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
        {(from || till) && (
          <div className="lh-date">
            {from && till ? `${longDate(from)} to ${longDate(till)}` : from ? `From ${longDate(from)}` : `Up to ${longDate(till)}`}
          </div>
        )}
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
function PartyPacket({ ledgerId, from, till }) {
  // A from date starts the statement there: everything before it rolls into the
  // opening balance (reports.ledger `from`). A till date ends it: entries after
  // it are left out and the closing balance is the balance on that day (`to`).
  const args = { ledgerId };
  if (from !== undefined) args.from = from;
  if (till !== undefined) args.to = till;
  const data = useLive(api.reports.ledger, args, `ledger:${ledgerId}${from !== undefined ? `:from:${from}` : ''}${till !== undefined ? `:to:${till}` : ''}`);
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

  // The opening balance sits in its own column, as the first line.
  const openingDr = data.openingSide === 'Dr';
  // The running balance after each entry (Dr above zero), as a passbook shows it.
  let running = openingDr ? data.opening : -data.opening;
  const openingBalance = running;
  const balanceAfter = data.rows.map((r) => (running += r.side === 'Dr' ? r.amount : -r.amount));
  const balanceText = (v) => `${rupees(Math.abs(v))} ${v < -0.005 ? 'Cr' : 'Dr'}`;
  // An account's opening date can come after its first entries (its opening
  // balance set later): the opening line then takes the first entry's date.
  const openingDate = from ?? Math.min(data.openingAsOf ?? Infinity, ...data.rows.map((r) => r.date));

  return (
    <>
      <div className="sheet">
        <Head title="Statement of Account" from={from} till={till} />

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
                <td>Opening as at {shortDate(openingDate)}</td>
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

        <table className="print statement">
          <thead>
            <tr>
              <th className="w-date">Date</th>
              <th>No.</th>
              <th>Details</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="rule">
              <td>{shortDate(openingDate)}</td>
              <td />
              <td>Opening Balance</td>
              <td className="num">{openingDr ? rupees(data.opening) : ''}</td>
              <td className="num">{openingDr ? '' : rupees(data.opening)}</td>
              <td className="num">{balanceText(openingBalance)}</td>
            </tr>
            {data.rows.map((r, i) => (
              <tr key={`${r.voucherId}-${i}`}>
                <td>{shortDate(r.date)}</td>
                <td>{r.vchLabel}</td>
                <td className="details">{statementDetails(r)}</td>
                <td className="num">{r.side === 'Dr' ? rupees(r.amount) : ''}</td>
                <td className="num">{r.side === 'Cr' ? rupees(r.amount) : ''}</td>
                <td className="num">{balanceText(balanceAfter[i])}</td>
              </tr>
            ))}
            {/* One closing line: the Balance column already shows where the
                account stands after every entry. */}
            <tr className="grand">
              <td colSpan={5}>Closing Balance</td>
              <td className="num">{rupees(data.closing)} {data.closingSide}</td>
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
  // From and till dates (owner's ask, 26 Nov 2026): the statement for a chosen
  // stretch. Entry dates are UTC midnights (format.js inputDate), so the start
  // of the from day and the end of the till day keep every entry dated on
  // them. Either may be left empty; both empty is the whole account, as before.
  const [fromDay, setFromDay] = React.useState('');
  const [tillDay, setTillDay] = React.useState('');
  const from = fromDay ? Date.parse(`${fromDay}T00:00:00.000Z`) : undefined;
  const till = tillDay ? Date.parse(`${tillDay}T23:59:59.999Z`) : undefined;
  const today = inputDate(Date.now());
  return (
    <div className="packet">
      <div className="packet-bar no-print">
        <button className="link" onClick={onBack}>← Back</button>
        {scope === 'party' && (
          <div className="packet-till">
            <label>
              From
              <input type="date" value={fromDay} max={tillDay || today} onChange={(e) => setFromDay(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={tillDay} min={fromDay || undefined} max={today} onChange={(e) => setTillDay(e.target.value)} />
            </label>
            {(fromDay || tillDay) && <button className="link" onClick={() => { setFromDay(''); setTillDay('') }}>All</button>}
          </div>
        )}
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>
      {scope === 'party' ? <PartyPacket ledgerId={ledgerId} from={from} till={till} /> : <AllPacket />}
    </div>
  );
}
