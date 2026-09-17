import React, { useState } from 'react';
import { ChevronLeft, Paperclip, Pencil, ReceiptText, Trash2, X } from 'lucide-react'
import { useStore } from '../../../lib/store'
import VoucherBillPreview from './VoucherBillPreview'
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { useMutation } from 'convex/react';
import { rupees, shortDate, aadhaarGroups, phoneDisplay } from '../lib/format';
import PriceDialog from './PriceDialog';
import Confirm from './Confirm';
import { Bar, TableSkeleton } from './Skeleton';

const BackIcon = () => <ChevronLeft size={18} aria-hidden="true" />;

/** The goods on a bill — not its fare, discount, tax or round-off. */
const goodsOn = (bill) =>
  (bill?.items ?? []).filter(
    (i) => String(i?.description ?? '').trim() && !i.isRoundup && !i.isDiscount && !i.auto && !i.amountOnly
  );

const figure = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * What an unpriced bill is still waiting on: "Sunmica 15 Sheet".
 *
 * A supplier's goods often arrive days before the rate does, and the row used
 * to say only "Purchase 144" until then. Only the lines with no amount are
 * listed — a priced row needs none of this, and a priced line on a half-priced
 * bill is not what anyone is waiting for.
 */
function Goods({ bill, all = false }) {
  const waiting = goodsOn(bill).filter((i) => all || !Number(i.amount));
  if (!waiting.length) return null;
  return (
    <div className="billgoods">
      {waiting.map((i) => (
        <span key={i.id} className="good">
          {i.description}
          {Number(i.qty) ? ` ${figure(i.qty)} ${i.unit ?? ''}` : ''}
        </span>
      ))}
    </div>
  );
}

/** How long a delivery has waited for its bill: amber from 3 days, red from 7. */
const DAY_MS = 86400000;
const daysSince = (ms) => {
  const d = Math.max(0, Math.floor((Date.now() - ms) / DAY_MS));
  return d === 0 ? 'since today' : d === 1 ? '1 day' : `${d} days`;
};
const ageTone = (ms) => {
  const d = (Date.now() - ms) / DAY_MS;
  return d >= 7 ? 'late' : d >= 3 ? 'due' : '';
};

/** The wording a bill's voucher gets when nobody typed any: "Purchase 144". */
const DEFAULT_NARRATION = /^(Sale|Purchase|Receipt|Payment|Goods Return|Refund) \S+$/;
import VoucherEditor from './VoucherEditor';
import LedgerForm from './LedgerForm';
import TagDots from './TagDots';

/** One supplier's account, laid out the way their own statement is. */
export default function LedgerView({ ledgerId, masters, onBack, backLabel, onViewBill, onPrint, onAddVoucher }) {
  /**
   * The shop's own bills, so a line in the ledger can show the bill it posted.
   * A voucher and its bill find each other by `BILL-n`, which is the reference
   * the posting writes and the operator cannot overwrite.
   */
  const bills = useStore((st) => st.bills);
  const [previewing, setPreviewing] = useState(null);
  const billFor = (row) => {
    // The bill names its voucher outright; the BILL-n reference is the fallback
    // for bills saved before they did. Same test as VoucherEditor.
    const id = String(row?.voucherId ?? row?._id ?? '');
    const named = id && bills.find((b) => String(b.voucherId ?? '') === id);
    if (named) return named;
    const ref = String(row?.refNo ?? '');
    if (!ref.startsWith('BILL-')) return null;
    const number = ref.slice(5);
    return bills.find((b) => String(b.number) === number) ?? null;
  };
  const [pricing, setPricing] = useState(null);
  const [editing, setEditing] = useState(null);

  // Bill-backed vouchers are redirected inside VoucherEditor, so every edit
  // button here can stay a plain setEditing.
  function openEdit(p) { setEditing(p._id); }
  const [deleting, setDeleting] = useState(null);
  const [editParty, setEditParty] = useState(false);
  const removeVoucher = useMutation(api.vouchers.remove);
  // Deleting the account itself, from its own page — the same rule as Account
  // Masters: only an empty account, behind the shop's code, and the bin's hold
  // on it asked about separately.
  const removeLedger = useMutation(api.masters.removeLedger);
  const [deletingParty, setDeletingParty] = useState(false);
  const [purgingParty, setPurgingParty] = useState(null);
  const data = useLive(api.reports.ledger, { ledgerId }, `ledger:${ledgerId}`);
  const papers = useLive(api.review.papersFor, { ledgerId }, `papers:${ledgerId}`) ?? [];

  if (data === undefined) {
    return (
      <>
        <div className="partyhead">
          <div className="partyhead-main">
            <Bar w="90px" h={11} />
            <div style={{ height: 10 }} />
            <Bar w="220px" h={24} />
            <div style={{ height: 8 }} />
            <Bar w="160px" h={11} />
          </div>
          <div className="partyhead-figure">
            <Bar w="70px" h={10} />
            <div style={{ height: 8 }} />
            <Bar w="180px" h={26} />
          </div>
        </div>
        <TableSkeleton cols={8} rows={8} wide={4} />
      </>
    );
  }

  const account = data?.account;
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { debit: 0, credit: 0 };
  const pending = data?.pending ?? [];
  const received = data?.received ?? [];
  // Unpriced bills belong on their own dates, among the entries, not heaped at
  // the top. They carry no amount and no balance, so interleaving them is
  // presentation only — the running balance is worked out on the server and is
  // untouched by where they sit.
  const stream = [
    ...rows.map((r, i) => ({ kind: 'entry', key: `${r.voucherId}-${i}`, date: r.date, r })),
    ...pending.map((p) => ({ kind: 'pending', key: p._id, date: p.date, p })),
    // Deliveries sit on their dates like unpriced bills: no amount, no balance.
    ...received.map((g) => ({ kind: 'received', key: g._id, date: g.date, g })),
  ].sort(
    (a, b) =>
      a.date - b.date ||
      (a.kind === 'entry' ? 0 : 1) - (b.kind === 'entry' ? 0 : 1)
  );

  const groupName = (masters?.ledgers ?? []).find((l) => l._id === ledgerId)?.groupName;
  const isCustomer = groupName === 'Sundry Debtors';
  // Staff and rented premises: owed a month at a time and paid like a
  // supplier, but never sold to or bought from.
  const isMonthly = groupName === 'Staff' || groupName === 'Rent Payable';

  // What settling this account in full would take: a customer owing money sits
  // in debit, a supplier owed money in credit. Anything else — an advance, a
  // credit note — is not a figure worth suggesting, so nothing is filled in.
  const settles =
    data?.closingSide === (isCustomer ? 'Dr' : 'Cr') && data.closing > 0
      ? data.closing
      : undefined;

  // Nothing owed either way and no bill waiting for a price: the account is
  // done with, and says so in green.
  const isSettled = Boolean(data) && data.closing < 0.005 && pending.length === 0;

  return (
    <>
      <div className={`partyhead${isSettled ? ' settled' : ''}`}>
        <div className="partyhead-main">
          <button className="backbtn" onClick={onBack}>
            <BackIcon />
            {backLabel ?? (isCustomer ? 'All customers' : 'All suppliers')}
          </button>
          <div className="partyname">
            <h1>{account?.name ?? ''}</h1>
            <TagDots tags={account?.tags} ledgerId={ledgerId} size={11} />
            <button className="xbtn" onClick={() => setEditParty(true)} aria-label="Edit ledger">
              <Pencil size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="ref">
            {[
              account?.place,
              phoneDisplay(account?.phone),
              account?.gstin && `GSTIN ${account.gstin}`,
              account?.aadhaar && `Aadhaar ${aadhaarGroups(account.aadhaar)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {isMonthly && (account?.payee || account?.monthly) && (
            <div className="ref">
              {[account.payee, account.monthly && `${rupees(account.monthly)} a month`]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
          {account?.notes && <div className="note inline">{account.notes}</div>}
        </div>
        <div className="partyhead-figure">
          <div className="card-name">Closing</div>
          <div className="card-amt">
            {rupees(data?.closing ?? 0)} <span className="side">{data?.closingSide ?? 'Cr'}</span>
          </div>
          <div className="partyhead-actions">
            {/* Every voucher that can be written on this side of the books,
                with the account already named. */}
            {isMonthly ? (
              <button className="btn" onClick={() => onAddVoucher('payment', settles)}>
                + Payment
              </button>
            ) : isCustomer ? (
              <>
                <button className="btn" onClick={() => onAddVoucher('sale')}>+ Sale</button>
                <button className="btn" onClick={() => onAddVoucher('receipt', settles)}>
                  + Receipt
                </button>
                <button className="btn" onClick={() => onAddVoucher('return')}>+ Goods Return</button>
                <button className="btn" onClick={() => onAddVoucher('refund')}>+ Refund</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => onAddVoucher('grn')}>+ Goods Received</button>
                <button className="btn" onClick={() => onAddVoucher('purchase')}>+ Purchase</button>
                <button className="btn" onClick={() => onAddVoucher('payment', settles)}>
                  + Payment
                </button>
                <button className="btn" onClick={() => onAddVoucher('return')}>+ Goods Return</button>
              </>
            )}
            <button
              className="btn ghost"
              onClick={() => onPrint({ scope: 'party', ledgerId })}
            >
              Print
            </button>
            {rows.length || pending.length ? (
              <span
                className="btn ghost muted"
                title={`${rows.length + pending.length} vouchers are posted to this account — it cannot be deleted`}
                aria-disabled="true"
              >
                <Trash2 size={14} aria-hidden="true" />
              </span>
            ) : (
              <button className="btn ghost del" onClick={() => setDeletingParty(true)} aria-label="Delete account">
                <Trash2 size={14} aria-hidden="true" /> Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {deletingParty && account && (
        <Confirm
          title={`Delete ${account.name}?`}
          body="An account with any voucher against it cannot be deleted — only an empty one."
          confirmLabel="Delete"
          danger
          ask={{ label: 'Code', secret: true }}
          onConfirm={async (pin) => {
            try {
              await removeLedger({ id: ledgerId, pin, purgeTrash: false });
              onBack();
            } catch (err) {
              // The bin is the one refusal with a way through: offered, not reported.
              if (err?.data?.kind === 'trash') return setPurgingParty(err.data);
              throw new Error(String(err?.data ?? err?.message ?? err));
            }
          }}
          onClose={() => setDeletingParty(false)}
        />
      )}

      {purgingParty && account && (
        <Confirm
          title={`Delete ${account.name} and what the bin holds against it?`}
          body={`Nothing is posted to this account in the books, but the bin still holds ${[
            purgingParty.vouchers && `${purgingParty.vouchers} deleted voucher${purgingParty.vouchers === 1 ? '' : 's'}`,
            purgingParty.bills && `${purgingParty.bills} deleted bill${purgingParty.bills === 1 ? '' : 's'}`,
          ].filter(Boolean).join(' and ')} against it. They go for good — photographs included — and cannot be restored afterwards.`}
          confirmLabel="Delete for good"
          danger
          ask={{ label: 'Code', secret: true }}
          onConfirm={async (pin) => {
            try {
              await removeLedger({ id: ledgerId, pin, purgeTrash: true });
              onBack();
            } catch (err) {
              throw new Error(String(err?.data ?? err?.message ?? err));
            }
          }}
          onClose={() => setPurgingParty(null)}
        />
      )}

      <div className="toolbar">
        <div className="count">
          {rows.length} vouchers
          {pending.length > 0 && ` · ${pending.length} awaiting an amount`}
          {papers.length > 0 && ` · ${papers.length} statement${papers.length > 1 ? 's' : ''} on file`}
        </div>
      </div>

      {/* Above the ledger, not below it: a statement is the other side's word
          on this same account, and the only thing to do with it is hold it
          against the closing balance underneath. */}
      {papers.length > 0 && (
        <div className="papers">
          {papers.map((paper) => (
            <div className="paper" key={paper._id}>
              {paper.pages[0]?.url ? (
                <a href={paper.pages[0].url} target="_blank" rel="noreferrer">
                  <img src={paper.pages[0].url} alt="" loading="lazy" />
                </a>
              ) : (
                <div className="shot blank">no photo</div>
              )}
              <div className="paper-body">
                <div className="paper-head">
                  their statement
                  {paper.pages.length > 1 && (
                    <span className="ref"> · {paper.pages.length} sheets</span>
                  )}
                </div>
                <div className="ref">
                  {paper.to ? `to ${shortDate(paper.to)}` : `filed ${shortDate(paper.at)}`}
                </div>
                {paper.closing != null && (
                  <div className="paper-figure">
                    <span className="ref">they show</span> ₹{rupees(paper.closing)}
                    {data && (
                      <>
                        {' · '}
                        <span className="ref">books show</span> ₹{rupees(Math.abs(data.closing ?? 0))}
                        {Math.abs(Math.abs(data.closing ?? 0) - paper.closing) > 0.005 ? (
                          <b className="warn">
                            {' '}· off by ₹{rupees(Math.abs(Math.abs(data.closing ?? 0) - paper.closing))}
                          </b>
                        ) : (
                          <b className="agrees"> · agrees</b>
                        )}
                      </>
                    )}
                  </div>
                )}
                {paper.note && <div className="ref">{paper.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <div className="scroller">
          <table className="ledger">
            <thead>
              <tr>
                <th className="w-date">Date</th>
                <th className="w-no">Vch</th>
                <th className="w-type">Type</th>
                <th className="w-ref">Ref</th>
                <th>Particulars</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
                <th className="w-clip" />
                <th className="w-acts" />
              </tr>
            </thead>
            <tbody>
              <tr className="opening">
                <td className="mono" data-label="Date">
                  {data ? shortDate(data.openingAsOf) : ''}
                </td>
                <td className="hide-sm" />
                <td className="hide-sm" />
                <td className="hide-sm" />
                <td data-label="">Opening Balance</td>
                <td className="num hide-sm" />
                <td className="num hide-sm" />
                <td className="num bal" data-label="Balance">
                  {rupees(data?.opening ?? 0)}{' '}
                  <span className="side">{data?.openingSide ?? 'Cr'}</span>
                </td>
                <td className="hide-sm" />
                <td className="hide-sm" />
              </tr>

              {stream.map((item) =>
                item.kind === 'received' ? (
                  <tr
                    className={`received${item.g.open ? ` open ${ageTone(item.g.date)}` : ' billed'}`}
                    key={item.key}
                  >
                    <td className="mono" data-label="Date">{shortDate(item.g.date)}</td>
                    <td className="mono entryno" data-label="Vch">{item.g.vchLabel}</td>
                    <td className="vchtype" data-label="Type">Goods Received</td>
                    <td className="ref mono" data-label="Ref">{item.g.refNo || '—'}</td>
                    <td className="particulars" data-label="Particulars">
                      {goodsOn(billFor(item.g)).length ? (
                        <Goods bill={billFor(item.g)} all />
                      ) : (
                        <span className="ref">no lines written</span>
                      )}
                      <div className="ref">
                        {[
                          item.g.receivedBy && `checked by ${item.g.receivedBy}`,
                          item.g.open ? `waiting ${daysSince(item.g.date)}` : `billed in ${item.g.billedLabel}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="num" data-label="Debit" />
                    <td className="num" data-label="Bill">
                      {item.g.open ? (
                        <button
                          className="btn small"
                          onClick={() => onAddVoucher('purchase', undefined, { grn: item.g._id })}
                        >
                          Enter bill
                        </button>
                      ) : (
                        <span className="ref">{item.g.billedLabel}</span>
                      )}
                    </td>
                    <td className="num" data-label="Balance" />
                    <td className="w-clip" data-label="">
                      {item.g.attachmentUrls.length > 0 && (
                        <button
                          className="clip"
                          onClick={() => onViewBill({ ...item.g, party: account?.name })}
                          aria-label="Challan photo"
                        >
                          <Paperclip size={13} aria-hidden="true" /> {item.g.attachmentUrls.length > 1 ? item.g.attachmentUrls.length : ''}
                        </button>
                      )}
                    </td>
                    <td className="rowacts" data-label="">
                      <button className="xbtn" onClick={() => openEdit(item.g)} aria-label="Edit">
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button className="xbtn del" onClick={() => setDeleting(item.g)} aria-label="Delete">
                        <X size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ) : item.kind === 'pending' ? (
                  <tr className="unpriced" key={item.key}>
                    <td className="mono" data-label="Date">{shortDate(item.p.date)}</td>
                    <td className="mono entryno" data-label="Vch">{item.p.vchLabel}</td>
                    <td className="vchtype" data-label="Type">{item.p.vchType}</td>
                    <td className="ref mono" data-label="Ref">{item.p.refNo || '—'}</td>
                    <td className="particulars" data-label="Particulars">
                      {goodsOn(billFor(item.p)).length ? (
                        <>
                          <Goods bill={billFor(item.p)} />
                          {item.p.narration && !DEFAULT_NARRATION.test(item.p.narration) && (
                            <div className="ref">{item.p.narration}</div>
                          )}
                        </>
                      ) : (
                        item.p.narration || '—'
                      )}
                    </td>
                    <td className="num" data-label="Debit" />
                    <td className="num" data-label="Amount">
                      {/* A bill with its lines is priced line by line on the
                          bill itself, so the goods stay on record with their
                          rates; a bare slip takes one figure. */}
                      {goodsOn(billFor(item.p)).length ? (
                        <button className="btn small" onClick={() => openEdit(item.p)}>
                          Enter rates
                        </button>
                      ) : (
                        <button className="btn small" onClick={() => setPricing(item.p)}>
                          Enter amount
                        </button>
                      )}
                    </td>
                    <td className="num" data-label="Balance" />
                    <td className="w-clip" data-label="">
                      {item.p.attachmentUrls.length > 0 && (
                        <button
                          className="clip"
                          onClick={() => onViewBill({ ...item.p, party: account?.name })}
                          aria-label="Bill photo"
                        >
                          <Paperclip size={13} aria-hidden="true" /> {item.p.attachmentUrls.length > 1 ? item.p.attachmentUrls.length : ''}
                        </button>
                      )}
                      {/* The bill this line posted, drawn from the voucher
                          rather than stored as a picture of it. */}
                      {billFor(item.p) && (
                        <button
                          className="clip"
                          onClick={() => setPreviewing(billFor(item.p))}
                          aria-label="Show the bill"
                          title="Show the bill"
                        >
                          <ReceiptText size={13} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                    <td className="rowacts" data-label="">
                      <button className="xbtn" onClick={() => openEdit(item.p)} aria-label="Edit">
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button className="xbtn del" onClick={() => setDeleting(item.p)} aria-label="Delete">
                        <X size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={item.key}>
                    <td className="mono" data-label="Date">{shortDate(item.r.date)}</td>
                    <td className="mono entryno" data-label="Vch">{item.r.vchLabel}</td>
                    <td className="vchtype" data-label="Type">{item.r.vchType}</td>
                    <td className="ref mono" data-label="Ref">{item.r.refNo || '—'}</td>
                    <td className="particulars" data-label="Particulars">
                      {(item.r.contra ?? []).join(', ') || '—'}
                      {item.r.narration && item.r.narration !== item.r.vchType && (
                        <div className="ref">{item.r.narration}</div>
                      )}
                    </td>
                    <td className="num debit" data-label="Debit">
                      {item.r.side === 'Dr' ? rupees(item.r.amount) : ''}
                    </td>
                    <td className="num credit" data-label="Credit">
                      {item.r.side === 'Cr' ? rupees(item.r.amount) : ''}
                    </td>
                    <td className="num bal" data-label="Balance">
                      {rupees(Math.abs(item.r.balance))}{' '}
                      <span className="side">{item.r.balanceSide}</span>
                    </td>
                    <td className="w-clip" data-label="">
                      {item.r.attachmentUrls.length > 0 && (
                        <button
                          className="clip"
                          onClick={() => onViewBill({ ...item.r, party: account?.name })}
                          aria-label="Bill photo"
                        >
                          <Paperclip size={13} aria-hidden="true" /> {item.r.attachmentUrls.length > 1 ? item.r.attachmentUrls.length : ''}
                        </button>
                      )}
                      {/* The bill this line posted, drawn from the voucher
                          rather than stored as a picture of it. */}
                      {billFor(item.r) && (
                        <button
                          className="clip"
                          onClick={() => setPreviewing(billFor(item.r))}
                          aria-label="Show the bill"
                          title="Show the bill"
                        >
                          <ReceiptText size={13} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                    <td className="rowacts" data-label="">
                      <button
                        className="xbtn"
                        onClick={() => setEditing(item.r.voucherId)}
                        aria-label="Edit"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button className="xbtn del" onClick={() => setDeleting(item.r)} aria-label="Delete">
                        <X size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              )}

              <tr className="opening">
                <td className="hide-sm" />
                <td className="hide-sm" />
                <td className="hide-sm" />
                <td className="hide-sm" />
                <td data-label="">Closing Balance</td>
                <td className="num" data-label="Debit">{rupees(totals.debit)}</td>
                <td className="num" data-label="Credit">{rupees(totals.credit)}</td>
                <td className="num bal" data-label="Balance">
                  {rupees(data?.closing ?? 0)}{' '}
                  <span className="side">{data?.closingSide ?? 'Cr'}</span>
                </td>
                <td className="hide-sm" />
                <td className="hide-sm" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {editParty && account && (
        <LedgerForm
          groups={masters?.groups ?? []}
          edit={account}
          onClose={() => setEditParty(false)}
        />
      )}

      {editing && (
        <VoucherEditor
          id={editing}
          ledgers={masters?.ledgers ?? []}
          groups={masters?.groups ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <Confirm
          title={`Delete ${deleting.vchLabel}?`}
          body={`${account?.name} · ${shortDate(deleting.date)}. It moves to Trash, where it can be restored.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => removeVoucher({ id: deleting.voucherId ?? deleting._id })}
          onClose={() => setDeleting(null)}
        />
      )}

      {previewing && (
        <VoucherBillPreview bill={previewing} onClose={() => setPreviewing(null)} />
      )}

      {pricing && (
        <PriceDialog
          voucher={pricing}
          ledgers={masters?.ledgers ?? []}
          groups={masters?.groups ?? []}
          onClose={() => setPricing(null)}
        />
      )}
    </>
  );
}
