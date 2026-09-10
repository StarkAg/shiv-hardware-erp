import React from 'react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { shortDate } from '../lib/format';

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
