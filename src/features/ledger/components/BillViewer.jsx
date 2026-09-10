import React, { useEffect, useState } from 'react';
import { rupees, longDate } from '../lib/format';
import { saveBillPdf } from '../lib/pdf';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v11m0 0-4-4m4 4 4-4" {...stroke} />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" {...stroke} />
  </svg>
);

const OpenIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 4h6v6M20 4l-8 8" {...stroke} />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" {...stroke} />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" {...stroke} />
  </svg>
);

/**
 * The bill, as large as the window allows. Zooming is left to the browser —
 * "Open" hands the photo to the phone's or the browser's own viewer, which
 * pinches and pans better than anything reimplemented here.
 */
export default function BillViewer({ voucher, onClose }) {
  const shots = voucher.attachmentUrls ?? [];
  const [at, setAt] = useState(0);
  const [saving, setSaving] = useState(false);

  const shot = shots[at];
  // Convex storage URLs have no file extension, so the store's own content
  // type is the only thing that actually knows what this document is.
  const isPdf =
    (shot?.contentType ?? '').includes('pdf') || Boolean(shot?.url?.toLowerCase().endsWith('.pdf'));
  // A PDF is shown through the picture rendered for it; Open still hands over
  // the PDF itself.
  const shown = shot?.previewUrl ?? shot?.url;
  const rendered = isPdf && Boolean(shot?.previewUrl);
  const hasImages = shots.some((s) => (s.contentType ?? 'image/jpeg').startsWith('image/'));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setAt((i) => Math.min(i + 1, shots.length - 1));
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shots.length]);

  const pdf = async () => {
    setSaving(true);
    try {
      await saveBillPdf(voucher);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lightbox-inner">
        <header className="billhead">
          <div className="billhead-main">
            {voucher.vchLabel && <span className="vchbadge">{voucher.vchLabel}</span>}
            <span className="billhead-party">{voucher.party}</span>
          </div>

          <div className="billhead-meta">
            <span>{longDate(voucher.date)}</span>
            {voucher.refNo && (
              <>
                <span className="dot">·</span>
                <span className="mono">Ref {voucher.refNo}</span>
              </>
            )}
            {voucher.amount != null && (
              <>
                <span className="dot">·</span>
                <span className="billhead-amt">₹{rupees(voucher.amount)}</span>
              </>
            )}
          </div>

          <div className="billhead-acts">
            {hasImages && (
              <button className="actbtn primary" onClick={pdf} disabled={saving}>
                <DownloadIcon />
                {saving ? 'Making PDF…' : 'PDF'}
              </button>
            )}
            <a className="actbtn" href={shot?.url} target="_blank" rel="noreferrer">
              <OpenIcon />
              Open
            </a>
            <button className="actbtn icon" onClick={onClose} aria-label="Close">
              <CloseIcon />
            </button>
          </div>
        </header>

        {isPdf && !rendered ? (
          <div className="stage pdf">
            <iframe className="pdfframe" src={shot.url} title={voucher.vchLabel} />
          </div>
        ) : (
          <div className="stage">
            {shot && (
              <a href={shot.url} target="_blank" rel="noreferrer">
                <img src={shown} alt="" draggable="false" />
              </a>
            )}
          </div>
        )}

        {shots.length > 1 && (
          <footer>
            <button
              className="actbtn"
              onClick={() => setAt((i) => Math.max(i - 1, 0))}
              disabled={at === 0}
            >
              ←
            </button>
            <span className="sheetcount">
              {shot?.label ?? ''} · {at + 1} of {shots.length}
            </span>
            <button
              className="actbtn"
              onClick={() => setAt((i) => Math.min(i + 1, shots.length - 1))}
              disabled={at === shots.length - 1}
            >
              →
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
