import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Paperclip, X } from 'lucide-react'
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { shortDate } from '../lib/format';

const OK = (f) => f.type.startsWith('image/') || f.type === 'application/pdf';
const key = (f) => `${f.name}:${f.size}:${f.lastModified}`;

const size = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * Where the bill photo goes in: dropped, pasted, or picked. Dropping is what
 * the laptop uses — the phone photo lands in a folder and gets dragged
 * straight onto the voucher — and pasting catches a screenshot without it
 * ever becoming a file.
 */
export default function BillDrop({ files, onChange, picked = [], onPick, onViewBill }) {
  // Anything the phone has sent in and nobody has filed yet.
  const fromPhone = useLive(api.inbox.list, {}, 'inbox') ?? [];
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
      if (done.has(row.groupId)) continue;
      done.add(row.groupId);
      out.push({
        key: row.groupId,
        // Pages read in the order they were shot, whatever order they land in.
        pages: fromPhone
          .filter((r) => r.groupId === row.groupId)
          .sort((a, b) => a.at - b.at),
      });
    }
    return out;
  }, [fromPhone]);

  const isPicked = (unit) => unit.pages.every((r) => picked.some((p) => p._id === r._id));

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
      label: 'photo',
      contentType: 'image/jpeg',
    }));

  const [over, setOver] = useState(false);
  const input = useRef(null);

  const shots = useMemo(
    () =>
      files.map((file) => ({
        file,
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
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
      {fromPhone.length > 0 && onPick && (
        <div className="fromphone">
          <div className="fromphone-head">From the phone</div>
          <div className="shots">
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
                  <button type="button" className="shot-pick" onClick={() => toggle(unit)}>
                    <img src={cover.url} alt="" loading="lazy" />
                  </button>
                  {many && (
                    <span className="shot-page">{unit.pages.length} pages</span>
                  )}
                  <span className="shot-when">{shortDate(cover.at)}</span>
                  {isPicked(unit) && <span className="shot-tick"><Check size={12} aria-hidden="true" /></span>}
                  {(
                    <button
                      type="button"
                      className="shot-zoom"
                      aria-label={many ? 'See all pages' : 'See it bigger'}
                      onClick={(e) => {
                        e.stopPropagation();
                        const shown = {
                          party: many ? `From the phone · ${unit.pages.length} pages` : 'From the phone',
                          date: cover.at,
                          vchLabel: '',
                          attachmentUrls: asAttachments(unit.pages),
                        };
                        // Where there is a viewer it opens there; where there
                        // is not, the photograph opens on its own rather than
                        // the button doing nothing.
                        if (onViewBill) onViewBill(shown);
                        else window.open(cover.url, '_blank', 'noopener');
                      }}
                    >
                      ⤢
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
              {s.url ? (
                <img src={s.url} alt="" />
              ) : (
                <span className="shot-pdf">PDF</span>
              )}
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
