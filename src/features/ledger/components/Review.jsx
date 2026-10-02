import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { bestMatch, similarity, clean, isOwnShop } from '../lib/match';
import Combo from './Combo';
import AttachmentViewer from '../../../components/AttachmentViewer';

/** Review opens the same attachment viewer as every other photo action. */
function Enlarged({ pages, at, onClose }) {
  return <AttachmentViewer attachments={pages} initialIndex={at} title="Bill photos" onClose={onClose} />;
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

/**
 * One slip, and the only question it needs answering: whose is it?
 *
 * This card used to ask for the voucher type, the account, the date, the
 * amount, the reference, what the paper was, the particulars, a goods return,
 * what was paid and where the money went. Every one of those is worth asking
 * when a single bill is being posted — and every one is in the way when a
 * backlog of unpriced slips needs a name and nothing else. The rates are not
 * decided yet; the date and the number are on the paper and can be read when
 * it is priced.
 *
 * So what is left is the photograph, the account, and where the paper is:
 * which stack it came off and how far down that stack it sits. It files as a
 * pending voucher — no amount, no entries, no balance moved.
 *
 * Two things are not asked about at all. What comes through this pile is the
 * shop's own sale slips, so every one of them is a sale to a customer — which
 * is why the row of Sale/Receipt/Purchase/Payment chips is gone, and why the
 * account list holds customers only. And the date is when the slip was
 * photographed, which is honest: a date nobody typed is better empty than
 * guessed, and the real one is on the paper, to be read when it is priced.
 */
function Card({ item, ledgers, groups, picked, onPick, onDone }) {
  const approve = useMutation(api.review.approve);
  const discard = useMutation(api.review.discard);
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

  /**
   * Customers only.
   *
   * What comes through this pile is the shop's own sale slips, so a supplier in
   * the list is only ever a wrong answer within reach — and one that would file
   * the slip as a purchase and push the balance the wrong way. Supplier bills
   * are written at the counter, where the account and the figures are known.
   */
  const parties = useMemo(
    () => ledgers.filter((l) => l.groupName === 'Sundry Debtors'),
    [ledgers]
  );

  const [partyLedgerId, setPartyLedgerId] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [big, setBig] = useState(false);

  /**
   * The account the reader's spelling belongs to, allowing for a hand that
   * turns Nilesh into Nitesh. Matched across both sides of the book now that
   * nothing on this card says which side it should be.
   */
  const match = useMemo(
    // Nothing to match a nameless slip against — and "UNKNOWN" is close enough
    // to a real name to score against one, which would quietly fill in an
    // account for a bill that names nobody.
    () => (readName && !noName && !isUs ? bestMatch(readName, parties) : null),
    [readName, parties, noName, isUs]
  );

  /**
   * Listed by name, so near-identical names sit together and can be told apart
   * — three spellings of Nilesh Store are only confusing when they are
   * scattered down the list by score. The likeliest match is still selected for
   * you and still carries its percentage; the ordering is for reading.
   */
  const ranked = useMemo(() => {
    const scored = parties.map((l) => ({
      ...l,
      score: readName && !noName ? similarity(readName, l.name) : 0,
    }));
    return scored.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, [parties, readName, noName]);

  // The guess goes in the box by itself, and is replaced when the reader
  // catches up with a different slip.
  useEffect(() => {
    setPartyLedgerId(match?.ledger?._id ?? '');
  }, [match?.ledger?._id, item._id]);

  const chosen = parties.find((p) => p._id === partyLedgerId);

  const save = async () => {
    if (!partyLedgerId && !noName) return setError('Pick the account this belongs to');
    setBusy(true);
    setError('');
    try {
      await approve({
        readingId: item._id,
        // Always a sale: the account list holds customers only.
        kind: 'sale',
        partyLedgerId: partyLedgerId || undefined,
        walkIn: partyLedgerId ? undefined : true,
        // When the slip was photographed. Nobody is asked for a date, and a
        // guessed one would date the voucher to whenever it was reviewed.
        date: item.shotAt ?? item.at,
        // No amount: a pending voucher, carrying no entries, touching no
        // balance until somebody prices it.
        documentKind: 'bill',
        // The one correction worth teaching: what this shop's hand calls this
        // customer. Every other field this card used to carry is gone, so
        // there is nothing else it could have got wrong.
        corrections:
          draft?.party && chosen && draft.party.trim() !== chosen.name
            ? [{ field: 'party', wrong: draft.party.trim(), right: chosen.name }]
            : [],
      });
      onDone?.();
    } catch (err) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
    return undefined;
  };

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
            {/* Why somebody set this aside. */}
            {item.doubtNote && (
              <div className="rev-doubtnote">
                <b>{item.status === 'doubt' ? 'Set aside:' : 'Was set aside:'}</b>{' '}
                {item.doubtNote}
              </div>
            )}

            <div className="rev-head">
              {/*
                * Where this piece of paper is: which stack it was photographed
                * into, and how far down that stack it sits. Counted over the
                * whole pile as it was shot — the seventh slip of stack A is
                * still the seventh after the six before it are filed, which is
                * what makes it findable again.
                */}
              {item.index > 0 && (
                <span className="rev-place">
                  {item.stack ? `${item.stack} · ` : ''}
                  {item.index} of {item.inStack}
                </span>
              )}
            </div>

            <label>
              <span className="lblrow">
                <span>Account</span>
                <span className="chips tiny">
                  <button
                    type="button"
                    className="chip add"
                    onClick={async () => {
                      const name = window.prompt(
                        'Name of the new customer',
                        draft.party && draft.party !== '<UNKNOWN>' ? draft.party : ''
                      );
                      if (!name?.trim()) return;
                      const group = (groups ?? []).find((g) => g.name === 'Sundry Debtors');
                      if (!group) return setError('That group is missing from the books');
                      try {
                        const id = await createLedger({
                          name: name.trim(),
                          groupId: group._id,
                          openingBalance: 0,
                          openingSide: 'Dr',
                          openingAsOf: item.shotAt ?? item.at,
                        });
                        setPartyLedgerId(id);
                      } catch (err) {
                        setError(err.message ?? String(err));
                      }
                      return undefined;
                    }}
                  >
                    + Add customer
                  </button>
                </span>
              </span>
              <Combo
                options={ranked.map((p) => ({
                  id: p._id,
                  name: p.name,
                  hint: p.score >= 0.72 ? `${Math.round(p.score * 100)}% match` : p.place,
                }))}
                value={partyLedgerId}
                onChange={setPartyLedgerId}
                onCreate={async (name) => {
                  const group = (groups ?? []).find((g) => g.name === 'Sundry Debtors');
                  if (!group) throw new Error('That group is missing from the books');
                  const id = await createLedger({
                    name,
                    groupId: group._id,
                    openingBalance: 0,
                    openingSide: 'Dr',
                    openingAsOf: item.shotAt ?? item.at,
                  });
                  setPartyLedgerId(id);
                  return id;
                }}
                createGroup="Customers"
                placeholder="Type or pick the account"
              />

              {isUs && (
                <span className="hint warnhint">
                  read as “{readName}” — that is this shop, not the party. On a
                  supplier’s printed slip the party is the business on the
                  letterhead; pick or add it.
                </span>
              )}

              {noName && !partyLedgerId && (
                <span className="hint">
                  no name on this slip — approving files it to <b>W/B</b>, the walk-in account.
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
              <button
                className="btn ghost"
                onClick={() => discard({ readingId: item._id })}
                disabled={busy}
              >
                Skip
              </button>
              <button className="btn" onClick={save} disabled={busy}>
                {busy ? 'Filing…' : 'File it'}
              </button>
            </div>

            <p className="hint">Files unpriced — the amount goes on when the bill is priced.</p>
          </>
        )}
      </div>

      {big && (
        <Enlarged pages={pages} at={page} setAt={setPage} onClose={() => setBig(false)} />
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
  const [busyJoin, setBusyJoin] = useState(false);
  const [find, setFind] = useState('');
  const join = useMutation(api.review.join);
  const stop = useRef(false);

  const ledgers = masters?.ledgers ?? [];

  const parties = useMemo(
    () => ledgers.filter((l) => l.groupName === 'Sundry Debtors'),
    [ledgers]
  );

  /**
   * The pile in the order it was photographed, and in no other.
   *
   * There used to be a choice between this and name order, which grouped a
   * customer's slips together. Name order is the wrong one here: the card now
   * says which stack a slip came off and how far down it sits, and that number
   * is only any use while the screen is walking the stack in the order the
   * paper is actually in.
   */
  const sorted = useMemo(
    () => [...queue].sort((a, b) => (a.shotAt ?? a.at) - (b.shotAt ?? b.at)),
    [queue]
  );

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
  const terms = useMemo(
    () => find.toLowerCase().replace(/,/g, '').split(/\s+/).filter(Boolean),
    [find]
  );
  const shown = useMemo(() => {
    if (terms.length === 0) return sorted;
    return sorted.filter((item) => {
      const read = clean(item.draft?.party);
      const account = read && !isOwnShop(read) ? bestMatch(read, parties)?.ledger.name : '';
      return matches(haystack(item, account), terms);
    });
  }, [sorted, terms, parties]);

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
