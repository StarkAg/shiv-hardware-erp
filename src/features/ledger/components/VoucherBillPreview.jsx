import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
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
// One A5 page at 96dpi — 148mm x 210mm, the size buildBillHtml draws each page.
const PAGE_W = 559;
const PAGE_H = 794;
// Room left beside the page for the arrows, and under it for the page count.
// A phone is short of width rather than height, so there the arrows sit in the
// footer beside the count and the page takes the full width.
const SIDE = 64;
const NARROW = 600;
const SIDE_NARROW = 8;
const FOOT = 44;

export default function VoucherBillPreview({ bill, onClose, actions = null }) {
  const frameRef = useRef(null);
  const bodyRef = useRef(null);
  const srcDoc = useMemo(() => buildBillHtml(bill), [bill]);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  const [scale, setScale] = useState(1);

  /**
   * The whole page, in view, as large as the screen allows.
   *
   * The frame used to be drawn at the page's own size and scrolled, so on a
   * laptop the top of the bill sat under the header and its total below the
   * fold. It is scaled to the space instead — never so far up that one line
   * fills a monitor — and redrawn whenever that space changes.
   */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      const across = (width - (width < NARROW ? SIDE_NARROW : SIDE) * 2) / PAGE_W;
      const down = (height - FOOT) / PAGE_H;
      setScale(Math.max(0.25, Math.min(across, down, 1.6)));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  /**
   * A bill over fourteen lines runs to a second page and says P.T.O at the
   * foot of the first — and the frame, one page tall and not scrollable, never
   * showed the second. Each page is its own element in the bill, so they are
   * counted when it draws and turned by moving the frame to the one asked for.
   */
  const counted = () => {
    const doc = frameRef.current?.contentDocument;
    setPages(Math.max(1, doc?.body?.children.length ?? 1));
    setPage(0);
  };
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    const target = doc?.body?.children[page];
    frameRef.current?.contentWindow?.scrollTo(0, target ? target.offsetTop : 0);
  }, [page, pages, srcDoc]);

  const turn = (by) => setPage((now) => Math.min(pages - 1, Math.max(0, now + by)));

  // Esc closes it, like every other thing this screen opens over itself; the
  // arrow keys turn the page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') turn(1);
      else if (e.key === 'ArrowLeft') turn(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, pages]);

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
          {actions}
          <button className="btn" onClick={print}>
            <Printer size={15} aria-hidden="true" /> Print
          </button>
          <button className="xbtn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="billpeek-body" ref={bodyRef}>
        {pages > 1 && (
          <button
            className="billpeek-turn prev"
            onClick={() => turn(-1)}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft size={26} aria-hidden="true" />
          </button>
        )}

        <div className="billpeek-page" style={{ width: PAGE_W * scale, height: PAGE_H * scale }}>
          <iframe
            ref={frameRef}
            title={`Bill ${bill.number ?? ''}`}
            srcDoc={srcDoc}
            className="billframe"
            onLoad={counted}
            style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})` }}
          />
        </div>

        {pages > 1 && (
          <button
            className="billpeek-turn next"
            onClick={() => turn(1)}
            disabled={page === pages - 1}
            aria-label="Next page"
          >
            <ChevronRight size={26} aria-hidden="true" />
          </button>
        )}

        {pages > 1 && (
          <div className="billpeek-count" aria-live="polite">
            Page <b>{page + 1}</b> of {pages}
          </div>
        )}
      </div>
    </div>
  );
}
