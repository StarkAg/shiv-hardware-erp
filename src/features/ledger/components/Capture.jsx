import React, { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react'
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import { useUploadQueue } from '../lib/queue';
import LiveCamera from './LiveCamera';
import AutoTag from './AutoTag';

const ago = (ms) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

/**
 * The phone's whole screen: photograph a bill, and it is on the shop's ledger
 * before the phone is back in a pocket. Nothing is filed here — which voucher
 * a bill belongs to is decided at the counter, on a screen big enough to read
 * an account.
 */
export default function Capture() {
  const shots = useLive(api.inbox.list, {}, 'inbox') ?? [];
  const discard = useMutation(api.inbox.discard);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const { items, push, retry, clearDone, pending, failed } = useUploadQueue();
  const [noCamera, setNoCamera] = useState('');
  /**
   * Two shutters, 1 and 2. Both take a photograph; which one you press is what
   * says where the bill ends.
   *
   * Keep pressing the same shutter and the sheets pile into one bill. Press the
   * other and that bill is finished and a new one begins — so a two-sheet bill
   * is 1,1 then 2, and a run of single bills is just 1,2,1,2. There is no mode
   * to remember and nothing to switch off: the alternation is the boundary,
   * and a run of one photograph is simply a bill of one page.
   */
  const [run, setRun] = useState({ button: null, id: null, count: 0 });
  const tags = useLive(api.tags.settings, {}, 'tags:settings') ?? {
    tagNames: [], autoTag: null,
  };
  // Which shutter was pressed; the frame arrives a moment later.
  const pressed = useRef('1');

  const getUploadUrl = useCallback(() => generateUploadUrl(), [generateUploadUrl]);
  // Returns straight away; the queue carries the photo the rest of the way.
  const shoot = useCallback(
    (button, files) => {
      // A different button from last time means the previous bill is closed.
      const fresh = button !== run.button;
      const id = fresh ? `${button}${Date.now().toString(36)}` : run.id;
      push(files, getUploadUrl, id);
      setRun({
        button,
        id,
        count: (fresh ? 0 : run.count) + Array.from(files).length,
      });
    },
    [push, getUploadUrl, run]
  );

  // The fallback picker has no shutter of its own to alternate with.
  const take = useCallback((files) => shoot(run.button ?? 'a', files), [shoot, run.button]);

  const unavailable = useCallback((why) => setNoCamera(why), []);

  const inFlight = items.filter((it) => it.status !== 'done');

  return (
    <div className="capture">
      <header className="capture-head">
        <img className="logo" src="/logo.png" alt="" width="38" height="38" />
        <div>
          <div className="brand">Camera</div>
          <div className="sub">Shiv Hardware · Ramgarh</div>
        </div>
        {(pending > 0 || failed > 0) && (
          <div className={`sendstate${failed ? ' bad' : ''}`}>
            {failed > 0 ? `${failed} stuck` : `sending ${pending}`}
          </div>
        )}
      </header>

      {/* The mark is chosen here, before a batch, because this is the screen
          somebody is standing in front of when they start shooting one. */}
      <div className="capture-tag">
        <AutoTag autoTag={tags.autoTag} names={tags.tagNames} compact />
      </div>

      {noCamera ? (
        <div className="cam-fallback">
          <p className="note">{noCamera}</p>
          <label className="shutter">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => {
                take(e.target.files ?? []);
                e.target.value = '';
              }}
            />
            <span className="shutter-ring" aria-hidden="true" />
            <span className="shutter-text">Take photo</span>
          </label>
        </div>
      ) : (
        <LiveCamera
          onUnavailable={unavailable}
          onShot={(file) => shoot(pressed.current, [file])}
          controls={({ take: grab, ready }) =>
            ['1', '2'].map((id) => (
              <button
                type="button"
                key={id}
                className={`cam-shutter two${run.button === id ? ' on' : ''}`}
                disabled={!ready}
                aria-label={`Take photo — shutter ${id}`}
                onClick={() => {
                  pressed.current = id;
                  grab();
                }}
              >
                <span className="cam-ring" />
                <span className="cam-shutter-label">{id}</span>
                {run.button === id && run.count > 0 && (
                  <span className="cam-shutter-count">{run.count}</span>
                )}
              </button>
            ))
          }
        />
      )}

      {/* Everything still on its way up, newest first. A thumbnail appears the
          instant the shutter fires — the upload catches up behind it. */}
      {run.count > 1 && (
        <div className="groupbar">
          <span>
            Shutter {run.button}: {run.count} sheets in this bill. Press the other
            shutter to start the next one.
          </span>
        </div>
      )}

      {inFlight.length > 0 && (
        <div className="outbox">
          <div className="outbox-head">
            <span>{pending > 0 ? `Sending ${pending}` : `${failed} could not send`}</span>
            {items.some((it) => it.status === 'done') && (
              <button className="link" onClick={clearDone}>clear sent</button>
            )}
          </div>
          <div className="shots">
            {inFlight.map((it) => (
              <div className={`shot-tile out ${it.status}`} key={it.id}>
                <img src={it.thumb} alt="" />
                {it.status === 'failed' ? (
                  <button className="shot-retry" onClick={() => retry(it.id)}>retry</button>
                ) : (
                  <span className="shot-dot" aria-label={it.status} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="capture-count">
        {shots.length === 0 ? 'Nothing waiting' : `${shots.length} waiting to be filed`}
      </div>

      <div className="capture-grid">
        {shots.map((s) => (
          <div className="capture-tile" key={s._id}>
            <img src={s.url} alt="" loading="lazy" />
            <span className="capture-when">{ago(s.at)}</span>
            <button
              className="shot-x"
              onClick={() => discard({ id: s._id })}
              aria-label="Discard"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
