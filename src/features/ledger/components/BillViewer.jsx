import React from 'react';
import AttachmentViewer from '../../../components/AttachmentViewer';
import { isPdfAttachment } from '../../../lib/attachments';
import { rupees, longDate, shortDate } from '../lib/format';
import { saveBillPdf } from '../lib/pdf';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';

/**
 * Every photo of a list of vouchers (a ledger, a day), in the order shown,
 * as one set to go left and right through, opened at the voucher clicked.
 * Each photo says which voucher it is on. A photo on two lines of the list
 * (a sale and the money taken with it) is in the set once.
 *
 * `entries` are { key, vchLabel, date, party?, vchType?, amount?, refNo?,
 * attachmentUrls }; `clicked` is the key of the one opened. What the entry is
 * (type, number, day, amount, reference) heads the viewer while its photo is
 * on screen.
 */
export function photoStrip(entries, clicked, title) {
  // Where each photo sits in the set, so a line whose photo is already in it
  // (the money taken with a sale) opens on that photo, not the next bill's.
  const seen = new Map();
  const all = [];
  let initialIndex = 0;
  for (const entry of entries) {
    const own = (entry.attachmentUrls ?? []).filter((a) => a.url || a.storageId);
    const shots = own.filter((a) => !seen.has(a.storageId ?? a.url));
    if (entry.key === clicked) {
      const first = own[0];
      initialIndex = first && seen.has(first.storageId ?? first.url) ? seen.get(first.storageId ?? first.url) : all.length;
    }
    for (const a of shots) {
      seen.set(a.storageId ?? a.url, all.length);
      const where = [entry.vchLabel, entry.date != null ? shortDate(entry.date) : null, entry.party].filter(Boolean).join(' · ');
      const caption = [
        [entry.vchType, entry.vchLabel].filter(Boolean).join(' '),
        entry.date != null ? longDate(entry.date) : null,
        entry.amount != null ? '₹' + rupees(entry.amount) : 'amount not entered yet',
        entry.refNo ? 'Ref ' + entry.refNo : null,
        entry.party,
      ].filter(Boolean).join(' · ');
      all.push({
        ...a,
        caption,
        label: [where, a.label].filter(Boolean).join(' · '),
        // What the viewer's card shows for this photo (AttachmentViewer EntryCard).
        entry: {
          type: entry.vchType || '',
          number: entry.vchLabel || '',
          date: entry.date != null ? longDate(entry.date) : '',
          amount: entry.amount != null ? '₹' + rupees(entry.amount) : '',
          refNo: entry.refNo || '',
          party: entry.party || '',
          paper: a.label || '',
        },
      });
    }
  }
  return { party: title, attachmentUrls: all, initialIndex: Math.min(initialIndex, Math.max(0, all.length - 1)) };
}

/** One attachment preview, shared by the books, vouchers, and phone view. */
export default function BillViewer({ voucher, onClose, initialIndex = 0, docked = false, onExpand = undefined, toolsBefore = undefined }) {
  const attached = voucher.attachmentUrls ?? voucher.attachments ?? [];
  const unresolved = attached.filter((shot) => !shot.url && shot.storageId);
  const resolved = useQuery(api.files.describe, unresolved.length ? { storageIds: unresolved.map((shot) => shot.storageId) } : 'skip');
  const shots = attached.map((shot) => shot.url ? shot : { ...shot, ...resolved?.find((file) => file.storageId === shot.storageId) });
  const images = shots.filter((shot) => shot.url && !isPdfAttachment(shot));
  const title = [voucher.vchLabel, voucher.party].filter(Boolean).join(' · ') || 'Bill attachments';
  const subtitle = [
    voucher.date != null ? longDate(voucher.date) : null,
    voucher.refNo ? 'Ref ' + voucher.refNo : null,
    voucher.amount != null ? '₹' + rupees(voucher.amount) : null,
  ].filter(Boolean).join(' · ');
  return (
    <AttachmentViewer
      attachments={shots}
      loading={unresolved.length > 0 && !resolved}
      title={title}
      subtitle={subtitle}
      initialIndex={voucher.initialIndex ?? initialIndex}
      onClose={onClose}
      docked={docked}
      onExpand={onExpand}
      toolsBefore={toolsBefore}
      onDownloadPdf={images.length ? () => saveBillPdf({ ...voucher, date: voucher.date ?? Date.now(), attachmentUrls: images }) : undefined}
    />
  );
}
