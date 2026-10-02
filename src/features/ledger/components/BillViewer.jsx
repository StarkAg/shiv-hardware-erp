import React from 'react';
import AttachmentViewer from '../../../components/AttachmentViewer';
import { isPdfAttachment } from '../../../lib/attachments';
import { rupees, longDate } from '../lib/format';
import { saveBillPdf } from '../lib/pdf';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';

/** One attachment preview, shared by the books, vouchers, and phone view. */
export default function BillViewer({ voucher, onClose, initialIndex = 0 }) {
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
      onDownloadPdf={images.length ? () => saveBillPdf({ ...voucher, date: voucher.date ?? Date.now(), attachmentUrls: images }) : undefined}
    />
  );
}
