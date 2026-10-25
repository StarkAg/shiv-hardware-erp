import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from 'convex/react';
import { Check, Paperclip, Ungroup, Unlink, X } from 'lucide-react'
import { api } from '../../../../convex/_generated/api';
import { shortDate } from '../lib/format';
import Confirm from './Confirm';
import PhotoHoverZoom, { placeZoomPane, zoomGeometry } from './PhotoHoverZoom';
import BillViewer from './BillViewer';
import { AttachmentThumbnail } from '../../../components/AttachmentViewer';
import { usePhoneQueue, usePhonePhotoActions } from '../../../lib/phonePhotos';

const OK = (f) => f.type.startsWith('image/') || f.type === 'application/pdf';
const key = (f) => `${f.name}:${f.size}:${f.lastModified}`;

const size = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
const queueLabel = (number) => String(number).padStart(4, '0');
const queueNumbers = (unit) => unit.pages
  .filter((page) => page.queueNo != null)
  .map((page) => page.queueNo);
const queueSummary = (unit) => {
  const numbers = queueNumbers(unit);
  if (!numbers.length) return '';
  if (numbers.length === 1) return `#${queueLabel(numbers[0])}`;
  const contiguous = numbers.every((number, index) => number === numbers[0] + index);
  return contiguous
    ? `#${queueLabel(numbers[0])}–#${queueLabel(numbers.at(-1))}`
    : `#${queueLabel(numbers[0])} +${numbers.length - 1}`;
};

/**
 * Where the bill photo goes in: dropped, pasted, or picked. Dropping is what
 * the laptop uses — the phone photo lands in a folder and gets dragged
 * straight onto the voucher — and pasting catches a screenshot without it
 * ever becoming a file.
 */
export default function BillDrop({ files, onChange, picked = [], onPick, onViewBill, attached = [], stepRef, onPosition, onWaiting, onDetach }) {
  const saved = useQuery(api.files.describe, attached.length ? { storageIds: attached.map((file) => file.storageId) } : 'skip');
  // Both phone queues as one list, read and acted on as every screen does
  // (lib/phonePhotos): a photo filed or thrown away leaves it at once.
  const queue = usePhoneQueue();
  const fromPhone = useMemo(() => queue ?? [], [queue]);
  const phonePhotos = usePhonePhotoActions();
  /**
   * A bill of several sheets is one thing to file, so it is one thing here —
   * a stack, not three loose photos scattered down a newest-first list where
   * nothing says they belong together.
   */
  const units = useMemo(() => {
    const out = [];
    const done = new Set();
    for (const row of fromPhone) {
      if (!row.groupId) {
        out.push({ key: row._id, pages: [row] });
        continue;
      }
      const groupKey = `${row.source}:${row.groupId}`;
      if (done.has(groupKey)) continue;
      done.add(groupKey);
      out.push({
        key: groupKey,
        // Pages read in the order they were shot, whatever order they land in.
        pages: fromPhone
          .filter((r) => r.source === row.source && r.groupId === row.groupId)
          .sort((a, b) => a.at - b.at),
      });
    }
    return out;
  }, [fromPhone]);

  const isPicked = (unit) => unit.pages.every((r) => picked.some((p) => p._id === r._id));

  /**
   * The arrows on the bill photo beside the form: the picked bill is swapped
   * for the tile before or after it, in the order the tiles are shown, so the
   * next bill can be typed without going back to the tiles. Where the picked
   * bill sits is reported for the "#0150 · 1 of 9" between the arrows.
   */
  const pickedAt = units.findIndex((unit) => isPicked(unit));
  useEffect(() => {
    if (stepRef) {
      stepRef.current = (dir) => {
        const at = units.findIndex((unit) => isPicked(unit));
        const target = units[(at < 0 ? (dir > 0 ? -1 : units.length) : at) + dir];
        if (!target) return false;
        const drop = new Set((at >= 0 ? units[at].pages : []).map((r) => r._id));
        onPick?.([...picked.filter((p) => !drop.has(p._id)), ...target.pages]);
        return true;
      };
    }
    onPosition?.(pickedAt >= 0 ? { index: pickedAt, count: units.length, label: queueSummary(units[pickedAt]) } : null);
  });

  const toggle = (unit) => {
    const ids = new Set(unit.pages.map((r) => r._id));
    const rest = picked.filter((p) => !ids.has(p._id));
    onPick?.(isPicked(unit) ? rest : [...rest, ...unit.pages]);
  };

  const asAttachments = (pages) =>
    pages.map((r) => ({
      storageId: r.storageId,
      url: r.url,
      previewUrl: r.url,
      kind: 'photo',
      label: r.queueNo == null ? 'photo' : `#${queueLabel(r.queueNo)}`,
      contentType: 'image/jpeg',
    }));

  /** A waiting bill as the viewer takes it: its pages, and where it came from. */
  const shownOf = (unit) => ({
    party: unit.pages.length > 1 ? `From the phone · ${unit.pages.length} pages` : 'From the phone',
    date: unit.pages[0].at,
    vchLabel: '',
    attachmentUrls: asAttachments(unit.pages),
  });
  /**
   * The first bill photo still waiting to be filed, told to whoever asks
   * (`onWaiting`) once the phone's queue has loaded and again whenever it is a
   * different one: null when nothing waits. A new voucher opens it beside the
   * form, so the entry starts from the paper without a click.
   */
  const queueLoaded = queue !== undefined;
  const firstWaiting = units[0]?.key ?? '';
  useEffect(() => {
    if (!onWaiting || !queueLoaded) return;
    onWaiting(units[0] ? { key: units[0].key, shown: shownOf(units[0]) } : null);
  }, [queueLoaded, firstWaiting]);

  const [over, setOver] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  // A file already on the bill, about to be taken off it.
  const [toDetach, setToDetach] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [preview, setPreview] = useState(null);
  const input = useRef(null);
  const hoverClose = useRef(null);
  const clearHoverClose = () => { if (hoverClose.current) clearTimeout(hoverClose.current); hoverClose.current = null; };
  const hideMagnifier = () => {
    clearHoverClose();
    // The enlarged view takes no mouse, so there is nothing to travel to:
    // it goes the moment the thumbnail is left, or switches to the next one.
    setHovered(null);
  };
  useEffect(() => () => { if (hoverClose.current) clearTimeout(hoverClose.current); }, []);
  const viewBill = (shown) => {
    setHovered(null);
    if (onViewBill) onViewBill(shown);
    else setPreview(shown);
  };

  useEffect(() => {
    if (!hovered) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setHovered(null);
    };
    const onScrollOrResize = () => setHovered(null);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [hovered]);

  const openViewer = (unit) => {
    clearHoverClose();
    setHovered(null);
    viewBill(shownOf(unit));
  };

  const showMagnifier = (event, unit) => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    clearHoverClose();
    const image = event.currentTarget.querySelector('img');
    if (!image) return;
    const rect = image.getBoundingClientRect();
    const tile = {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    };
    const pane = placeZoomPane(tile, { width: window.innerWidth, height: window.innerHeight });
    const zoom = zoomGeometry(
      tile,
      { width: image.naturalWidth || rect.width, height: image.naturalHeight || rect.height },
      pane,
      { x: event.clientX, y: event.clientY }
    );
    setHovered({ unit, pane, zoom });
  };

  const deleteUnit = async (unit) => {
    const removed = new Set();
    try {
      await phonePhotos.discard(unit.pages, (id) => removed.add(id));
    } finally {
      if (removed.size) onPick?.(picked.filter((page) => !removed.has(page._id)));
    }
  };

  /** A stack that is really several bills becomes one tile per page. */
  const [splitting, setSplitting] = useState(null);
  const splitUnit = async (unit) => {
    setHovered(null);
    setSplitting(unit.key);
    try {
      await phonePhotos.split(unit.pages);
    } finally {
      setSplitting(null);
    }
  };

  const shots = useMemo(
    () =>
      files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    [files]
  );

  // Object URLs are handed back as soon as the set of files changes.
  useEffect(
    () => () => shots.forEach((s) => s.url && URL.revokeObjectURL(s.url)),
    [shots]
  );

  const add = (incoming) => {
    const keep = Array.from(incoming).filter(OK);
    if (keep.length === 0) return;
    const seen = new Set(files.map(key));
    onChange([...files, ...keep.filter((f) => !seen.has(key(f)))]);
  };

  // A bill copied to the clipboard can be pasted straight onto the voucher.
  useEffect(() => {
    const onPaste = (e) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        add(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className="drop-wrap">
      {attached.length > 0 && <div className="saved-attachments">
        <div className="fromphone-head">Attached to this bill</div>
        {!saved ? <p role="status">Loading attachments…</p> : <div className="shots">
          {saved.map((file, index) => <div className="shot-tile" key={file.storageId}>
            <button type="button" className="shot-pick" aria-label={'View attached file ' + (index + 1)}
              onClick={() => viewBill({ attachmentUrls: saved, initialIndex: index })}>
              <AttachmentThumbnail file={file} />
            </button>
            {onDetach && <button type="button" className="shot-detach" title="Detach from this bill"
              aria-label={'Detach attached file ' + (index + 1) + ' from this bill'}
              onClick={() => setToDetach(file)}>
              <Unlink size={14} aria-hidden="true" />
            </button>}
          </div>)}
        </div>}
      </div>}
      {onPick && (
        <div className="fromphone">
          <div className="fromphone-head">From the phone</div>
          {queue === undefined
            ? <p className="hint" role="status">Loading phone photos…</p>
            : units.length === 0
              ? <p className="hint">No bill photos are waiting. Take photos in the voucher shooter, then return here.</p>
              : <div className="shots">
            {units.map((unit) => {
              const cover = unit.pages[0];
              const many = unit.pages.length > 1;
              return (
                <div
                  className={`shot-tile pickable${isPicked(unit) ? ' on' : ''}${
                    many ? ' stack' : ''
                  }`}
                  key={unit.key}
                >
                  {/* The leaves behind the cover are what say "more sheets"
                      before anyone reads the count. */}
                  {many && <span className="stack-leaf two" aria-hidden="true" />}
                  {many && <span className="stack-leaf one" aria-hidden="true" />}
                  {/* The photo opens to be read; only the tick box puts it on
                      the voucher. A click on the picture used to pick it, so
                      looking at a bill attached it. */}
                  <button type="button" className="shot-pick"
                    aria-label={`See ${many ? `${unit.pages.length} phone photos` : 'phone photo'} ${queueNumbers(unit).map((number) => `#${queueLabel(number)}`).join(', ')} bigger`}
                    onPointerEnter={(event) => showMagnifier(event, unit)}
                    onPointerMove={(event) => showMagnifier(event, unit)}
                    onPointerLeave={hideMagnifier}
                    onClick={() => openViewer(unit)}>
                    <img src={cover.url} alt="" loading="lazy" />
                  </button>
                  {cover.queueNo != null && <span className="shot-queue" title={queueNumbers(unit).map((number) => `#${queueLabel(number)}`).join(', ')}>{queueSummary(unit)}</span>}
                  {many && (
                    <div className="shot-stackbar">
                      <span className="shot-page">{unit.pages.length} pages</span>
                      <button type="button" className="shot-split"
                        title="Split into separate photos"
                        aria-label={`Split ${unit.pages.length} pages into separate photos`}
                        disabled={splitting === unit.key}
                        onClick={() => splitUnit(unit)}>
                        <Ungroup size={13} aria-hidden="true" />
                        <span>{splitting === unit.key ? 'Splitting' : 'Split'}</span>
                      </button>
                    </div>
                  )}
                  <span className="shot-when">{shortDate(cover.at)}</span>
                  <button type="button" role="checkbox" aria-checked={isPicked(unit)}
                    className={`shot-check${isPicked(unit) ? ' on' : ''}`}
                    aria-label={`Use ${many ? `these ${unit.pages.length} photos` : 'this photo'} on the voucher`}
                    onClick={() => toggle(unit)}>
                    {isPicked(unit) && <Check size={18} strokeWidth={3} aria-hidden="true" />}
                  </button>
                  <button type="button" className="shot-delete"
                    aria-label={`Delete phone photo ${cover.queueNo == null ? '' : `#${queueLabel(cover.queueNo)}`}`}
                    onClick={() => { setHovered(null); setToDelete(unit); }}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>}
        </div>
      )}

      {hovered && createPortal(
        <PhotoHoverZoom
          url={hovered.unit.pages[0].url}
          label={queueSummary(hovered.unit) || 'Phone photo'}
          pane={hovered.pane}
          zoom={hovered.zoom}
        />,
        document.body
      )}

      {toDelete && <Confirm
        title={toDelete.pages.length > 1 ? `Delete ${toDelete.pages.length} photos?` : 'Delete this photo?'}
        body={`${queueNumbers(toDelete).length ? `Queue ${queueNumbers(toDelete).map((number) => `#${queueLabel(number)}`).join(', ')}. ` : ''}This removes ${toDelete.pages.length > 1 ? 'all pages' : 'the photo'} from the waiting queue and cannot be undone.`}
        confirmLabel="Delete photo"
        danger
        requireText="delete"
        requireLabel="Type delete to confirm"
        onConfirm={() => deleteUnit(toDelete)}
        onClose={() => setToDelete(null)}
      />}
      {toDetach && <Confirm
        title="Detach this from the bill?"
        body={(toDetach.contentType ?? '').startsWith('image/')
          ? 'The photo comes off this bill now and goes back under From the phone, to be attached to the right voucher.'
          : 'This file is not a photo, so it cannot wait in the phone queue: it comes off this bill now and is removed for good.'}
        confirmLabel="Detach"
        onConfirm={() => onDetach(toDetach)}
        onClose={() => setToDetach(null)}
      />}
      {preview && <BillViewer voucher={preview} onClose={() => setPreview(null)} />}

      <button
        type="button"
        className={`drop${over ? ' over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <span className="drop-mark"><Paperclip size={13} aria-hidden="true" /></span>
        <span className="drop-text">Drop, paste, or choose</span>
      </button>

      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files ?? []);
          e.target.value = '';   // the same file can be picked again after removal
        }}
      />

      {shots.length > 0 && (
        <div className="shots">
          {shots.map((s, i) => (
            <div className="shot-tile" key={key(s.file)}>
              <button type="button" className="shot-pick" aria-label={'Preview ' + s.file.name}
                onClick={() => viewBill({ initialIndex: i, attachmentUrls: shots.map((shot) => ({
                  url: shot.url, contentType: shot.file.type, name: shot.file.name, label: shot.file.name,
                })) })}>
                <AttachmentThumbnail file={{ url: s.url, contentType: s.file.type }} />
              </button>
              <button
                type="button"
                className="shot-x"
                aria-label="Remove"
                onClick={() => onChange(files.filter((_, n) => n !== i))}
              >
                <X size={16} aria-hidden="true" />
              </button>
              <span className="shot-size">{size(s.file.size)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
