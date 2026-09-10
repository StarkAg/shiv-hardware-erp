import React, { useEffect, useRef, useState } from 'react';

const MAX_EDGE = 1800;

/**
 * A detached copy of what was just drawn, for browsers without
 * transferToImageBitmap. Costs one blit, which is still far less than encoding.
 */
function await_free_copy(canvas, width, height) {
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  copy.width = width;
  copy.height = height;
  copy.getContext('2d').drawImage(canvas, 0, 0);
  return copy;
}
const QUALITY = 0.82;

/**
 * A camera that stays open.
 *
 * The file-input camera (`capture="environment"`) closes after every single
 * shot and hands back one file, which makes photographing a stack of bills a
 * chore — tap, shoot, confirm, wait, tap again. This holds one video stream
 * open and grabs a frame per press, so a pile of bills is a run of taps.
 *
 * Frames are captured at bill-legible size, so what leaves here is already
 * small enough to upload without anyone waiting on it.
 */
export default function LiveCamera({ onShot, onUnavailable, controls }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [ready, setReady] = useState(false);
  // Kept between shots: allocating a canvas per press is churn the shutter feels.
  const shot = useRef(null);
  const frame = useRef(null);
  const [torch, setTorch] = useState(null);   // null = the camera has no lamp

  useEffect(() => {
    let stop = false;

    const start = async () => {
      // A camera is only offered on a secure origin. On the phone that means
      // HTTPS — plain http://192.168.x.x will not be asked.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        onUnavailable?.(
          window.isSecureContext
            ? 'This browser will not open a camera here.'
            : 'A live camera needs a secure connection — open the https address.'
        );
        return;
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 2400 },
            height: { ideal: 1800 },
          },
          audio: false,
        });
        if (stop) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => {});
        }
        const track = media.getVideoTracks()[0];
        const canTorch = track?.getCapabilities?.().torch;
        setTorch(canTorch ? false : null);
        setReady(true);
      } catch (err) {
        onUnavailable?.(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was refused — allow it in the browser and reload.'
            : 'No camera could be opened here.'
        );
      }
    };

    start();
    return () => {
      stop = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [onUnavailable]);

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorch(next);
    } catch {
      setTorch(null);          // the lamp said no; stop offering it
    }
  };

  /**
   * Freeze the frame now, encode it later.
   *
   * A press has to feel finished the instant it lands, so the only work done
   * on the button's own turn is a drawImage into a canvas that already exists
   * — a millisecond or two. Encoding the JPEG is handed to the next frame, and
   * to a worker thread where the browser has OffscreenCanvas, so pressing
   * again immediately is never blocked by the previous shot.
   *
   * The flash is back, and short. A press with no answer at all is the thing
   * that really reads as a stall — the ring this replaced was written into the
   * stylesheet and never actually put on the element, so the shutter had been
   * giving nothing back. Eighty milliseconds of white is about two frames more
   * than the eye needs to be certain, and less than it takes to feel covered.
   *
   * Toggled straight onto the node, never through state: a re-render on the
   * button's own turn is exactly the cost this whole path exists to avoid.
   */
  const take = () => {
    const el = video.current;
    if (!el || !el.videoWidth) return;

    // First thing, before any pixels move, so the flash lands on this turn's
    // paint. Removed and re-added with a reflow between, or a second press
    // inside the animation would get no flash at all.
    const stage = frame.current;
    if (stage) {
      stage.classList.remove('snap');
      void stage.offsetWidth;
      stage.classList.add('snap');
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(el.videoWidth, el.videoHeight));
    const width = Math.round(el.videoWidth * scale);
    const height = Math.round(el.videoHeight * scale);

    let canvas = shot.current;
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement('canvas'), { width, height });
      canvas.width = width;
      canvas.height = height;
      shot.current = canvas;
    }
    canvas.getContext('2d').drawImage(el, 0, 0, width, height);

    // The frame has to leave the shared canvas before the next press can
    // overwrite it. transferToImageBitmap hands the pixels over and empties the
    // canvas in one cheap move; without it, firing twice quickly would encode
    // the second frame twice and lose the first.
    const held = canvas.transferToImageBitmap
      ? canvas.transferToImageBitmap()
      : await_free_copy(canvas, width, height);

    const at = Date.now();
    const encode = async () => {
      // A canvas of its own, so nothing later can touch this frame.
      const out =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement('canvas'), { width, height });
      out.width = width;
      out.height = height;
      out.getContext('2d').drawImage(held, 0, 0);
      held.close?.();

      const blob = out.convertToBlob
        ? await out.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
        : await new Promise((done) => out.toBlob(done, 'image/jpeg', QUALITY));
      if (!blob) return;
      onShot(
        new File([blob], `bill-${at}.jpg`, { type: 'image/jpeg', lastModified: at })
      );
    };
    // Off this turn, so the button is free before the encoder starts.
    requestAnimationFrame(() => { encode(); });
  };

  return (
    <div className="cam">
      <div className="cam-stage" ref={frame}>
        <video ref={video} playsInline muted autoPlay />
        {torch !== null && (
          <button
            type="button"
            className={`cam-torch${torch ? ' on' : ''}`}
            onClick={toggleTorch}
            aria-label="Torch"
          >
            ⚡
          </button>
        )}
      </div>

      {/* Whatever the caller uses to shoot. The camera owns the stream and the
          frame grab; what the buttons mean is not its business. */}
      <div className="cam-controls">{controls?.({ take, ready })}</div>

      <div className="cam-hint">
        {ready ? 'Keep shooting — each one sends on its own' : 'Starting the camera…'}
      </div>
    </div>
  );
}
