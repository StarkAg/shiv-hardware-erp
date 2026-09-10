import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, inputDate, fromInputDate } from '../lib/format';
import { bestMatch, similarity, clean, isOwnShop } from '../lib/match';
import Teach from './Teach';
import Combo from './Combo';
import Confirm from './Confirm';
import BillTags from './BillTags';
import TagSettings from './TagSettings';
import AutoTag from './AutoTag';
import { orderTags, labelled } from '../lib/tags';

/**
 * The slip at full size, from the review card.
 *
 * The card shows a cropped thumbnail so that three of them fit across the
 * screen, and no figure should be approved off a crop. This is the whole
 * sheet, as large as the window allows, with the arrow keys walking a bill
 * that runs to several. Zooming is left to the browser — the photo links to
 * itself, and the browser's own viewer pinches and pans better than anything
 * reimplemented here.
 */
function Enlarged({ pages, at, setAt, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setAt((i) => Math.min(i + 1, pages.length - 1));
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pages.length, onClose, setAt]);

  const shown = pages[Math.min(at, pages.length - 1)];

  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lightbox-inner rev-big">
        <div className="stage">
          {shown?.url && (
            <a href={shown.url} target="_blank" rel="noreferrer">
              <img src={shown.url} alt="" draggable="false" />
            </a>
          )}
        </div>
        <div className="rev-big-bar">
          {pages.length > 1 && (
            <>
              <button className="btn ghost" disabled={at === 0} onClick={() => setAt(at - 1)}>
                ‹
              </button>
              <span>
                {Math.min(at, pages.length - 1) + 1} / {pages.length}
              </span>
              <button
                className="btn ghost"
                disabled={at >= pages.length - 1}
                onClick={() => setAt(at + 1)}
              >
                ›
              </button>
            </>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Everything the reader made of one slip, as one string to search.
 *
 * The item lines are the point. They are folded away behind "14 lines read"
 * and they are where the goods are named, so "telescopic channel" or "polyfix"
 * finds nothing at all unless they are in here. Numbers go in stripped of
 * their commas as well as with them, so 52,452 and 52452 both find the bill.
 */
function haystack(item, accountName) {
  const d = item.draft ?? {};
  const parts = [
    d.party, d.place, d.refNo, d.notes, d.marks, d.kind, d.settlement, d.paidBy,
    d.date, d.total, d.paid, d.goodsReturn, d.carriedForward,
    accountName, item.doubtNote, item.error, item.status,
    ...(Array.isArray(d.items)
      ? d.items.flatMap((line) => [line?.desc, line?.qty, line?.rate, line?.amount])
      : []),
  ];
  const text = parts.filter((x) => x != null && x !== '').join(' \u00b7 ');
  return `${text} ${text.replace(/,/g, '')}`.toLowerCase();
}

/** Every term has to be in there somewhere; order and case do not matter. */
function matches(hay, terms) {
  return terms.every((t) => hay.includes(t));
}

const KINDS = [
  ['sale', 'Sale'],
  ['receipt', 'Receipt'],
  ['purchase', 'Purchase'],
  ['payment', 'Payment'],
];

/** Which fields the reviewer changed, so the reader can be told about it. */
function diff(draft, form, partyName) {
  const out = [];
  if (draft?.party && partyName && draft.party.trim() !== partyName)
    out.push({ field: 'party', wrong: draft.party.trim(), right: partyName });
  if (draft?.total != null && Number(form.amount) && Number(draft.total) !== Number(form.amount))
    out.push({ field: 'total', wrong: String(draft.total), right: String(form.amount) });
  if (draft?.kind && draft.kind !== form.kind)
    out.push({ field: 'kind', wrong: draft.kind, right: form.kind });
  if ((draft?.refNo ?? '') !== (form.refNo ?? '') && (draft?.refNo || form.refNo))
    out.push({ field: 'refNo', wrong: draft?.refNo ?? '', right: form.refNo ?? '' });
  return out;
}

/**
 * A draft as form values.
 *
 * `date` stays empty when the slip's date cannot be parsed. Quietly standing in
 * today's date is worse than an empty box: it looks filled in, and it dates the
 * voucher to whenever somebody happened to review it.
 */
function formFrom(draft) {
  const parsed = draft?.date ? Date.parse(`${draft.date}T00:00:00Z`) : NaN;
  return {
    kind: draft?.kind && draft.kind !== 'unclear' ? draft.kind : 'sale',
    date: Number.isNaN(parsed) ? '' : inputDate(parsed),
    amount: draft?.total != null ? String(draft.total) : '',
    goodsReturn: draft?.goodsReturn != null ? String(draft.goodsReturn) : '',
    // What was handed over. A PAID stamp with no figure means the lot.
    paidNow:
      draft?.paid != null
        ? String(draft.paid)
        : draft?.settlement === 'settled' && draft?.total != null
          ? String(draft.total)
          : '',
    refNo: draft?.refNo ?? '',
    // Left empty on purpose. The reader's description of the goods is worth
    // reading while checking the slip, but it is not a narration — it goes in
    // the box only if somebody types it there.
    narration: '',
    // The reader says so in its notes when a paper is somebody's ledger rather
    // than a transaction — believing it saves the reviewer from reading the
    // whole slip to work out why none of the figures make a voucher.
    docKind: /statement|ledger account|not a transaction/i.test(draft?.notes ?? '')
      ? 'statement'
      : /estimate/i.test(draft?.notes ?? '') || /estimate/i.test(draft?.marks ?? '')
        ? 'estimate'
        : draft?.kind === 'receipt' || draft?.kind === 'payment'
          ? 'receipt'
          : 'bill',
  };
}

function Card({ item, ledgers, groups, picked, onPick, onDone, twins, tagNames }) {
  const approve = useMutation(api.review.approve);
  const discard = useMutation(api.review.discard);
  const dropDuplicate = useMutation(api.review.dropDuplicate);
  const fileStatement = useMutation(api.review.fileStatement);
  const createLedger = useMutation(api.masters.createLedger);
  const markDoubt = useMutation(api.review.markDoubt);
  const clearDoubt = useMutation(api.review.clearDoubt);
  const reread = useAction(api.ai.read);

  const draft = item.draft;
  const readName = clean(draft?.party);
  const isUs = isOwnShop(readName);

  // A slip with no name at all, which is a counter sale rather than a mistake:
  // written on a blank leaf, paid on the spot, nobody's account. It can be
  // approved without picking anybody, and files to the walk-in account.
  //
  // A continuation sheet has no name either and is emphatically not this — it
  // is the second page of somebody's bill and belongs joined to the first, so
  // it keeps having to be given an account.
  const noName =
    !draft?.isContinuation && (!readName || /^<?\s*unknown\s*>?$/i.test(readName));
  const parties = useMemo(
    () =>
      ledgers.filter(
        (l) => l.groupName === 'Sundry Debtors' || l.groupName === 'Sundry Creditors'
      ),
    [ledgers]
  );

  // --- state first, so everything derived below can lean on it ---
  const [form, setForm] = useState(() => ({
    partyLedgerId: '',
    intoId: '',
    ...formFrom(draft),
  }));
  const [partyType, setPartyType] = useState(null);   // null = follow the kind
  const [newName, setNewName] = useState(null);       // null = the button is closed
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dropping, setDropping] = useState(false);
  const [big, setBig] = useState(false);

  // A purchase is normally a supplier and a sale a customer, but the chip wins
  // once it has been touched — plenty of names sit on both sides of the book.
  const sideOfBook =
    partyType ??
    (form.kind === 'purchase' || form.kind === 'payment'
      ? 'Sundry Creditors'
      : 'Sundry Debtors');

  const onThisSide = useMemo(
    () => parties.filter((l) => l.groupName === sideOfBook),
    [parties, sideOfBook]
  );

  // The reader returns the name as written on the slip; this finds the shop's
  // account for it, allowing for a hand that turns Nilesh into Nitesh. Matched
  // within the side of the book on show, so the account it picks is one of the
  // accounts actually listed.
  const match = useMemo(
    // Nothing to match a nameless slip against — and "UNKNOWN" is close enough
    // to a real name to score against one, which would quietly fill in an
    // account for a bill that names nobody.
    () => (readName && !noName ? bestMatch(readName, onThisSide) : null),
    [draft, onThisSide, noName]
  );
  const guess = match?.ledger?._id ?? '';

  /**
   * Listed by name, so near-identical names sit together and can be told apart
   * — three spellings of Nilesh Store are only confusing when they are
   * scattered down the list by score. The likeliest match is still selected for
   * you and still carries its percentage; the ordering is for reading.
   */
  const ranked = useMemo(
    () =>
      onThisSide
        .map((p) => ({
          ...p,
          score: readName && !isUs ? similarity(readName, p.name) : 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    [readName, isUs, onThisSide]
  );

  // Only cash and bank — read from the books, so it stays right when they change.
  const moneyAccounts = useMemo(
    () =>
      ledgers.filter(
        (l) => l.groupName === 'Cash-in-Hand' || l.groupName === 'Bank Accounts'
      ),
    [ledgers]
  );

  // The queue answers from cache first, so a card can mount before its draft
  // has arrived — and a state initialiser only ever runs once. Without this the
  // fields keep the empty values they were born with while the read sits right
  // there on screen.
  const applied = useRef(null);
  useEffect(() => {
    if (!draft) return;
    const stamp = JSON.stringify([
      draft.kind, draft.party, draft.date, draft.total, draft.refNo, draft.notes,
    ]);
    if (applied.current === stamp) return;
    applied.current = stamp;
    setForm((f) => ({ ...f, ...formFrom(draft) }));
  }, [draft]);

  useEffect(() => {
    if (guess) setForm((f) => (f.partyLedgerId ? f : { ...f, partyLedgerId: guess }));
  }, [guess]);

  useEffect(() => {
    const cash = moneyAccounts.find((l) => l.groupName === 'Cash-in-Hand') ?? moneyAccounts[0];
    if (cash) setForm((f) => (f.intoId ? f : { ...f, intoId: cash._id }));
  }, [moneyAccounts]);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    // A statement is not a voucher and does not go down the voucher road at
    // all: it is filed against the account, and nothing is posted.
    if (form.docKind === 'statement') {
      if (!form.partyLedgerId) return setError('Pick the account this statement is of');
      setBusy(true);
      setError('');
      try {
        await fileStatement({
          readingId: item._id,
          ledgerId: form.partyLedgerId,
          to: form.date ? fromInputDate(form.date) : undefined,
          closing: form.amount === '' ? undefined : Number(form.amount),
          note: form.narration || undefined,
        });
        onDone?.();
      } catch (err) {
        setError(err.message ?? String(err));
        setBusy(false);
      }
      return;
    }

    if (!form.partyLedgerId && !noName) return setError('Pick the account this belongs to');
    if (!form.date) return setError('Put the date from the slip in');
    if (billAmount < 0) return setError('The goods return is larger than the bill');

    // A sale booked against a supplier makes them a debtor, and then the bills
    // and the payments both push the balance the same way.
    const chosen = parties.find((p) => p._id === form.partyLedgerId);
    const wantsCreditor = form.kind === 'purchase' || form.kind === 'payment';
    if (chosen && wantsCreditor !== (chosen.groupName === 'Sundry Creditors')) {
      return setError(
        chosen.groupName === 'Sundry Creditors'
          ? `${chosen.name} is a supplier — this should be a purchase or a payment, not a ${form.kind}.`
          : `${chosen.name} is a customer — this should be a sale or a receipt, not a ${form.kind}.`
      );
    }
    const amount = form.amount === '' ? undefined : billAmount;
    if ((form.kind === 'receipt' || form.kind === 'payment') && !(amount > 0))
      return setError('A receipt or payment needs an amount');
    setBusy(true);
    setError('');
    try {
      const party = parties.find((p) => p._id === form.partyLedgerId);
      const into = moneyAccounts.find((l) => l._id === form.intoId);
      await approve({
        readingId: item._id,
        kind: form.kind,
        partyLedgerId: form.partyLedgerId || undefined,
        walkIn: form.partyLedgerId ? undefined : true,
        date: fromInputDate(form.date),
        amount,
        refNo: form.refNo || undefined,
        narration: form.narration || undefined,
        paidNow: paidAmount > 0 ? paidAmount : undefined,
        goodsReturn: Number(form.goodsReturn) || undefined,
        documentKind: form.docKind,
        moneyLedgerId: into?._id,
        corrections: diff(draft, form, party?.name),
      });
      onDone?.();
    } catch (err) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
  };

  // Says out loud what approving will do to the account, before it does it.
  // Returned stock never reached the customer, so it comes off the bill before
  // anything is posted — the account is owed the net, not the gross.
  const gross = Number(form.amount) || 0;
  const returned = Number(form.goodsReturn) || 0;
  const billAmount = Math.round((gross - returned) * 100) / 100;
  const paidAmount = Number(form.paidNow) || 0;
  const owing = Math.round((billAmount - paidAmount) * 100) / 100;

  const returnBit = returned > 0 ? `${rupees(gross)} less ${rupees(returned)} returned = ` : '';
  const owingLine =
    gross === 0
      ? 'No amount on this bill — it files unpriced.'
      : billAmount < 0
        ? `The return is bigger than the bill — check the figures.`
        : paidAmount === 0
          ? `${returnBit}${rupees(billAmount)} on the bill, nothing paid — all of it stays on the account.`
          : owing > 0.005
            ? `${returnBit}${rupees(billAmount)} on the bill, paid ${rupees(paidAmount)} — ${rupees(owing)} stays owing.`
            : owing < -0.005
              ? `${returnBit}${rupees(billAmount)} on the bill, paid ${rupees(paidAmount)} — ${rupees(-owing)} more than owed.`
              : `${returnBit}${rupees(billAmount)} on the bill, paid in full — nothing left owing.`;

  const pages = item.pages ?? [];
  const shown = pages[Math.min(page, pages.length - 1)];

  return (
    <div className="rev-card">
      <div className="rev-shot">
        {/* Two sheets of one bill are easy to shoot separately; this marries
            them back up without going near the phone again. */}
        <label className="joinpick">
          <input
            type="checkbox"
            checked={picked}
            onChange={(e) => onPick(item._id, e.target.checked)}
          />
          same bill as…
        </label>
        {shown?.url ? (
          <button className="shotbtn" onClick={() => setBig(true)} title="Enlarge">
            <img src={shown.url} alt="" />
          </button>
        ) : (
          <div className="empty">photo gone</div>
        )}
        <div className="rev-shot-acts">
          {pages.length > 1 && (
            <div className="rev-pages">
              <button className="link" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              <span className="count">
                {Math.min(page, pages.length - 1) + 1} / {pages.length}
              </span>
              <button
                className="link"
                disabled={page >= pages.length - 1}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
            </div>
          )}
          {shown?.url && (
            <button className="btn ghost small" onClick={() => setBig(true)}>
              Enlarge
            </button>
          )}
        </div>
      </div>

      <div className="rev-form">
        {item.status === 'reading' && <div className="note">Reading it…</div>}
        {item.status === 'failed' && (
          <div className="rev-failed">
            <p className="error">{item.error}</p>
            <button className="btn ghost" onClick={() => reread({ inboxId: item.inboxId })}>
              Try again
            </button>
          </div>
        )}

        {item.status === 'ready' && draft && (
          <>
            {/* Said at the very top, before any of the figures — the one thing
                worth knowing before you start filling this card in is that
                another card in the queue already says the same thing. */}
            {/* Why somebody set this aside. Written when the slip was doubted
                and, until now, never shown anywhere — so the Doubt stage was
                six cards with no hint of what was wrong with any of them. */}
            {item.doubtNote && (
              <div className="rev-doubtnote">
                <b>{item.status === 'doubt' ? 'Set aside:' : 'Was set aside:'}</b>{' '}
                {item.doubtNote}
              </div>
            )}

            {twins?.length > 0 && (
              <div className="rev-twin">
                <b>Another slip in the queue says exactly this</b> — same account,
                same date, same total. Two photographs of one bill do this, and
                approving both bills the account twice. Compare the pictures; if
                it is the same paper, drop this one.
              </div>
            )}

            {form.docKind === 'statement' && (
              <div className="rev-twin">
                <b>Filed as a statement</b> — nothing is posted. The bills and
                payments it lists belong in the books from your own papers, and
                entering them from here would double every one of them. The
                photograph is kept against the account, with the closing figure
                in <i>Amount</i> if it is worth keeping.
              </div>
            )}

            <div className="rev-head">
              <div className="chips">
                {KINDS.map(([id, label]) => (
                  <button
                    key={id}
                    className={`chip${form.kind === id ? ' on' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, kind: id }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="rev-headright">
                <BillTags
                  tags={item.tags}
                  inboxId={item.anchorId}
                  names={tagNames}
                  size={9}
                />
                <span className={`conf ${draft.confidence >= 0.8 ? 'ok' : 'low'}`}>
                  {Math.round((draft.confidence ?? 0) * 100)}% sure
                </span>
              </span>
            </div>

            {draft.marks ? <div className="rev-mark">mark on the slip: {draft.marks}</div> : null}

            <label>
              <span className="lblrow">
                <span>Account</span>
                <span className="chips tiny">
                  {[
                    ['Sundry Debtors', 'Customer'],
                    ['Sundry Creditors', 'Supplier'],
                  ].map(([group, label]) => (
                    <button
                      type="button"
                      key={group}
                      className={`chip${sideOfBook === group ? ' on' : ''}`}
                      onClick={() => {
                        setPartyType(group);
                        // Supplier and sale cannot both be true. Switching the
                        // side switches the voucher with it, keeping money-in
                        // as money-in.
                        setForm((f) => ({
                          ...f,
                          partyLedgerId: '',
                          kind:
                            group === 'Sundry Creditors'
                              ? f.kind === 'receipt' || f.kind === 'payment'
                                ? 'payment'
                                : 'purchase'
                              : f.kind === 'receipt' || f.kind === 'payment'
                                ? 'receipt'
                                : 'sale',
                        }));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="chip add"
                    onClick={() =>
                      setNewName(
                        newName === null
                          ? draft.party && draft.party !== '<UNKNOWN>'
                            ? draft.party
                            : ''
                          : null
                      )
                    }
                  >
                    + Add ledger
                  </button>
                </span>
              </span>
              <Combo
                options={ranked.map((p) => ({
                  id: p._id,
                  name: p.name,
                  hint: p.score >= 0.72 ? `${Math.round(p.score * 100)}% match` : p.place,
                }))}
                value={form.partyLedgerId}
                onChange={(id) => setForm((f) => ({ ...f, partyLedgerId: id }))}
                onCreate={async (name) => {
                  const wants =
                    form.kind === 'purchase' || form.kind === 'payment'
                      ? 'Sundry Creditors'
                      : 'Sundry Debtors';
                  const group = (groups ?? []).find((g) => g.name === wants);
                  if (!group) throw new Error('That group is missing from the books');
                  const id = await createLedger({
                    name,
                    groupId: group._id,
                    openingBalance: 0,
                    openingSide: wants === 'Sundry Creditors' ? 'Cr' : 'Dr',
                    openingAsOf: fromInputDate(form.date || inputDate(Date.now())),
                  });
                  setForm((f) => ({ ...f, partyLedgerId: id }));
                  return id;
                }}
                createGroup={
                  form.kind === 'purchase' || form.kind === 'payment' ? 'Suppliers' : 'Customers'
                }
                placeholder="Type or pick the account"
              />

              {newName !== null && (
                <div className="newledger">
                  <input
                    autoFocus
                    value={newName}
                    placeholder={`Name of the new ${
                      sideOfBook === 'Sundry Creditors' ? 'supplier' : 'customer'
                    }`}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setNewName(null);
                    }}
                  />
                  <div className="newledger-acts">
                    <span className="hint">
                      opens under {sideOfBook === 'Sundry Creditors' ? 'Suppliers' : 'Customers'}
                    </span>
                    <button type="button" className="link" onClick={() => setNewName(null)}>
                      cancel
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={!newName.trim()}
                      onClick={async () => {
                        const group = (groups ?? []).find((g) => g.name === sideOfBook);
                        if (!group) return setError('That group is missing from the books');
                        try {
                          const id = await createLedger({
                            name: newName.trim(),
                            groupId: group._id,
                            openingBalance: 0,
                            openingSide: sideOfBook === 'Sundry Creditors' ? 'Cr' : 'Dr',
                            openingAsOf: fromInputDate(form.date || inputDate(Date.now())),
                          });
                          setForm((f) => ({ ...f, partyLedgerId: id }));
                          setNewName(null);
                        } catch (err) {
                          setError(err.message ?? String(err));
                        }
                        return undefined;
                      }}
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}

              {isUs && (
                <span className="hint warnhint">
                  read as “{readName}” — that is this shop, not the party. On a
                  supplier’s printed slip the party is the business on the
                  letterhead; pick or add it.
                </span>
              )}

              {/* Said before the "no account matched" line below, which would
                  otherwise ask for an account this slip does not have. */}
              {noName && !form.partyLedgerId && (
                <span className="hint">
                  no name on this slip — approving files it to <b>W/B</b>, the
                  walk-in account. Paid in full, that account comes straight
                  back to nought. Pick somebody to file it to them instead.
                </span>
              )}

              {readName && !isUs && !noName && (
                <span className="hint">
                  read as “{readName}”{draft.place ? `, ${clean(draft.place)}` : ''}
                  {match
                    ? match.score < 0.95
                      ? ` — matched to ${match.ledger.name}, ${Math.round(match.score * 100)}% sure`
                      : ''
                    : ' — no account matched; picking one teaches it this name'}
                </span>
              )}
            </label>

            <div className="row">
              <label>
                Date
                <input type="date" value={form.date} onChange={set('date')} />
              </label>
              <label>
                Amount
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={set('amount')}
                  placeholder="blank files it unpriced"
                />
              </label>
              <label>
                Ref
                <input value={form.refNo} onChange={set('refNo')} />
              </label>
            </div>

            <div className="labelled">
              <span>This paper is a</span>
              <div className="chips">
                {['bill', 'estimate', 'challan', 'receipt', 'statement', 'other'].map((k) => (
                  <button
                    type="button"
                    key={k}
                    className={`chip${form.docKind === k ? ' on' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, docKind: k }))}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {draft.notes ? <div className="readnote">read: {clean(draft.notes)}</div> : null}

            <label>
              Particulars
              <textarea
                rows={2}
                value={form.narration}
                onChange={set('narration')}
                placeholder="what was bought or sold"
              />
            </label>

            {(form.kind === 'sale' || form.kind === 'purchase') && (
              <div className="paidbox">
                <div className="row">
                  <label>
                    Goods return
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={form.goodsReturn}
                      onChange={set('goodsReturn')}
                      placeholder="none"
                    />
                  </label>
                  <label>
                    Paid now
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={form.paidNow}
                      onChange={set('paidNow')}
                      placeholder="nothing paid yet"
                    />
                  </label>
                  <label>
                    {form.kind === 'sale' ? 'Money into' : 'Money out of'}
                    <Combo
                      options={moneyAccounts.map((l) => ({ id: l._id, name: l.name }))}
                      value={form.intoId}
                      onChange={(id) => setForm((f) => ({ ...f, intoId: id }))}
                      placeholder="Cash or Bank"
                    />
                  </label>
                </div>
                <div className={`owing${owing > 0.005 ? ' due' : ''}`}>{owingLine}</div>
              </div>
            )}

            {draft.items?.length > 0 && (
              <details className="rev-items">
                <summary>{draft.items.length} lines read</summary>
                <table className="ledger">
                  <tbody>
                    {draft.items.map((it, i) => (
                      <tr key={i}>
                        <td>{it.desc}</td>
                        <td className="ref">{it.qty}</td>
                        <td className="num">{it.amount == null ? '—' : rupees(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {error && <p className="error">{error}</p>}

            <div className="modal-actions">
              {item.status === 'doubt' ? (
                <button
                  className="btn ghost"
                  onClick={() => clearDoubt({ readingId: item._id })}
                  disabled={busy}
                >
                  Back to the pile
                </button>
              ) : (
                <button
                  className="btn ghost"
                  onClick={() => markDoubt({ readingId: item._id })}
                  disabled={busy}
                  title="Set aside — nothing is posted"
                >
                  Doubt
                </button>
              )}
              {/* Offered only where there is something it could be a duplicate
                  of. A button that destroys a photograph has no business
                  sitting on every card in the pile. */}
              {twins?.length > 0 && (
                <button
                  className="btn ghost danger"
                  onClick={() => setDropping(true)}
                  disabled={busy}
                >
                  Duplicate
                </button>
              )}
              <button
                className="btn ghost"
                onClick={() => discard({ readingId: item._id })}
                disabled={busy}
              >
                Skip
              </button>
              <button className="btn" onClick={save} disabled={busy}>
                {busy
                  ? 'Posting…'
                  : form.docKind === 'statement'
                    ? 'File the statement'
                    : paidAmount > 0 && owing <= 0.005
                      ? 'Approve & settle'
                      : paidAmount > 0
                        ? 'Approve & part-pay'
                        : 'Approve'}
              </button>
            </div>
          </>
        )}
      </div>

      {big && (
        <Enlarged pages={pages} at={page} setAt={setPage} onClose={() => setBig(false)} />
      )}

      {dropping && (
        <Confirm
          danger
          title="Drop this as a duplicate?"
          body={
            `The ${pages.length === 1 ? 'photograph' : `${pages.length} photographs`} of this slip ` +
            'will be deleted for good, and the slip leaves the queue. Do this only ' +
            'when you have looked at both pictures and they are the same paper — ' +
            'the other card stays and is the one you approve. Skip is what you want ' +
            'if you are unsure: it puts this back in the pile to be read again.'
          }
          confirmLabel="Delete the photograph"
          onConfirm={() => dropDuplicate({ readingId: item._id, twinOf: twins?.[0] })}
          onClose={() => setDropping(false)}
        />
      )}
    </div>
  );
}

/**
 * The pile, one bill at a time: what the reader made of it beside the slip
 * itself. Nothing reaches the books until it is approved here.
 */
export default function Review({ masters, only }) {
  const doubting = only === 'doubt';
  const queue =
    useLive(api.review.queue, doubting ? { only: 'doubt' } : {}, `review:queue:${only ?? 'open'}`) ??
    [];
  const counts = useLive(api.review.counts, {}, 'review:counts') ?? {
    ready: 0, reading: 0, failed: 0, unread: 0,
  };
  const readPending = useAction(api.ai.readPending);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState([]);
  // Name order to work an account at a time; shot order to follow the pile as
  // it was photographed, which is how a day's slips actually happened.
  const [order, setOrder] = useState(() => {
    try {
      return localStorage.getItem('shivledger:review-order') === 'shot' ? 'shot' : 'name';
    } catch {
      return 'name';
    }
  });
  const [busyJoin, setBusyJoin] = useState(false);
  const [find, setFind] = useState('');
  const [onlyTag, setOnlyTag] = useState(null);
  const [naming, setNaming] = useState(false);
  const tags = useLive(api.tags.settings, {}, 'tags:settings') ?? {
    tagNames: [], autoTag: null,
  };
  const join = useMutation(api.review.join);
  const stop = useRef(false);

  const ledgers = masters?.ledgers ?? [];

  /**
   * The pile in name order, so every slip for one customer is reviewed in a
   * run rather than turning up eight times over an hour.
   *
   * Sorted on the account each slip was matched to, not the spelling on the
   * paper — otherwise "Nitesh Store" and "Nilesh Store" sit apart, which is
   * precisely the pair that should be adjacent. Slips matching nobody sort on
   * what was read, and the ones still being read stay at the front where they
   * can be watched.
   */
  // Asked of the deployment rather than worked out from `queue`: this screen
  // holds one bucket, and a slip's twin is quite often sitting in another.
  const twins = useLive(api.review.twins, {}, 'review:twins') ?? {};

  const parties = useMemo(
    () =>
      ledgers.filter(
        (l) => l.groupName === 'Sundry Debtors' || l.groupName === 'Sundry Creditors'
      ),
    [ledgers]
  );

  const sorted = useMemo(() => {
    if (order === 'shot') {
      return [...queue].sort((a, b) => (a.shotAt ?? a.at) - (b.shotAt ?? b.at));
    }
    const nameFor = (item) => {
      if (item.status !== 'ready') return '';
      const read = clean(item.draft?.party);
      if (!read || isOwnShop(read)) return '~';    // unnamed, or us: to the end
      return bestMatch(read, parties)?.ledger.name ?? read;
    };
    return [...queue]
      .map((item) => ({ item, key: nameFor(item) }))
      .sort(
        (a, b) =>
          a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }) ||
          b.item.at - a.item.at
      )
      .map((r) => r.item);
  }, [queue, parties, order]);

  /**
   * The pile narrowed to what was typed.
   *
   * Searched over what the reader detected rather than over the account it was
   * matched to — a slip whose party was misread is exactly the one you go
   * looking for by the goods on it, and the account name is in the haystack
   * too so both ways work.
   */
  // Commas come off what was typed as well as off the bills, or a figure
  // copied from the screen as 52,452 finds the bill that holds 52452 nowhere.
  // Only the marks actually on something. A filter offering a colour that
  // matches nothing is a filter that wastes a click to tell you so.
  const marksInPile = useMemo(() => {
    const count = new Map();
    for (const item of queue) {
      for (const id of item.tags ?? []) count.set(id, (count.get(id) ?? 0) + 1);
    }
    return labelled(tags.tagNames)
      .filter((t) => count.has(t.id))
      .map((t) => ({ ...t, count: count.get(t.id) }));
  }, [queue, tags.tagNames]);

  const terms = useMemo(
    () => find.toLowerCase().replace(/,/g, '').split(/\s+/).filter(Boolean),
    [find]
  );
  const shown = useMemo(() => {
    const marked = onlyTag
      ? sorted.filter((item) => (item.tags ?? []).includes(onlyTag))
      : sorted;
    if (terms.length === 0) return marked;
    return marked.filter((item) => {
      const read = clean(item.draft?.party);
      const account = read && !isOwnShop(read) ? bestMatch(read, parties)?.ledger.name : '';
      return matches(haystack(item, account), terms);
    });
  }, [sorted, terms, parties, onlyTag]);

  // Chunk after chunk until there is nothing left, so the length of the pile
  // stops mattering. Whatever has been read is already saved if it is stopped.
  const readAll = async () => {
    setRunning(true);
    setError('');
    setDone(0);
    stop.current = false;
    let read = 0;
    try {
      for (;;) {
        if (stop.current) break;
        const res = await readPending({ limit: 10 });
        const started = res?.started ?? 0;
        if (started === 0) break;
        read += started;
        setDone(read);
      }
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="count">
          {terms.length > 0
            ? `${shown.length} of ${sorted.length} bills`
            : doubting
              ? `${queue.length} set aside`
              : `${counts.unread} not read · ${counts.ready} waiting for you`}
          {terms.length === 0 && counts.failed > 0 && ` · ${counts.failed} failed`}
        </div>

        <div className="tagbar">
          <AutoTag autoTag={tags.autoTag} names={tags.tagNames} compact />
          <span className="chips tiny">
            {marksInPile.map((t) => (
              <button
                key={t.id}
                className={`chip${onlyTag === t.id ? ' on' : ''}`}
                onClick={() => setOnlyTag(onlyTag === t.id ? null : t.id)}
              >
                <span className={`tagdot t-${t.id}`} style={{ '--dot': '8px' }} />
                {t.label}
                <span className="ref"> {t.count}</span>
              </button>
            ))}
          </span>
          <button className="link" onClick={() => setNaming(true)}>
            name the marks
          </button>
        </div>

        <div className="findbox">
          <input
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFind('')}
            placeholder="Find in what was read — a name, a figure, the goods"
            aria-label="Search the pile"
            autoComplete="off"
            spellCheck="false"
          />
          {find && (
            <button className="link" onClick={() => setFind('')} aria-label="Clear">
              clear
            </button>
          )}
        </div>
        <div className="actions">
          <span className="chips tiny">
            {[
              ['name', 'By name'],
              ['shot', 'As photographed'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={`chip${order === id ? ' on' : ''}`}
                onClick={() => {
                  setOrder(id);
                  try {
                    localStorage.setItem('shivledger:review-order', id);
                  } catch { /* private browsing — it just will not stick */ }
                }}
              >
                {label}
              </button>
            ))}
          </span>
          {running && (
            <button className="btn ghost" onClick={() => { stop.current = true; }}>
              Stop
            </button>
          )}
          <button className="btn" onClick={readAll} disabled={running || counts.unread === 0}>
            {running
              ? `Reading… ${done} done, ${counts.unread} left`
              : counts.unread === 0
                ? 'All read'
                : `Read all ${counts.unread} bills`}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {joining.length > 0 && (
        <div className="joinbar">
          <span>
            {joining.length === 1
              ? '1 slip picked — tick the other sheet of the same bill'
              : `${joining.length} slips picked`}
          </span>
          <button className="link" onClick={() => setJoining([])}>clear</button>
          <button
            className="btn"
            disabled={joining.length < 2 || busyJoin}
            onClick={async () => {
              setBusyJoin(true);
              setError('');
              try {
                const res = await join({ readingIds: joining });
                setJoining([]);
                // It comes back as one unread bill; read it front to back.
                await readPending({ limit: 1 });
                setError(`Joined ${res.pages} pages — reading them together now.`);
              } catch (err) {
                setError(err.message ?? String(err));
              } finally {
                setBusyJoin(false);
              }
            }}
          >
            {busyJoin ? 'Joining…' : 'Join into one bill'}
          </button>
        </div>
      )}

      {naming && (
        <TagSettings
          names={tags.tagNames}
          autoTag={tags.autoTag}
          onClose={() => setNaming(false)}
        />
      )}

      <Teach />

      {queue.length > 0 && shown.length === 0 ? (
        <div className="empty">
          Nothing in the pile mentions “{find.trim()}”.
          <div className="hint">
            This searches what the reader made of each slip — the party, the
            figures, the marks and the goods on the lines. A word it misread is
            a word that will not be found.
          </div>
        </div>
      ) : queue.length === 0 ? (
        <div className="empty">
          {doubting
            ? 'Nothing set aside. Bills you mark Doubt wait here.'
            : 'Nothing to review. Photograph bills on the phone, then read them here.'}
        </div>
      ) : (
        <div className="rev-list">
          {shown.map((item) => (
            <Card
              key={item._id}
              item={item}
              ledgers={ledgers}
              groups={masters?.groups ?? []}
              twins={twins[item._id]}
              tagNames={tags.tagNames}
              picked={joining.includes(item._id)}
              onPick={(id, on) =>
                setJoining((list) =>
                  on ? [...list, id] : list.filter((x) => x !== id)
                )
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
