import React, { useState } from 'react';

/**
 * Asks before doing something that cannot be shrugged off. With `requireText`
 * it asks for that word to be typed out first — putting a voucher back into
 * the books should take a deliberate act, not a stray click.
 */
export default function Confirm({
  title,
  body,
  confirmLabel,
  danger,
  requireText,
  requireLabel,
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  const matches =
    !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase();

  const go = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal narrow">
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
  );
}
