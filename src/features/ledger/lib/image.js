import { DETECT_EDGE, findSheet, sheetSize, warp } from './sheet';

/**
 * Phone photographs are four thousand pixels wide and several megabytes; a
 * bill is readable at a fraction of that. Everything is shrunk in the browser
 * before it is ever uploaded, so nothing waits on a slow upload and nothing
 * waits on a slow download later.
 *
 * `imageOrientation: 'from-image'` applies the EXIF rotation while decoding,
 * which is what stops a phone photo arriving on its side.
 */
const MAX_EDGE = 1800;
const QUALITY = 0.82;
// Detection is done on a small copy; the crop itself is taken from the full
// picture, so nothing is read off a thumbnail and then enlarged.
const CROP_MIN_GAIN = 0.92;   // a crop that saves less than this is not worth it

// The scanning pipeline runs on the shop's Mac. The phone reaches it at the
// same address the app itself was loaded from, on the same scheme — an HTTPS
// page calling http:// is blocked as mixed content before the request leaves.
const SCANNER = `${window.location.protocol}//${window.location.hostname}:5182/scan`;
const SCAN_TIMEOUT = 20000;

/**
 * Hands a document through the pipeline — cropped to the sheet, turned the
 * right way up, and shrunk — before it goes anywhere near Convex.
 *
 * If the scanner is not running the file comes back untouched and the caller
 * shrinks it in the browser instead. A photo is never lost for want of a crop.
 */
export async function scan(file) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), SCAN_TIMEOUT);
  try {
    const res = await fetch(SCANNER, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      signal: control.signal,
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return null;               // not running, or too slow — carry on without it
  } finally {
    clearTimeout(timer);
  }
}

/** The pixels of a bitmap, at a given size, without touching the page. */
function pixels(bitmap, width, height) {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { canvas, ctx, image: ctx.getImageData(0, 0, width, height) };
}

const encode = (canvas, quality) =>
  canvas.convertToBlob
    ? canvas.convertToBlob({ type: 'image/jpeg', quality })
    : new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality));

/**
 * Crops a photograph to the sheet of paper in it, here on the phone.
 *
 * This is what `scan()` above goes to the shop's Mac for — and what the Mac,
 * in practice, does not deliver: run over the bills actually in the books, the
 * contour detector there finds a sheet in one photograph out of nine, because
 * these slips are torn scraps on a printed cloth and their edges are not
 * straight. `sheet.js` looks for paper by its brightness and its lack of
 * colour instead, which is what these photographs actually offer.
 *
 * Nothing is lost when it is unsure: no sheet found, or a crop that barely
 * shrinks the frame, and the original comes back untouched. A bill with a bit
 * of tablecloth around it is entirely usable; one with the last digit of every
 * amount sliced off is not.
 */
export async function crop(file) {
  if (!file.type.startsWith('image/')) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }

  try {
    const shrunk = Math.min(1, DETECT_EDGE / Math.max(bitmap.width, bitmap.height));
    const dw = Math.max(1, Math.round(bitmap.width * shrunk));
    const dh = Math.max(1, Math.round(bitmap.height * shrunk));
    const found = findSheet(pixels(bitmap, dw, dh).image);
    if (!found) return file;

    // The corners were read on the small copy; put them back on the real one.
    const corners = found.corners.map(([x, y]) => [x / shrunk, y / shrunk]);
    const size = sheetSize(corners, MAX_EDGE);
    if (size.width * size.height >= bitmap.width * bitmap.height * CROP_MIN_GAIN) {
      return file;              // barely a crop; leave the photograph alone
    }

    const full = pixels(bitmap, bitmap.width, bitmap.height);
    const warped = warp(full.image, corners, size);
    if (!warped) return file;

    const out =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(size.width, size.height)
        : Object.assign(document.createElement('canvas'), size);
    out.getContext('2d').putImageData(
      new ImageData(warped.data, warped.width, warped.height),
      0,
      0
    );
    const blob = await encode(out, QUALITY);
    if (!blob) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;                // never lose a bill to a failed crop
  } finally {
    bitmap.close?.();
  }
}

export async function shrink(file, max = MAX_EDGE) {
  if (!file.type.startsWith('image/')) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;            // a format the browser cannot decode: send as it is
  }

  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', QUALITY));
  if (!blob || blob.size >= file.size) return file;   // no gain, keep the original

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}

// Wide enough to read a printed invoice, and no wider. Quality is lower than
// a photograph's because a rendered page is flat ink on white — there is no
// grain for the encoder to fight, so 0.7 looks the same as 0.85 and weighs a
// fifth less. A page lands around 250 KB, in line with a phone photo.
const PDF_WIDTH = 1700;
const PDF_QUALITY = 0.7;
const PDF_MAX_PAGES = 12;

/**
 * Turns a PDF into images, here, before anything is uploaded.
 *
 * Nothing in this shop needs a PDF kept as a PDF: every bill ends up looked at
 * on a screen or printed into a packet, and both want pixels. Storing the
 * original means a viewer that has to special-case it, a packet that cannot
 * lay it out beside the photographs, and megabytes for pages of vector text
 * nobody will select. So a PDF becomes one JPEG per page on the way in.
 *
 * Rendering happens in the browser rather than on the shop's Mac, so it works
 * from the phone and whether or not the scanner is running.
 */
export async function pdfToImages(file) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const stem = file.name.replace(/\.pdf$/i, '');
  const out = [];

  for (let n = 1; n <= Math.min(doc.numPages, PDF_MAX_PAGES); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_WIDTH / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    // Pages are transparent where nothing is drawn; on a dark viewer that
    // reads as a black sheet with black ink.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise((done) =>
      canvas.toBlob(done, 'image/jpeg', PDF_QUALITY)
    );
    if (!blob) continue;
    const suffix = doc.numPages > 1 ? ` p${n}` : '';
    out.push(
      new File([blob], `${stem}${suffix}.jpg`, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      })
    );
  }

  doc.destroy?.();
  if (out.length === 0) throw new Error(`${file.name} has no pages to read`);
  return out;
}

/** Anything on its way to storage, as images. A PDF becomes several. */
export async function asImages(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return pdfToImages(file);
  }
  return [file];
}
