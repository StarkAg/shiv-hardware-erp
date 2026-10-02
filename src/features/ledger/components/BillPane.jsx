import React from 'react';
import BillViewer from './BillViewer';

/** Kept for older callers; previews share the same controls and behavior. */
export default function BillPane({ bill, onClose }) {
  return bill ? <BillViewer voucher={bill} onClose={onClose} /> : null;
}
