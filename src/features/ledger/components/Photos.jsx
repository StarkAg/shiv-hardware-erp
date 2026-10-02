import React, { useState } from 'react';
import BillViewer from './BillViewer';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { rupees, shortDate } from '../lib/format';
import { GridSkeleton } from './Skeleton';

/**
 * A photograph's clock is not a voucher's date.
 *
 * Voucher dates are stored as UTC midnight and `shortDate` reads them back in
 * UTC, which is right for them. A shutter time is a real instant: read in UTC,
 * anything shot after half past five in the evening would be filed under
 * tomorrow. These read in the shop's own time.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const shotDay = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const shotTime = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const sizeOf = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/** What this photograph is filed against, said in one line. */
function Filed({ shot, onOpen }) {
  if (shot.filed === 'inbox') {
    return <span className="shot-where inbox">Not filed yet · in the phone's inbox</span>;
  }
  return (
    <span className={`shot-where${shot.filed === 'trash' ? ' gone' : ''}`}>
      <button className="link plain" onClick={() => shot.partyLedgerId && onOpen(shot.partyLedgerId)}>
        {shot.party}
      </button>
      <span className="dot">·</span>
      <span className="mono">{shot.vchLabel}</span>
      <span className="dot">·</span>
      {shortDate(shot.date)}
      {shot.refNo && (
        <>
          <span className="dot">·</span>
          <span className="mono">{shot.refNo}</span>
        </>
      )}
      {shot.amount != null && (
        <>
          <span className="dot">·</span>
          <span className="shot-amt">₹{rupees(shot.amount)}</span>
        </>
      )}
      {shot.note && <span className="shot-note">{shot.note}</span>}
    </span>
  );
}

/**
 * Every photograph the shop has taken, four across, in shutter order.
 *
 * The books are organised by account and by date, which is what you want when
 * you are reading them and no use at all when you are looking for the bill you
 * shot twice. This is the pile itself, laid out as a contact sheet — a wall of
 * thumbnails you run your eye down, with the day's date across each break.
 * Clicking one opens the photograph itself, whole and uncropped.
 */
export default function Photos({ onOpen }) {
  const [viewing, setViewing] = useState(null);
  const live = useLive(api.photos.taken, {}, 'photos');
  const shots = live ?? [];

  if (live === undefined) return <GridSkeleton count={8} />;
  if (shots.length === 0) return <div className="empty">No photographs yet.</div>;

  const bytes = shots.reduce((t, s) => t + (s.size ?? 0), 0);
  let day = null;

  return (
    <>
      <div className="toolbar">
        <div className="count">
          {shots.length} photographs · {sizeOf(bytes)}
        </div>
      </div>

      <div className="shotroll">
        {shots.map((shot, i) => {
          const at = shotDay(shot.at);
          const heads = at !== day;
          day = at;
          return (
            <React.Fragment key={`${shot.storageId}-${i}`}>
              {heads && <h2 className="shotday">{at}</h2>}
              <figure className="shotbig">
                <button type="button" className="shotbtn" aria-label={'Preview photo ' + (i + 1)} onClick={() => setViewing(shot)}>
                  <img src={shot.url} alt="" loading="lazy" decoding="async" />
                </button>
                <figcaption>
                  <span className="shot-n mono">{i + 1}</span>
                  <span className="shot-at">{shotTime(shot.at)}</span>
                  <Filed shot={shot} onOpen={onOpen} />
                </figcaption>
              </figure>
            </React.Fragment>
          );
        })}
      </div>
      {viewing && <BillViewer voucher={{ ...viewing, attachmentUrls: [{
        url: viewing.fileUrl, previewUrl: viewing.url, contentType: viewing.contentType,
      }] }} onClose={() => setViewing(null)} />}
    </>
  );
}
