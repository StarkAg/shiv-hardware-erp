import React, { useState } from 'react';
import { useLedgerTheme } from '../useLedgerTheme';

/**
 * Asks before doing something that cannot be shrugged off. With `requireText`
 * it asks for that word to be typed out first — putting a voucher back into
 * the books should take a deliberate act, not a stray click.
 *
 * `ask` is for the other kind: a code only the shop knows, which the server
 * checks. That used `window.prompt`, which cannot mask what is typed and
 * cannot be styled — the shop's code went on screen in a system dialog for
 * anyone at the counter to read. What is typed here is handed to `onConfirm`.
 */
export default function Confirm({
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  requireText,
  requireLabel,
  ask,
  onConfirm,
  onClose,
}: {
  title: string
  body?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  /** Word the operator must type out before the button works. */
  requireText?: string
  requireLabel?: string
  /** A code the server checks. What is typed reaches `onConfirm`. */
  ask?: { label: string; secret?: boolean }
  onConfirm: (typed: string) => void | Promise<void>
  onClose: () => void
}) {
  // Opened from the quotation and rate screens too, which are not inside the
  // ledger's styling scope, so the dialog brings the scope with it.
  const dark = useLedgerTheme();
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');

  const matches =
    (!requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase()) &&
    (!ask || secret.trim() !== '');

  const go = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await onConfirm(secret);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className={`ledger-root portal${dark ? ' dark' : ''}`}>
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {body && <div className="hint">{body}</div>}

        {requireText && (
          <label>
            {requireLabel ?? 'Type the name to confirm'}
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder={requireText}
              autoFocus
              autoComplete="off"
              spellCheck="false"
            />
          </label>
        )}

        {ask && (
          <label>
            {ask.label}
            <input
              type={ask.secret ? 'password' : 'text'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              autoFocus={!requireText}
              autoComplete="off"
              spellCheck="false"
            />
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className={`btn${danger ? ' danger' : ''}`}
            onClick={go}
            disabled={busy || !matches}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}
