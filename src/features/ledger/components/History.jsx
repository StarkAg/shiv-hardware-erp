import React, { useState } from 'react';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { shortDate } from '../lib/format';
import Confirm from './Confirm';

/** What kind of change it was, in a word, and what colour to say it in. */
const TONE = {
  'voucher.create': ['entered', 'add'],
  'voucher.edit': ['edited', 'edit'],
  'voucher.update': ['edited', 'edit'],
  'voucher.price': ['priced', 'add'],
  'voucher.delete': ['deleted', 'del'],
  'voucher.restore': ['restored', 'add'],
  'trash.purge': ['purged', 'del'],
  'ledger.create': ['ledger', 'add'],
  'ledger.update': ['ledger', 'edit'],
  'ledger.remove': ['ledger', 'del'],
  'attachment.add': ['document', 'edit'],
  'attachment.remove': ['document', 'del'],
  'attachment.replace': ['document', 'edit'],
  'attachment.kind': ['document', 'edit'],
  'attachment.preview': ['document', 'edit'],
  'admin.migrate': ['system', 'edit'],
  'admin.wipe': ['system', 'del'],
  'chain.begin': ['sealed', 'add'],
  'chain.accept': ['accepted', 'edit'],
  'chain.bitcoin': ['bitcoin', 'add'],
};

const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const dayLabel = (ms) => {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (dayKey(ms) === dayKey(today)) return 'Today';
  if (dayKey(ms) === dayKey(yesterday)) return 'Yesterday';
  return shortDate(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

const stamp = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}, ${clock(ms)}`;
};

/**
 * The seal on the history (convex/chain.ts): every line carries a fingerprint
 * made from itself and from the line before it, so a line changed, removed or
 * added afterwards shows. This says what the last check found, checks again
 * when asked, and lets vouchers the check found changed be accepted as they
 * stand, with the PIN.
 */
/** Saves a file from the browser. */
const saveFile = (name, data, type) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Where the night's fingerprint stands in Bitcoin (convex/anchor.ts), and its
 * proof to download: the fingerprint as a text file and its .ots beside it,
 * which `ots verify` checks on any computer without this app.
 */
function BitcoinLine({ anchor, inBitcoin }) {
  const convex = useConvex();
  const download = async (a) => {
    const got = await convex.query(api.chain.anchorProof, { id: a._id });
    if (!got) return;
    const name = `shiv-books-${new Date(got.at).toISOString().slice(0, 10)}.txt`;
    saveFile(name, got.head, 'text/plain');
    setTimeout(() => saveFile(`${name}.ots`, got.proof, 'application/octet-stream'), 400);
  };
  const written = anchor?.status === 'bitcoin' ? anchor : inBitcoin;
  return (
    <p className="chainbar-meta">
      {written && <>In Bitcoin: the fingerprint of {stamp(written.at)} is in block {written.height.toLocaleString('en-IN')}
        {written.blockTime ? ` (${stamp(written.blockTime)})` : ''} · <button type="button" className="link" onClick={() => download(written)}>Download proof</button></>}
      {anchor?.status === 'pending' && <>{written ? ' · ' : ''}The fingerprint of {stamp(anchor.at)} is sent to Bitcoin, waiting for a block (a few hours)</>}
      {anchor?.status === 'failed' && <>{written ? ' · ' : ''}Bitcoin: {anchor.error}</>}
    </p>
  );
}

function ChainBar() {
  const chain = useQuery(api.chain.latest, {});
  const check = useMutation(api.chain.check);
  const accept = useMutation(api.chain.accept);
  const [accepting, setAccepting] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!chain) return null;
  const last = chain.last;
  const broken = last && !last.error && !last.ok;
  const copy = async () => {
    try { await navigator.clipboard.writeText(last.head); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* shown in full on hover */ }
  };
  return (
    <div className={`chainbar ${broken ? 'bad' : last?.ok ? 'ok' : ''}`} role="status">
      <div className="chainbar-main">
        {!last ? <b>The books have not been checked yet.</b>
          : last.error ? <b>The check could not finish: {last.error}</b>
          : last.ok ? <b>Books intact: {last.entries.toLocaleString('en-IN')} entries sealed, {last.vouchers.toLocaleString('en-IN')} vouchers match.</b>
          : <b>The check found a problem.</b>}
        {last?.brokenAt && (
          <p>The history stops fitting at entry {last.brokenAt.seq} ({stamp(last.brokenAt.at)}): "{last.brokenAt.summary}". {last.brokenAt.why}.</p>
        )}
        {last?.changedCount > 0 && (
          <p>
            {last.changedCount} {last.changedCount === 1 ? 'voucher no longer matches' : 'vouchers no longer match'} the last entry written about {last.changedCount === 1 ? 'it' : 'them'}:
            {' '}{last.changed.map((v) => v.label).join(', ')}{last.changedCount > last.changed.length ? ' and more' : ''}.
          </p>
        )}
        {last && !last.error && (
          <p className="chainbar-meta">
            Checked {stamp(last.at)}{last.by === 'night' ? ' (nightly)' : ''}
            {last.unsealed > 0 ? ` · ${last.unsealed} older entries not sealed yet` : ''}
            {last.vouchersUnsealed > 0 ? ` · ${last.vouchersUnsealed} vouchers not sealed yet` : ''}
            {last.head ? <> · fingerprint <button type="button" className="link mono" title={last.head} onClick={copy}>{copied ? 'copied' : `${last.head.slice(0, 12)}…`}</button></> : null}
          </p>
        )}
        {(chain.anchor || chain.inBitcoin) && <BitcoinLine anchor={chain.anchor} inBitcoin={chain.inBitcoin} />}
      </div>
      <div className="chainbar-acts">
        {last?.changedCount > 0 && <button type="button" className="link" onClick={() => setAccepting(true)}>Accept as they stand</button>}
        <button type="button" className="btn" disabled={chain.running} onClick={() => check({})}>{chain.running ? 'Checking' : 'Check the books'}</button>
      </div>
      {accepting && <Confirm
        title={`Accept ${last.changed.length} ${last.changed.length === 1 ? 'voucher' : 'vouchers'} as they stand?`}
        body="Only when you know why they changed and it is right. Each gets a new sealed entry saying it was accepted, and that entry stays in the history."
        confirmLabel="Accept"
        ask={{ label: 'PIN', secret: true }}
        onConfirm={async (pin) => { await accept({ pin, voucherIds: last.changed.map((v) => v.voucherId) }); await check({}); }}
        onClose={() => setAccepting(false)}
      />}
    </div>
  );
}

/**
 * Everything that has ever been done to these books, newest first. Nothing in
 * the app removes a line from here — a delete, a purge and a wipe all leave
 * their own entry behind.
 */
export default function History({ onClose }) {
  const rows = useLive(api.history.list, { limit: 300 }, 'history') ?? [];

  let lastDay = null;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history">
        <div className="history-head">
          <h2>History</h2>
          <span className="count">{rows.length} changes</span>
          <button className="link" onClick={onClose}>Close</button>
        </div>
        <ChainBar />

        {rows.length === 0 ? (
          <div className="empty">Nothing recorded yet.</div>
        ) : (
          <div className="history-list">
            {rows.map((r) => {
              const [word, tone] = TONE[r.action] ?? ['changed', 'edit'];
              const head = dayKey(r.at) !== lastDay ? ((lastDay = dayKey(r.at)), r.at) : null;
              return (
                <React.Fragment key={r._id}>
                  {head && <div className="history-day">{dayLabel(head)}</div>}
                  <div className="history-row">
                    <span className="history-time mono">{clock(r.at)}</span>
                    <span className={`history-tag ${tone}`}>{word}</span>
                    <span className="history-what">{r.summary}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
