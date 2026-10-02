import React, { useState } from 'react';
import { X } from 'lucide-react'
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { rupees, shortDate } from '../lib/format';
import Confirm from './Confirm';
import PriceDialog from './PriceDialog';
import { AttachmentThumbnail } from '../../../components/AttachmentViewer';
import { GridSkeleton } from './Skeleton';

/**
 * How a match is put to whoever is working the queue.
 *
 * The three grounds are not equally sure of themselves, so they are not said
 * in the same voice. A bill number agreeing on the same account is as near
 * certain as this gets and is said plainly; the other two are questions, and
 * are worded as questions — the queue is no use if it cries wolf.
 */
function said(twin) {
  if (twin.status === 'pending') return 'Also waiting in this queue';
  if (twin.on === 'ref') return 'Already entered';
  if (twin.on === 'slip') return 'Same bill number, same day';
  return 'Possibly already entered';
}

/** The queue Tally has no place for: bills filed before anyone priced them. */
export default function Pending({ rows: live, masters, onViewBill, onOpen }) {
  const rows = live ?? [];
  const remove = useMutation(api.vouchers.remove);
  const [pricing, setPricing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  if (live === undefined) return <GridSkeleton count={6} />;

  if (rows.length === 0) {
    return <div className="empty">Nothing awaiting an amount.</div>;
  }

  const twinned = rows.filter((r) => (r.alreadyIn ?? []).length > 0).length;

  return (
    <>
      <div className="toolbar">
        <div className="count">
          {rows.length} bills
          {twinned > 0 && ` · ${twinned} may already be in the books`}
        </div>
      </div>

      <div className="pendinggrid">
        {rows.map((r) => {
          const twins = r.alreadyIn ?? [];
          return (
            <div className={`pendingcard${twins.length > 0 ? ' twinned' : ''}`} key={r._id}>
              {r.attachmentUrls.length > 0 ? (
                <button type="button" className="shot" aria-label="Preview bill attachments" onClick={() => onViewBill(r)}>
                  <AttachmentThumbnail file={r.attachmentUrls[0]} />
                </button>
              ) : (
                <div className="shot blank">no photo</div>
              )}
              <div className="pendingbody">
                <button className="link plain party" onClick={() => onOpen(r.partyLedgerId)}>
                  {r.party}
                </button>
                <div className="ref mono">
                  {shortDate(r.date)} · {r.vchLabel}
                  {r.refNo ? ` · ${r.refNo}` : ''}
                </div>
                {r.narration && <div className="ref">{r.narration}</div>}

                {twins.map((twin) => (
                  <button
                    key={twin._id}
                    className="twin"
                    onClick={() => onOpen(r.partyLedgerId)}
                    title="Open the account and see it"
                  >
                    <span className="twin-said">{said(twin)}</span>
                    <span className="twin-vch mono">
                      {twin.vchLabel} · {shortDate(twin.date)}
                      {twin.refNo ? ` · ${twin.refNo}` : ''}
                      {twin.amount != null ? ` · ₹${rupees(twin.amount)}` : ''}
                    </span>
                    {/* Named only when it is somebody else's — that is the whole
                        point of the match, and without it the line reads as if
                        this very account already had the bill. */}
                    {twin.party !== r.party && <span className="twin-party">on {twin.party}</span>}
                  </button>
                ))}

                <div className="pendingacts">
                  <button className="btn small" onClick={() => setPricing(r)}>Enter amount</button>
                  <button className="xbtn del" onClick={() => setDeleting(r)} aria-label="Delete">
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pricing && (
        <PriceDialog
          voucher={pricing}
          ledgers={masters?.ledgers ?? []}
          groups={masters?.groups ?? []}
          onClose={() => setPricing(null)}
        />
      )}

      {deleting && (
        <Confirm
          title={`Delete ${deleting.vchLabel}?`}
          body={
            (deleting.alreadyIn ?? []).length > 0
              ? `${deleting.party} · ${shortDate(deleting.date)}. It never carried an amount, ` +
                `so no balance moves — and ${deleting.alreadyIn[0].vchLabel} stays in the books. ` +
                `It goes to Trash with its photos, where Restore puts it back in this queue.`
              : `${deleting.party} · ${shortDate(deleting.date)}. It never carried an amount, ` +
                `so no balance moves. It goes to Trash with its photos, where Restore puts ` +
                `it back in this queue.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => remove({ id: deleting._id })}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
