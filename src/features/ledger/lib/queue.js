import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { asImages, crop, shrink } from './image';

// Enough to keep a phone's uplink busy without starving the shutter of CPU.
const LANES = 3;
const TRIES = 3;

let seq = 0;

/**
 * Photos go in here and the caller carries on immediately — nothing waits on
 * an upload. That is the whole point: on a counter with a stack of bills, the
 * shutter has to stay ready while the last shot is still climbing the wire.
 *
 * Each photo is shrunk, uploaded and filed to the inbox on its own, with a few
 * running at a time. Failures keep their thumbnail and can be retried; they
 * are never dropped silently.
 */
export function useUploadQueue() {
  const addToInbox = useMutation(api.inbox.add);
  const [items, setItems] = useState([]);

  const waiting = useRef([]);
  const store = useRef(new Map());   // id -> the full item, so retry has the file
  const running = useRef(0);
  const alive = useRef(true);
  const addRef = useRef(addToInbox);
  addRef.current = addToInbox;
  const pushRef = useRef(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const patch = useCallback((id, fields) => {
    if (!alive.current) return;
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...fields } : it)));
  }, []);

  const send = useCallback(
    async (item) => {
      patch(item.id, { status: 'sending' });
      // Cropped and shrunk here on the phone. This runs in the queue's own
      // lane, never on the shutter — a frame is filed the instant it is taken
      // and squared up on the way out, so a stack of bills is still a run of
      // taps. The Mac's pipeline is asked first only for what a browser cannot
      // do at all: a PDF, or a format it will not decode.
      const { file } = item;
      // A PDF dropped in here is rendered to images first; only the first
      // page rides this item, the rest are queued behind it. Nothing reaches
      // storage as a PDF.
      const [first, ...more] = await asImages(item.file);
      if (more.length) item.extraPages = more;
      const prepared = await shrink(await crop(first));
      const url = await item.getUploadUrl();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': prepared.type || 'application/octet-stream' },
        body: prepared,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = await res.json();
      await addRef.current({ storageId, groupId: item.groupId });
      patch(item.id, { status: 'done' });

      // A multi-page PDF arrives as one item and leaves as several, grouped so
      // they stay one bill.
      if (item.extraPages?.length) {
        const groupId = item.groupId ?? `p${Date.now().toString(36)}`;
        pushRef.current(item.extraPages, item.getUploadUrl, groupId);
        item.extraPages = undefined;
      }
    },
    [patch]
  );

  const pump = useCallback(() => {
    while (running.current < LANES && waiting.current.length > 0) {
      const item = waiting.current.shift();
      running.current += 1;
      send(item)
        .catch((err) => {
          const tries = item.tries + 1;
          if (tries < TRIES) {
            // Back off a little, then let it go round again.
            item.tries = tries;
            setTimeout(() => {
              waiting.current.push(item);
              pump();
            }, 400 * tries);
            patch(item.id, { status: 'queued' });
          } else {
            patch(item.id, { status: 'failed', error: err.message ?? String(err) });
          }
        })
        .finally(() => {
          running.current -= 1;
          pump();
        });
    }
  }, [send, patch]);

  /** Hands back at once — the upload happens behind the caller. */
  const push = useCallback(
    (files, getUploadUrl, groupId) => {
      const fresh = Array.from(files).map((file) => ({
        id: `q${++seq}`,
        file,
        getUploadUrl,
        groupId,
        tries: 0,
        thumb: URL.createObjectURL(file),
        at: Date.now(),
      }));
      if (fresh.length === 0) return;
      setItems((list) => [
        ...fresh.map(({ id, thumb, at }) => ({ id, thumb, at, groupId, status: 'queued' })),
        ...list,
      ]);
      fresh.forEach((item) => store.current.set(item.id, item));
      waiting.current.push(...fresh);
      pump();
    },
    [pump]
  );

  const retry = useCallback(
    (id) => {
      const item = store.current.get(id);
      if (!item || waiting.current.some((w) => w.id === id)) return;
      item.tries = 0;
      patch(id, { status: 'queued', error: undefined });
      waiting.current.push(item);
      pump();
    },
    [patch, pump]
  );

  /** Drops the finished thumbnails once they are safely on the server. */
  const clearDone = useCallback(() => {
    setItems((list) => {
      list
        .filter((it) => it.status === 'done')
        .forEach((it) => {
          URL.revokeObjectURL(it.thumb);
          store.current.delete(it.id);
        });
      return list.filter((it) => it.status !== 'done');
    });
  }, []);

  const pending = items.filter((it) => it.status === 'queued' || it.status === 'sending').length;
  const failed = items.filter((it) => it.status === 'failed').length;

  pushRef.current = push;

  return { items, push, retry, clearDone, pending, failed };
}
