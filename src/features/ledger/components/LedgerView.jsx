import React, { useEffect, useState } from 'react';
import { ChevronLeft, Paperclip, Pencil, Printer, ReceiptText, Share2, Trash2, X } from 'lucide-react'
import { shareFile } from '../../../lib/shareImage'
import { sendWhatsAppDocument } from '../../../lib/printServer'
import { statementPdf } from '../lib/pdf'
import { WhatsAppSent } from '../../../components/WhatsAppSent'
import { useStore } from '../../../lib/store'
import VoucherBillPreview from './VoucherBillPreview'
import { photoStrip } from './BillViewer'
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { useMutation } from 'convex/react';
import { useNavigate } from 'react-router-dom';
import { rupees, shortDate, aadhaarGroups, phoneDisplay, rowType } from '../lib/format';
import { rememberPapers, rememberPartyPaper, warm } from '../../../lib/paperUrls';
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
function Goods({ bill, all = false, first = false }) {
  const waiting = goodsOn(bill).filter((i) => all || !Number(i.amount));
  if (!waiting.length) return null;
  // A delivery of a dozen lines was printing a dozen lines into one ledger
  // row, pushing the dates and the balance apart. One line says what came;
  // the count says there was more, and the bill itself is a click away on the
  // same row for anyone who needs the rest.
  const shown = first ? waiting.slice(0, 1) : waiting;
  const rest = waiting.length - shown.length;
  return (
    <div className="billgoods">
      {shown.map((i) => (
        <span key={i.id} className="good">
          {i.description}
          {Number(i.qty) ? ` ${figure(i.qty)} ${i.unit ?? ''}` : ''}
        </span>
      ))}
      {rest > 0 && <span className="good more">+{rest} more</span>}
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
const groupNameOf = (masters, id) => (masters?.ledgers ?? []).find((l) => l._id === id)?.groupName;

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
  const navigate = useNavigate();
  /**
   * Quotations given to this party. They are the shop's own bills, never
   * posted, so the books do not return them; they are listed from the bills,
   * on their dates, with no Dr or Cr and no effect on the balance.
   */
  const quotes = bills.filter((b) => b.kind === 'quotation' && b.ledgerId === ledgerId);

  // Bill-backed vouchers are redirected inside VoucherEditor, so every edit
  // button here can stay a plain setEditing.
  function openEdit(p) { setEditing(p._id); }
  const [deleting, setDeleting] = useState(null);
  const [editParty, setEditParty] = useState(false);
  const removeVoucher = useMutation(api.vouchers.remove);
  const dropSettlement = useMutation(api.vouchers.dropSettlement);
  // The money line of a sale or purchase paid on the spot: its X takes out
  // only that money, leaving the bill on credit.
  const [unsettling, setUnsettling] = useState(null);
  const setCommissionPaid = useMutation(api.vouchers.setCommissionPaid);
  // Deleting the account itself, from its own page — the same rule as Account
  // Masters: only an empty account, behind the shop's code, and the bin's hold
  // on it asked about separately.
  const removeLedger = useMutation(api.masters.removeLedger);
  const [deletingParty, setDeletingParty] = useState(false);
  const [purgingParty, setPurgingParty] = useState(null);
  const data = useLive(api.reports.ledger, { ledgerId }, `ledger:${ledgerId}`);
  /**
   * The statement as a PDF, with a page for every bill photo, sent on
   * WhatsApp from the shop's number (the shop PC sends it) — to the shop's
   * own group or into the customer's chat, as chosen in the box the button
   * opens. "Another way" is the phone's share sheet, or Downloads; it is also
   * where a send falls to when the shop PC cannot be reached.
   *
   * `sharing`: '' at rest, 'photos n of m' and 'busy' while it goes, then
   * 'sent' or 'saved' for a moment.
   */
  const [sharing, setSharing] = useState('');
  const [choosing, setChoosing] = useState(false);
  const settle = (state) => { setSharing(state); setTimeout(() => setSharing(''), 4000); };
  const photoCount = [...(data?.rows ?? []), ...(data?.pending ?? [])]
    .reduce((n, r) => n + (r.attachmentUrls?.length ?? 0), 0);
  async function sharePdf(target) {
    setChoosing(false);
    setSharing('busy');
    let pdf;
    try {
      pdf = await statementPdf(data, { onPhoto: (done, of) => setSharing(`photos ${done} of ${of}`) });
      setSharing('busy');
    } catch (err) {
      setSharing('');
      return window.alert(`Could not make the PDF: ${err?.message ?? err}`);
    }
    const to = target === 'group' ? 'group' : target === 'customer' ? String(data?.account?.phone ?? '').trim() : '';
    if (to) {
      try {
        await sendWhatsAppDocument(to, pdf.blob, pdf.name);
        return settle(target === 'group' ? 'sent to group' : 'sent');
      } catch (err) {
        // Only an unreachable shop PC falls through to sharing by hand; a
        // refusal (not on WhatsApp, link logged out) is said as it is.
        const unreachable = err instanceof TypeError || /Cannot find Shiv Print Server/.test(String(err?.message));
        if (!unreachable) {
          setSharing('');
          return window.alert(`Not sent on WhatsApp: ${err?.message ?? err}`);
        }
      }
    }
    try {
      const how = await shareFile(pdf.blob, pdf.name, 'application/pdf');
      return how === 'saved' ? settle('saved') : setSharing('');
    } catch (err) {
      setSharing('');
      window.alert(`Could not share the PDF: ${err?.message ?? err}`);
    }
  }
  // Its bills' photos: their addresses kept for the bill screen, and the
  // newest downloading in the background, so a bill opens with its photo at once.
  useEffect(() => {
    const lines = [...(data?.rows ?? []), ...(data?.pending ?? [])].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
    const papers = lines.flatMap((line) => line.attachmentUrls ?? []);
    rememberPapers(papers);
    warm(papers);
    // The newest bill (not a receipt or payment slip), for a receipt opened
    // from here: docked at once, with nothing to ask the books.
    if (!data) return;
    const MONEY = new Set(['Receipt', 'Payment', 'Refund', 'Contra', 'Journal']);
    const bill = lines.find((line) => !MONEY.has(line.vchType) && (line.attachmentUrls ?? []).some((a) => a.kind !== 'receipt'));
    rememberPartyPaper(ledgerId, bill ? {
      vchLabel: bill.vchLabel, date: bill.date, initialIndex: 0,
      attachmentUrls: bill.attachmentUrls.filter((a) => a.kind !== 'receipt'),
    } : null);
  }, [data, ledgerId]);
  const papers = useLive(api.review.papersFor, { ledgerId }, `papers:${ledgerId}`) ?? [];
  // Where this party's paper physically is. The books answer what is owed; only
  // this answers "Raj Kumar ka bill dikhao" with a drawer to open.
  const paper = useLive(api.filing.whereIs, { partyLedgerId: ledgerId }, `filing:${ledgerId}`);

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
  /**
   * Commission is only somebody's business on an account that names the
   * carpenter who brings this customer in. Everywhere else the column does not
   * exist — most accounts owe nobody a cut, and a ledger of empty ticks is a
   * column asking a question nobody has.
   */
  const commissionTo = account?.commissionTo ?? '';
  const showComm = Boolean(commissionTo);
  const commOwed = showComm
    ? rows.filter((r) => r.vchType === 'Sale' && !r.commissionPaid).length
    : 0;
  const totals = data?.totals ?? { debit: 0, credit: 0 };
  /**
   * The books on this PC: bills saved here and still being sent
   * (src/lib/postOutbox.ts) are shown at once, on their dates, and counted in
   * the closing balance — Save no longer waits for the books, so neither does
   * this page. Each one leaves as soon as the books' own row for it arrives.
   */
  // Posted or awaiting an amount, either way the books have it.
  const booked = [...rows, ...(data?.pending ?? [])];
  const inBooks = new Set(booked.map((r) => String(r.refNo ?? '')).filter(Boolean));
  const inBooksIds = new Set(booked.map((r) => String(r.voucherId ?? r._id ?? '')));
  const posting = bills
    .filter((b) => b.pendingPost && b.ledgerId === ledgerId && b.kind !== 'quotation' && b.kind !== 'grn')
    .filter((b) => !(b.voucherId && inBooksIds.has(String(b.voucherId))) && !inBooks.has(`BILL-${b.number}`))
    .map((b) => {
      const kind = b.kind ?? 'sale';
      const amt = Number(b.total) || 0;
      const paid = Number(b.paidAmount ?? (b.paid ? amt : 0)) || 0;
      const supplierSide = groupNameOf(masters, ledgerId) === 'Sundry Creditors';
      const [dr, cr] =
        kind === 'sale' ? [amt, paid]
        : kind === 'purchase' ? [paid, amt]
        : kind === 'receipt' ? [0, amt]
        : kind === 'payment' || kind === 'refund' ? [amt, 0]
        : kind === 'return' ? (supplierSide ? [amt, 0] : [0, amt])
        : [0, 0];
      return { b, dr, cr, label: { sale: 'Sale', purchase: 'Purchase', receipt: 'Receipt', payment: 'Payment', refund: 'Refund', return: 'Goods Return' }[kind] ?? 'Bill' };
    });
  // The closing balance with them in: Dr counted up, Cr down.
  const signedClosing = (data?.closingSide === 'Cr' ? -1 : 1) * (Number(data?.closing) || 0)
    + posting.reduce((t, x) => t + x.dr - x.cr, 0);
  const shownClosing = Math.abs(signedClosing);
  const shownSide = signedClosing > 0.005 ? 'Dr' : signedClosing < -0.005 ? 'Cr' : (data?.closingSide ?? 'Cr');
  const pending = data?.pending ?? [];
  const received = data?.received ?? [];
  // Deliveries first, then what is posted, then what is still waiting for a
  // figure. Only ever compared against each other, so the numbers are ranks.
  const SAME_DAY = { received: 0, entry: 1, posting: 1, pending: 2, quote: 3 };
  // Unpriced bills belong on their own dates, among the entries, not heaped at
  // the top. They carry no amount and no balance, so interleaving them is
  // presentation only — the running balance is worked out on the server and is
  // untouched by where they sit.
  const stream = [
    ...rows.map((r, i) => ({ kind: 'entry', key: `${r.voucherId}-${i}`, date: r.date, r })),
    ...pending.map((p) => ({ kind: 'pending', key: p._id, date: p.date, p })),
    // Deliveries sit on their dates like unpriced bills: no amount, no balance.
    ...received.map((g) => ({ kind: 'received', key: g._id, date: g.date, g })),
    // Quotations too: a price given, shown for the record, never a balance.
    ...quotes.map((q) => ({ kind: 'quote', key: q.id, date: Date.parse(q.date) || 0, q })),
    // Saved on this PC a moment ago and still on its way to the books.
    ...posting.map((pb) => ({ kind: 'posting', key: `posting-${pb.b.id}`, date: Date.parse(pb.b.date) || 0, pb })),
  ]
    /**
     * Same day: the goods move, then the bill for them.
     *
     * A delivery was sorting under the purchase that billed it, so BILL-59
     * arrived beneath the PUR-0106 that says "billed in" it — the paperwork
     * read backwards against the day it describes. Deliveries now sit first,
     * which is the server's own rule for a day (see SAME_DAY_ORDER in
     * reports.ts: the goods move, then any adjustment, then the money) and
     * puts a delivery above its bill without having to pair the two.
     *
     * Unpriced bills keep their place after the posted ones.
     */
    .sort((a, b) => a.date - b.date || SAME_DAY[a.kind] - SAME_DAY[b.kind]);

  /**
   * A row's photos open as part of every photo on this account, oldest to
   * newest as the rows are shown, so the arrows go on to the next bill.
   */
  const showPhotos = (key) => onViewBill(photoStrip(stream.map((item) => {
    const row = item.r ?? item.p ?? item.g;
    if (row) return { key: item.key, vchLabel: row.vchLabel, vchType: row.vchType ? rowType(row) : row.vchType, date: row.date, amount: row.amount ?? null, refNo: row.refNo, attachmentUrls: row.attachmentUrls };
    if (item.q) return { key: item.key, vchType: 'Quotation', vchLabel: item.q.number, date: item.date, amount: item.q.total ?? null, attachmentUrls: item.q.attachments };
    return { key: item.key, attachmentUrls: [] };
  }), key, account?.name));
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
          {(paper?.folder || paper?.card) && (
            <div className="ref">
              {[
                paper.folder &&
                  `Folder ${paper.folder.cabinet} / ${paper.folder.drawer} / ${paper.folder.no}`,
                // Mid-sort, the bundle is still on a table rather than in its
                // folder — so say which card, because that is where it is today.
                paper.card && `on card ${paper.card}`,
                paper.bills && `${paper.bills} bills`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
          {account?.notes && <div className="note inline">{account.notes}</div>}
        </div>
        <div className="partyhead-figure">
          <div className="card-name">Closing</div>
          <div className="card-amt">
            {rupees(shownClosing)} <span className="side">{shownSide}</span>
          </div>
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
          <div className="partyhead-tools">
            <button
              className="btn ghost"
              onClick={() => onPrint({ scope: 'party', ledgerId })}
            >
              <Printer size={16} aria-hidden="true" /> Print
            </button>
            <button
              className="btn ghost"
              onClick={() => setChoosing(true)}
              disabled={sharing === 'busy' || sharing.startsWith('photos')}
              title="Send this statement, with its bill photos, as a PDF on WhatsApp"
            >
              <Share2 size={16} aria-hidden="true" />
              {sharing.startsWith('photos') ? `Adding ${sharing}…`
                : sharing === 'busy' ? (account?.phone ? 'Sending…' : 'Making PDF…')
                : sharing === 'sent' ? 'Sent on WhatsApp'
                : sharing === 'sent to group' ? 'Sent to the group'
                : sharing === 'saved' ? 'Saved to Downloads'
                : 'WhatsApp PDF'}
            </button>
            {rows.length || pending.length ? (
              <button
                type="button"
                disabled
                className="btn ghost del"
                title={`${rows.length + pending.length} vouchers are posted to this account — it cannot be deleted`}
                aria-disabled="true"
              >
                <Trash2 size={14} aria-hidden="true" /> Delete
              </button>
            ) : (
              <button className="btn ghost del" onClick={() => setDeletingParty(true)} aria-label="Delete account">
                <Trash2 size={14} aria-hidden="true" /> Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {choosing && account && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setChoosing(false)}>
          <div className="modal narrow sendto" role="dialog" aria-label="Send the statement to">
            <h2>Send to</h2>
            <p className="note">
              Statement of {account.name}
              {photoCount ? ` with ${photoCount} bill ${photoCount === 1 ? 'photo' : 'photos'}` : ''}, as a PDF.
            </p>
            <div className="sendto-choices">
              <button type="button" className="btn" onClick={() => sharePdf('group')}>
                Shiv Hardware group
              </button>
              {account.phone && (
                <button type="button" className="btn" onClick={() => sharePdf('customer')}>
                  {account.name} · {phoneDisplay(account.phone)}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={() => sharePdf('other')}>
                Another way
              </button>
              <button type="button" className="btn ghost" onClick={() => setChoosing(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
          {showComm && ` · ${commOwed} owing ${commissionTo} commission`}
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
                <button type="button" className="shotbtn" aria-label="Preview statement" onClick={() => onViewBill({
                  party: account?.name, vchLabel: 'Statement', date: paper.to || paper.at,
                  attachmentUrls: paper.pages,
                })}>
                  <img src={paper.pages[0].url} alt="" loading="lazy" />
                </button>
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
                {showComm && <th className="w-comm" title={`Commission to ${commissionTo}`}>Comm</th>}
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
                {showComm && <td className="w-comm" />}
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
                        <Goods bill={billFor(item.g)} all first />
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
                    {showComm && <td className="w-comm" />}
                    <td className="w-clip" data-label="">
                      {item.g.attachmentUrls.length > 0 && (
                        <button
                          className="clip"
                          onClick={() => showPhotos(item.key)}
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
                ) : item.kind === 'posting' ? (
                  <tr className="posting" key={item.key}>
                    <td className="mono" data-label="Date">{shortDate(item.date)}</td>
                    <td className="mono entryno" data-label="Vch">BILL-{item.pb.b.number}</td>
                    <td className="vchtype" data-label="Type">{item.pb.label}</td>
                    <td className="ref mono" data-label="Ref">{item.pb.b.ref || '—'}</td>
                    <td className="particulars" data-label="Particulars">
                      <Goods bill={item.pb.b} all first />
                      <div className="ref">Posting to the books…</div>
                    </td>
                    <td className="num" data-label="Debit">{item.pb.dr ? rupees(item.pb.dr) : ''}</td>
                    <td className="num" data-label="Credit">{item.pb.cr ? rupees(item.pb.cr) : ''}</td>
                    <td className="num" data-label="Balance" />
                    {showComm && <td className="w-comm" />}
                    <td className="w-clip" data-label="" />
                    <td className="rowacts" data-label="">
                      <button className="xbtn" onClick={() => navigate(`/bills/${item.pb.b.id}`)} aria-label="Edit">
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ) : item.kind === 'quote' ? (
                  <tr className="quote" key={item.key}>
                    <td className="mono" data-label="Date">{shortDate(item.date)}</td>
                    <td className="mono entryno" data-label="Vch">QTN-{String(item.q.number).replace(/^Q-/, '')}</td>
                    <td className="vchtype" data-label="Type">Quotation</td>
                    <td className="ref mono" data-label="Ref">{item.q.ref || '—'}</td>
                    <td className="particulars" data-label="Particulars">
                      <Goods bill={item.q} all first />
                      <div className="ref">₹{rupees(item.q.total)} quoted · not in the balance</div>
                    </td>
                    <td className="num" data-label="Debit" />
                    <td className="num" data-label="Quotation">
                      <button className="btn small" onClick={() => navigate(`/bills/${item.q.id}?convert=sale`)}>
                        Convert to sale
                      </button>
                    </td>
                    <td className="num" data-label="Balance" />
                    {showComm && <td className="w-comm" />}
                    <td className="w-clip" data-label="">
                      <button
                        className="clip"
                        onClick={() => setPreviewing(item.q)}
                        aria-label="Show the quotation"
                        title="Show the quotation"
                      >
                        <ReceiptText size={13} aria-hidden="true" />
                      </button>
                      {!!item.q.attachments?.length && <button type="button" className="clip" aria-label="Preview quotation photos"
                        onClick={() => showPhotos(item.key)}>
                        <Paperclip size={13} aria-hidden="true" />
                      </button>}
                    </td>
                    <td className="rowacts" data-label="">
                      <button className="xbtn" onClick={() => navigate(`/bills/${item.q.id}`)} aria-label="Edit">
                        <Pencil size={14} aria-hidden="true" />
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
                    {showComm && <td className="w-comm" />}
                    <td className="w-clip" data-label="">
                      {item.p.attachmentUrls.length > 0 && (
                        <button
                          className="clip"
                          onClick={() => showPhotos(item.key)}
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
                    <td className="mono entryno" data-label="Vch">{item.r.vchLabel}{item.r.whatsappAt && <WhatsAppSent at={item.r.whatsappAt} />}</td>
                    <td className="vchtype" data-label="Type">{rowType(item.r)}</td>
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
                    {showComm && (
                      <td className="w-comm" data-label="Comm">
                        {/* Only a sale earns anybody a commission. A receipt
                            against it is the customer paying the shop, which
                            is a different matter entirely. */}
                        {item.r.vchType === 'Sale' ? (
                          <input
                            type="checkbox"
                            className="commtick"
                            checked={item.r.commissionPaid}
                            aria-label={`Commission to ${commissionTo} paid on ${item.r.vchLabel}`}
                            title={item.r.commissionPaid ? `Paid to ${commissionTo}` : `Not yet paid to ${commissionTo}`}
                            onChange={(e) =>
                              setCommissionPaid({ id: item.r.voucherId, paid: e.target.checked })
                            }
                          />
                        ) : null}
                      </td>
                    )}
                    <td className="w-clip" data-label="">
                      {item.r.attachmentUrls.length > 0 && (
                        <button
                          className="clip"
                          onClick={() => showPhotos(item.key)}
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
                      {item.r.settlement ? (
                        <button
                          className="xbtn del"
                          onClick={() => setUnsettling(item.r)}
                          aria-label="Remove receipt"
                          title="Remove only this money — the bill stays, on credit"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        <button className="xbtn del" onClick={() => setDeleting(item.r)} aria-label="Delete">
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
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
                  {rupees(shownClosing)}{' '}
                  <span className="side">{shownSide}</span>
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
          body={`${account?.name} · ${shortDate(deleting.date)}. ${
            billFor(deleting) ? `Bill ${billFor(deleting).number} goes with it. Both move` : 'It moves'
          } to Trash, where it can be restored.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => removeVoucher({ id: deleting.voucherId ?? deleting._id })}
          onClose={() => setDeleting(null)}
        />
      )}

      {unsettling && (
        <Confirm
          title={`Remove the ${rupees(unsettling.amount)} received on ${unsettling.vchLabel}?`}
          body={`${account?.name} · ${shortDate(unsettling.date)}. Only the money comes off — the ${unsettling.vchType === 'Purchase' ? 'purchase' : 'sale'} stays, on credit.`}
          confirmLabel="Remove receipt"
          danger
          onConfirm={() => dropSettlement({ id: unsettling.voucherId })}
          onClose={() => setUnsettling(null)}
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
