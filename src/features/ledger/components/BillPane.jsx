import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react'
import { shortDate } from '../lib/format';

/**
 * The bill, docked beside the voucher rather than thrown over it.
 *
 * A full-screen viewer hides the form you are filling in from what you are
 * reading it off — which is the one moment both need to be on screen at once.
 * So on a wide screen the bill takes the space the modal was leaving empty.
 */
export default function BillPane({ bill, onClose }) {
  const [i, setI] = useState(0);
  const pages = bill?.attachmentUrls ?? [];

  // A different bill starts at its first page, not wherever the last one was.
  useEffect(() => setI(0), [bill]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, pages.length - 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pages.length]);

  if (!bill || pages.length === 0) return null;
  const page = pages[Math.min(i, pages.length - 1)];

  return (
    <aside className="billpane" onMouseDown={(e) => e.stopPropagation()}>
      <header className="billpane-head">
        <div>
          <div className="billpane-title">{bill.party || 'Bill'}</div>
          {bill.date ? <div className="ref">{shortDate(bill.date)}</div> : null}
        </div>
        <button type="button" className="xbtn" onClick={onClose} aria-label="Close preview">
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="billpane-sheet">
        <img src={page.previewUrl || page.url} alt="" />
      </div>

      {pages.length > 1 && (
        <footer className="billpane-foot">
          <button
            type="button"
            className="btn ghost"
            disabled={i === 0}
            onClick={() => setI(i - 1)}
          >
            ‹ Prev
          </button>
          <span className="count">
            Page {Math.min(i, pages.length - 1) + 1} of {pages.length}
          </span>
          <button
            type="button"
            className="btn ghost"
            disabled={i >= pages.length - 1}
            onClick={() => setI(i + 1)}
          >
            Next ›
          </button>
        </footer>
      )}
    </aside>
  );
}
