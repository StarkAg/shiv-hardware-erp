import React, { useEffect, useMemo, useRef } from 'react';
import { X, Printer } from 'lucide-react';
import { buildBillHtml } from '../../../lib/billHtml';

/**
 * The bill itself, opened from its line in the ledger.
 *
 * Not an attachment: nothing is stored and nothing was uploaded. The bill is
 * drawn from the voucher's own figures each time it is opened, so it always
 * shows what the books currently hold rather than a picture taken of them once.
 * A photographed paper bill still sits behind the paperclip beside this.
 *
 * The same `buildBillHtml` the counter's preview and the printer both use, so
 * what appears here is what comes out of the printer.
 */
export default function VoucherBillPreview({ bill, onClose }) {
  const frameRef = useRef(null);
  const srcDoc = useMemo(() => buildBillHtml(bill), [bill]);

  // Esc closes it, like every other thing this screen opens over itself.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Print the frame itself rather than the page around it, so the bill comes
   * out on its own 148x210 sheet and not inside a screenshot of the ledger.
   */
  const print = () => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };

  return (
    <div className="billpeek" role="dialog" aria-modal="true" aria-label={`Bill ${bill.number ?? ''}`}>
      <div className="billpeek-head">
        <h2>
          {bill.number ? `Bill ${bill.number}` : 'Bill'}
          {bill.customerName ? ` · ${bill.customerName}` : ''}
        </h2>
        <div className="billpeek-acts">
          <button className="btn" onClick={print}>
            <Printer size={15} aria-hidden="true" /> Print
          </button>
          <button className="xbtn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="billpeek-body">
        <iframe
          ref={frameRef}
          title={`Bill ${bill.number ?? ''}`}
          srcDoc={srcDoc}
          className="billframe"
        />
      </div>
    </div>
  );
}
