import React, { useState } from 'react';
import { ChevronLeft, Paperclip, Pencil, ReceiptText, X } from 'lucide-react'
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
import VoucherEditor from './VoucherEditor';
import LedgerForm from './LedgerForm';
import TagDots from './TagDots';

/** One supplier's account, laid out the way their own statement is. */
export default function LedgerView({ ledgerId, masters, onBack, onViewBill, onPrint, onAddVoucher }) {
  /**
   * The shop's own bills, so a line in the ledger can show the bill it posted.
   * A voucher and its bill find each other by `BILL-n`, which is the reference
   * the posting writes and the operator cannot overwrite.
   */
  const bills = useStore((st) => st.bills);
  const [previewing, setPreviewing] = useState(null);
  const billFor = (row) => {
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
  // Unpriced bills belong on their own dates, among the entries, not heaped at
  // the top. They carry no amount and no balance, so interleaving them is
  // presentation only — the running balance is worked out on the server and is
  // untouched by where they sit.
  const stream = [
    ...rows.map((r, i) => ({ kind: 'entry', key: `${r.voucherId}-${i}`, date: r.date, r })),
    ...pending.map((p) => ({ kind: 'pending', key: p._id, date: p.date, p })),
  ].sort(
    (a, b) =>
      a.date - b.date ||
      (a.kind === 'pending' ? 1 : 0) - (b.kind === 'pending' ? 1 : 0)
  );

  const isCustomer =
    (masters?.ledgers ?? []).find((l) => l._id === ledgerId)?.groupName === 'Sundry Debtors';

  // What settling this account in full would take: a customer owing money sits
  // in debit, a supplier owed money in credit. Anything else — an advance, a
  // credit note — is not a figure worth suggesting, so nothing is filled in.
  const settles =
    data?.closingSide === (isCustomer ? 'Dr' : 'Cr') && data.closing > 0
      ? data.closing
      : undefined;

  return (
    <>
      <div className="partyhead">
        <div className="partyhead-main">
          <button className="backbtn" onClick={onBack}>
            <BackIcon />
            {isCustomer ? 'All customers' : 'All suppliers'}
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
          {account?.notes && <div className="note inline">{account.notes}</div>}
        </div>
        <div className="partyhead-figure">
          <div className="card-name">Closing</div>
          <div className="card-amt">
            {rupees(data?.closing ?? 0)} <span className="side">{data?.closingSide ?? 'Cr'}</span>
          </div>
          <div className="partyhead-actions">
            {isCustomer ? (
              <>
                <button className="btn" onClick={() => onAddVoucher('sale')}>+ Sale</button>
                <button className="btn" onClick={() => onAddVoucher('receipt', settles)}>
                  + Receipt
                </button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => onAddVoucher('purchase')}>+ Purchase</button>
                <button className="btn" onClick={() => onAddVoucher('payment', settles)}>
                  + Payment
                </button>
              </>
            )}
            <button
              className="btn ghost"
              onClick={() => onPrint({ scope: 'party', ledgerId })}
            >
              Print
            </button>
          </div>
        </div>
      </div>

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
                item.kind === 'pending' ? (
                  <tr className="unpriced" key={item.key}>
                    <td className="mono" data-label="Date">{shortDate(item.p.date)}</td>
                    <td className="mono entryno" data-label="Vch">{item.p.vchLabel}</td>
                    <td className="vchtype" data-label="Type">{item.p.vchType}</td>
                    <td className="ref mono" data-label="Ref">{item.p.refNo || '—'}</td>
                    <td className="particulars" data-label="Particulars">
                      {item.p.narration || '—'}
                    </td>
                    <td className="num" data-label="Debit" />
                    <td className="num" data-label="Amount">
                      <button className="btn small" onClick={() => setPricing(item.p)}>
                        Enter amount
                      </button>
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
