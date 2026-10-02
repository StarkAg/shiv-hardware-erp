import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { jsPDF } from 'jspdf';
import AttachmentViewer from '../../src/components/AttachmentViewer';
import { pdfToImages } from '../../src/features/ledger/lib/image';

const photo = (label, color) => 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1300"><rect width="900" height="1300" fill="' + color + '"/><text x="100" y="150" font-size="50">' + label + '</text><text x="100" y="600" font-size="40">Total 1234</text><text x="100" y="1200" font-size="30">End of bill</text></svg>'
);
const doc = new jsPDF();
doc.text('PDF page one', 20, 20); doc.addPage(); doc.text('PDF page two', 20, 20);
const pdfUrl = URL.createObjectURL(doc.output('blob'));
const files = [
  { url: photo('First photo', '#fff8db'), contentType: 'image/svg+xml', label: '#0001' },
  { url: photo('Second photo', '#dcf7ee'), contentType: 'image/svg+xml', label: '#0002' },
  { url: pdfUrl, contentType: 'application/pdf', label: 'Two-page PDF' },
];
window.convertLongPdf = async () => {
  const pdf = new jsPDF();
  for (let index = 0; index < 14; index++) {
    if (index) pdf.addPage();
    pdf.text('Page ' + (index + 1), 20, 20);
  }
  const pages = await pdfToImages(new File([pdf.output('blob')], 'fourteen.pdf', { type: 'application/pdf' }));
  return { count: pages.length, last: pages.at(-1).name };
};
function App() {
  const [view, setView] = useState(null);
  return <main style={{ padding: 20 }}>
    <label>Voucher narration <input id="narration" defaultValue="Keep this draft" /></label>
    <button id="open-photos" onClick={() => setView({ attachments: files })}>Open photos</button>
    <button id="open-pdf" onClick={() => setView({ attachments: files, initialIndex: 2 })}>Open PDF</button>
    <button id="open-empty" onClick={() => setView({ attachments: [] })}>Open empty</button>
    <button id="open-broken" onClick={() => setView({ attachments: [{ url: '/unavailable-photo.jpg', contentType: 'image/jpeg' }] })}>Open broken</button>
    {view && <AttachmentViewer {...view} title="Bill photos" onClose={() => setView(null)} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
