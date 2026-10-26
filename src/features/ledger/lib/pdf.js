import { shortDate, longDate, rupees, rupeesInWords, phoneDisplay, rowType } from './format';

const SHOP = 'Shiv Hardware Store';

const A4 = { w: 595.28, h: 841.89 };   // points
const MARGIN = 36;
const TOP = MARGIN + 40;               // the first line under the heading rule

/** What is left of the page once the heading is written, in points. */
const BOX = { w: A4.w - MARGIN * 2, h: A4.h - TOP - MARGIN };

/**
 * How much detail is worth carrying onto the page. A bill printed at 200 dots
 * to the inch is as sharp as the paper it came off; every pixel past that is
 * weight in the file and time in the making, and not one dot on the print.
 */
const DPI = 200;
const QUALITY = 0.8;

const canvasFor = (w, h) => {
  // Off-screen where the browser has it: the drawing and the JPEG encoding
  // then happen off the main thread, and the app keeps answering while a
  // thick voucher is being built.
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

const encode = (canvas) =>
  canvas.convertToBlob
    ? canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
    : new Promise((done) => canvas.toBlob(done, 'image/jpeg', QUALITY));

const asDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the bill photo'));
    reader.readAsDataURL(blob);
  });

/**
 * One stored bill, ready to place: the picture, and the size the page will
 * print it at.
 *
 * A photo the page cannot show more of than it already has goes in untouched —
 * re-encoding a JPEG spends time and loses detail to no purpose. Anything
 * bigger than 200 dpi over its box, and anything that is not a JPEG, is
 * redrawn at the size that will actually be printed: a four-thousand-pixel
 * scan carries several times the weight of the same bill at 200 dpi.
 *
 * `from-image` applies the EXIF rotation while decoding, the same thing that
 * stops a phone photo arriving on its side everywhere else in the app — and it
 * decodes off the main thread, where the old `new Image()` did not.
 */
async function prepare(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not read the bill photo');
  const blob = await res.blob();

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That bill photo will not open');
  }

  const { width, height } = bitmap;
  // Points per pixel once the photo is fitted into the box, keeping its shape.
  const fit = Math.min(BOX.w / width, BOX.h / height);
  const placed = { w: width * fit, h: height * fit };
  // Never upscale: a small photo is left at the pixels it has.
  const keep = Math.min(1, (DPI / 72) * fit);

  if (keep === 1 && blob.type === 'image/jpeg') {
    bitmap.close?.();
    return { ...placed, dataUrl: await asDataUrl(blob) };
  }

  const w = Math.max(1, Math.round(width * keep));
  const h = Math.max(1, Math.round(height * keep));
  const canvas = canvasFor(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return { ...placed, dataUrl: await asDataUrl(await encode(canvas)) };
}

const clean = (s) => (s || '').replace(/[\/:*?"<>|]+/g, '-').trim();

/**
 * Every photo on a voucher, one to a page, each headed by the voucher it
 * belongs to — a document that can be filed, mailed or printed on its own.
 * jsPDF is pulled in only when someone actually asks for a PDF, so it costs
 * nothing on the ledger screens.
 */
export async function saveBillPdf(voucher) {
  // Only photographs are rebuilt into a PDF; a document that is already a PDF
  // is left alone — it is downloaded from the viewer as it stands.
  const shots = (voucher.attachmentUrls ?? []).filter((s) =>
    (s.contentType ?? 'image/jpeg').startsWith('image/')
  );
  if (shots.length === 0) return;

  // The photos are read together, and jsPDF is fetched alongside them rather
  // than before them. Read one at a time, as this once did, every bill waited
  // out the one before it — half a second of network apiece, so a four-photo
  // voucher spent two seconds doing nothing but queueing.
  const [{ jsPDF }, ...pages] = await Promise.all([
    import('jspdf'),
    ...shots.map((shot) => prepare(shot.url)),
  ]);

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  pages.forEach((page, i) => {
    if (i > 0) pdf.addPage();

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('Shiv Hardware Store', MARGIN, MARGIN + 4);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    const line = [
      voucher.vchLabel,
      voucher.party,
      shortDate(voucher.date),
      voucher.refNo ? `Ref ${voucher.refNo}` : null,
      voucher.amount != null ? rupees(voucher.amount) : null,
      pages.length > 1 ? `${i + 1} of ${pages.length}` : null,
    ]
      .filter(Boolean)
      .join('   ·   ');
    pdf.text(line, MARGIN, MARGIN + 20);

    pdf.setDrawColor(180);
    pdf.line(MARGIN, MARGIN + 28, A4.w - MARGIN, MARGIN + 28);

    // The photo keeps its aspect ratio and fills whatever is left of the page.
    // The alias is given rather than left to jsPDF, which would otherwise hash
    // the whole image to invent one.
    pdf.addImage(
      page.dataUrl,
      'JPEG',
      MARGIN + (BOX.w - page.w) / 2,
      TOP,
      page.w,
      page.h,
      `bill-${i}`
    );
  });

  pdf.save(
    `${clean(voucher.vchLabel) || 'bill'} ${clean(voucher.party)} ${shortDate(voucher.date).replace(/\//g, '-')}.pdf`
  );
}

/**
 * An account's statement as a PDF, to send — what Print lays out
 * (PrintPacket): the statement, written as text rather than photographed so
 * it is sharp at any zoom, then a page for every bill photo on the account,
 * each headed by its voucher. `onPhoto(done, of)` says how far the photos have
 * got, for the button.
 */
export async function statementPdf(data, { onPhoto } = {}) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const { account } = data;
  const right = A4.w - MARGIN;
  const bottom = A4.h - MARGIN - 24;   // room for the footer line
  const line = (y, shade = 180) => { pdf.setDrawColor(shade); pdf.line(MARGIN, y, right, y); };
  const font = (size, bold = false) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); };

  // Letterhead: the shop on the left, the document on the right.
  font(15, true);
  pdf.text(SHOP, MARGIN, MARGIN + 10);
  font(8.5);
  pdf.text('Shivaji Road, Near Gandhi Highschool, Ramgarh Cantt - 829122', MARGIN, MARGIN + 24);
  pdf.text('8092850954, 9835350954', MARGIN, MARGIN + 35);
  font(12, true);
  pdf.text('Statement of Account', right, MARGIN + 10, { align: 'right' });
  font(8.5);
  pdf.text(`Printed ${longDate(Date.now())}`, right, MARGIN + 24, { align: 'right' });
  line(MARGIN + 44, 60);

  // The account on the left, its figures on the right. Aadhaar shows only its
  // last four digits, as on paper — a sent statement can end up anywhere.
  let y = MARGIN + 64;
  font(7.5, true);
  pdf.text('ACCOUNT', MARGIN, y);
  font(12, true);
  pdf.text(account.name, MARGIN, y + 15, { maxWidth: 270 });
  font(9);
  [
    account.place,
    [phoneDisplay(account.phone), phoneDisplay(account.phone2)].filter(Boolean).join(' / '),
    account.gstin && `GSTIN ${account.gstin}`,
    account.aadhaar && `Aadhaar XXXX XXXX ${String(account.aadhaar).slice(-4)}`,
  ].filter(Boolean).forEach((text, i) => pdf.text(text, MARGIN, y + 30 + i * 12));

  const figures = [
    [`Opening as at ${shortDate(data.openingAsOf)}`, `${rupees(data.opening)} ${data.openingSide}`],
    ['Total debit', rupees(data.totals.debit)],
    ['Total credit', rupees(data.totals.credit)],
    ['Closing balance', `${rupees(data.closing)} ${data.closingSide}`],
  ];
  const figLeft = right - 220;
  figures.forEach(([label, value], i) => {
    const last = i === figures.length - 1;
    const fy = y + i * 15;
    if (last) line(fy - 10, 120);
    font(9, last);
    pdf.text(label, figLeft, fy);
    pdf.text(value, right, fy, { align: 'right' });
  });

  y += 80;
  font(9);
  const owing = data.closingSide === 'Cr' ? `Payable by ${SHOP}` : `Receivable by ${SHOP}`;
  pdf.text(`${rupeesInWords(data.closing)} - ${owing}`, MARGIN, y, { maxWidth: right - MARGIN });
  y += 20;

  // The entries. Particulars takes what the fixed columns leave, and wraps.
  const cols = [
    { label: 'Date', w: 48 },
    { label: 'Vch', w: 56 },
    { label: 'Type', w: 78 },
    { label: 'Ref', w: 56 },
    { label: 'Particulars', w: 0 },
    { label: 'Debit', w: 68, num: true },
    { label: 'Credit', w: 68, num: true },
  ];
  cols[4].w = right - MARGIN - cols.reduce((t, c) => t + c.w, 0);
  let x = MARGIN;
  for (const c of cols) { c.x = x; x += c.w; }
  const PAD = 3;
  const LH = 10.5;

  const header = () => {
    font(8, true);
    cols.forEach((c) => pdf.text(c.label, c.num ? c.x + c.w - PAD : c.x + PAD, y, c.num ? { align: 'right' } : undefined));
    line(y + 4, 60);
    y += 15;
  };
  // `span`: the second cell runs on across Type, Ref and Particulars, as the
  // opening and closing lines do on paper.
  const spanW = cols[1].w + cols[2].w + cols[3].w + cols[4].w;
  const row = (cells, { bold = false, rule = false, span = false } = {}) => {
    font(8.5, bold);
    const wrapped = cells.map((text, i) =>
      (text ? pdf.splitTextToSize(String(text), (span && i === 1 ? spanW : cols[i].w) - PAD * 2) : []));
    const h = Math.max(1, ...wrapped.map((w) => w.length)) * LH;
    if (y + h > bottom) { pdf.addPage(); y = MARGIN + 10; header(); font(8.5, bold); }
    if (rule) line(y - 8, 120);
    wrapped.forEach((lines, i) => {
      const c = cols[i];
      lines.forEach((text, n) =>
        pdf.text(text, c.num ? c.x + c.w - PAD : c.x + PAD, y + n * LH, c.num ? { align: 'right' } : undefined));
    });
    y += h + 3;
  };

  // Tally's footer, as the printed one: the columns as they stand, the closing
  // balance on the lighter side to square them, then the equal grand totals.
  const openingDr = data.openingSide === 'Dr';
  const totalDr = data.totals.debit + (openingDr ? data.opening : 0);
  const totalCr = data.totals.credit + (openingDr ? 0 : data.opening);
  const closingOnDebit = totalCr > totalDr;
  const grand = Math.max(totalDr, totalCr);

  header();
  row([shortDate(data.openingAsOf), `${openingDr ? 'To' : 'By'} Opening Balance`, '', '', '',
    openingDr ? rupees(data.opening) : '', openingDr ? '' : rupees(data.opening)], { span: true });
  for (const r of data.rows) {
    const particulars = (r.contra ?? []).join(', ') || '-';
    row([
      shortDate(r.date),
      r.vchLabel,
      `${r.side === 'Dr' ? 'To' : 'By'} ${rowType(r)}`,
      r.refNo || '-',
      r.narration && r.narration !== r.vchType ? `${particulars} - ${r.narration}` : particulars,
      r.side === 'Dr' ? rupees(r.amount) : '',
      r.side === 'Cr' ? rupees(r.amount) : '',
    ]);
  }
  row(['', '', '', '', '', rupees(totalDr), rupees(totalCr)], { rule: true });
  row(['', `${closingOnDebit ? 'To' : 'By'} Closing Balance`, '', '', '',
    closingOnDebit ? rupees(data.closing) : '', closingOnDebit ? '' : rupees(data.closing)], { span: true });
  row(['', '', '', '', '', rupees(grand), rupees(grand)], { bold: true, rule: true });

  // Bills with no amount yet: listed by name, so a statement sent for one of
  // them shows it, and its photo follows on its own page.
  const waiting = data.pending ?? [];
  if (waiting.length) {
    y += 14;
    if (y + 30 > bottom) { pdf.addPage(); y = MARGIN + 10; }
    font(9, true);
    pdf.text('Waiting for an amount (not in the balance above)', MARGIN, y);
    y += 16;
    for (const p of waiting) {
      row([shortDate(p.date), p.vchLabel, p.vchType, p.refNo || '-', 'Amount to come', '', '']);
    }
  } else if (data.pendingCount > 0) {
    y += 6;
    font(8.5);
    const one = data.pendingCount === 1;
    pdf.text(`${data.pendingCount} ${one ? 'bill is' : 'bills are'} filed without an amount and ${one ? 'is' : 'are'} not included above.`, MARGIN, y);
  }

  // Signed for the shop, on whichever page the table ended.
  if (y + 60 > bottom) { pdf.addPage(); y = MARGIN; }
  y += 40;
  font(9);
  pdf.text(`For ${SHOP}`, right, y, { align: 'right' });
  pdf.setDrawColor(120);
  pdf.line(right - 140, y + 26, right, y + 26);
  pdf.text('Proprietor', right, y + 38, { align: 'right' });

  // A page for every bill photo, as Print adds them. A photo is placed as it
  // is; a PDF document by the picture of it the books keep. Read a few at a
  // time — all at once, a long account would hold every photo in memory.
  // Bills still waiting for their amount are sent too: their photo is often
  // the whole reason for sending (SAL-0572, Harsh — a sale with no figure yet).
  const shots = [...data.rows, ...(data.pending ?? [])]
    .flatMap((r) => (r.attachmentUrls ?? []).map((shot) => ({ r, shot })));
  const BATCH = 4;
  for (let i = 0; i < shots.length; i += BATCH) {
    const batch = shots.slice(i, i + BATCH);
    const pictures = await Promise.all(batch.map(({ shot }) =>
      prepare(String(shot.contentType ?? '').startsWith('image/') ? shot.url : shot.previewUrl ?? shot.url)
        .catch(() => null)));
    batch.forEach(({ r, shot }, n) => {
      const picture = pictures[n];
      pdf.addPage();
      font(11, true);
      pdf.text(SHOP, MARGIN, MARGIN + 4);
      font(9);
      pdf.text([
        r.vchLabel,
        shot.label ? shot.label.charAt(0).toUpperCase() + shot.label.slice(1) : null,
        shortDate(r.date),
        r.refNo ? `Ref ${r.refNo}` : null,
        r.amount != null ? rupees(r.amount) : null,
      ].filter(Boolean).join('   ·   '), MARGIN, MARGIN + 20);
      line(MARGIN + 28);
      if (picture) {
        pdf.addImage(picture.dataUrl, 'JPEG', MARGIN + (BOX.w - picture.w) / 2, TOP, picture.w, picture.h, `shot-${i + n}`);
      } else {
        font(10);
        pdf.text('This document could not be added. Ask the shop for a copy.', MARGIN, TOP + 20);
      }
    });
    onPhoto?.(Math.min(i + BATCH, shots.length), shots.length);
  }

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    font(7.5);
    pdf.setTextColor(110);
    pdf.text(`Statement of Account · ${account.name}`, MARGIN, A4.h - MARGIN, { maxWidth: 330 });
    pdf.text(pages > 1 ? `Page ${p} of ${pages}` : `${SHOP} · Ramgarh Cantt`, right, A4.h - MARGIN, { align: 'right' });
    pdf.setTextColor(0);
  }

  const name = `Statement ${clean(account.name)} ${shortDate(Date.now()).replace(/\//g, '-')}.pdf`;
  return { blob: pdf.output('blob'), name };
}
