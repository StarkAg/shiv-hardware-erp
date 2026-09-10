import { shortDate, rupees } from './format';

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
    `${clean(voucher.vchLabel) || 'bill'} ${clean(voucher.party)} ${shortDate(voucher.date)}.pdf`
  );
}
