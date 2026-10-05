'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * Photographing one side of an identity document.
 *
 * This is not CameraScanner. That one decodes a QR or barcode and hands
 * back a string; the camera is a means and the frame is thrown away. Here
 * the *image is the output* — it gets OCR'd, and then it is kept as the
 * scan of record attached to the person's file. Different job, different
 * component: a card needs a card-shaped guide (the ID is 86x54mm, roughly
 * 1.58:1) rather than a square one, needs the captured frame handed back
 * as a File, and needs a review-and-retake step, because a blurred photo
 * that nobody was shown is a blurred photo that gets stored.
 *
 * Two capture paths, both always offered:
 *
 * 1. **Live camera** (getUserMedia + a canvas grab). The one that
 *    actually feels like scanning: the person sees the card inside the
 *    guide and can straighten it before spending the shot. Requires a
 *    secure context, which localhost satisfies.
 *
 * 2. **A file input** with `capture="environment"`. On a phone this opens
 *    the system camera; on a laptop it opens the file picker, which is the
 *    right answer for someone who photographed their ID earlier.
 *
 * Neither is a fallback for the other and neither is hidden based on a
 * capability guess — the same lesson CameraScanner's doc comment spells
 * out. A browser that refuses getUserMedia still has path 2, and someone
 * whose photo is already in their gallery should not have to re-take it
 * just because a camera exists.
 *
 * Nothing here uploads anything. The File goes to the caller, which
 * decides what to do with it and when — for /join that means OCR runs in
 * the browser and the image is not sent anywhere until the person has
 * reviewed what was read off it and pressed Continue.
 */
export function IdCardScanner({
  label,
  hint,
  optional = false,
  file,
  previewUrl,
  onCapture,
  onClear,
  disabled = false,
}: {
  /** "Front of your ID" — names the side, since the caller owns both. */
  label: string;
  hint?: string;
  /** Marks the side as skippable in words. Deliberately the inverse of a
   *  `required` flag with an asterisk: an asterisk is a convention, and a
   *  convention is exactly what someone filling in their first form on a
   *  phone has no reason to know. */
  optional?: boolean;
  /** The already-captured file, when there is one. This component is
   *  controlled: the caller holds the image so it survives step changes. */
  file: File | null;
  /** Object URL for `file`, owned and revoked by the caller — creating it
   *  here would leak one per re-render. */
  previewUrl: string | null;
  onCapture: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<'idle' | 'camera'>('idle');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = `idscan-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (mode !== 'camera') { stop(); return; }
    let cancelled = false;
    setStarting(true);
    setError(null);

    async function start() {
      try {
        if (!window.isSecureContext) {
          throw new Error('Using the camera needs a secure connection (https, or localhost on this device).');
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser won't give a web page camera access. Choose a photo instead.");
        }
        // facingMode as a *preference*, never `exact` — an exact
        // environment constraint fails outright on a laptop with only a
        // front camera, before a permission prompt has any reason to
        // appear. A front-facing webcam is still a camera.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // Safari rejects play() if the element is not yet laid out;
          // ignoring the rejection leaves the stream attached and the
          // frame arrives as soon as it can either way.
          await video.play().catch(() => {});
        }
      } catch (e) {
        if (!cancelled) {
          setError(cameraMessage(e));
          setMode('idle');
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    void start();
    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attempt` is a manual retry trigger, not a data dependency
  }, [mode, attempt, stop]);

  // A live camera left running behind a wizard step the person has moved
  // past is both a privacy surprise and a flat battery.
  useEffect(() => stop, [stop]);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError('The camera has not sent a picture yet — give it a moment and tap again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const g = canvas.getContext('2d');
    if (!g) { setError("Couldn't capture that frame. Choose a photo instead."); return; }
    g.drawImage(video, 0, 0);
    // JPEG at 0.92 rather than PNG: a photograph of a card compresses to
    // roughly a tenth of the size with no loss OCR can see, and this file
    // has both an upload limit and a phone's uplink to get through.
    canvas.toBlob(
      (blob) => {
        if (!blob) { setError("Couldn't capture that frame. Choose a photo instead."); return; }
        onCapture(new File([blob], `${slug(label)}.jpg`, { type: 'image/jpeg' }));
        setMode('idle');
      },
      'image/jpeg',
      0.92,
    );
  }

  if (file && previewUrl) {
    return (
      <div className="idscan">
        <p className="lab idscan-lab">
          <Icon name="check-circle" size={14} /> {label}
        </p>
        <div className="idscan-shot">
          <img src={previewUrl} alt={`${label} — captured photo`} />
        </div>
        <div className="idscan-actions">
          <button type="button" className="btn btn-o btn-sm" disabled={disabled} onClick={onClear}>
            <Icon name="refresh" size={14} /> Retake
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="idscan">
      <p className="lab idscan-lab">
        {label}
        {optional && <span className="labpills"><span className="optpill">optional</span></span>}
      </p>

      {mode === 'camera' ? (
        <>
          <div className="idscan-frame">
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="idscan-guide" aria-hidden><span /><span /><span /><span /></div>
            {starting && (
              <div className="idscan-loading" aria-hidden>
                <span className="idscan-pulse" />
                <span>Opening camera…</span>
              </div>
            )}
          </div>
          <p className="hint idscan-hint">
            Fill the frame with the card, flat and in good light. Avoid the flash&rsquo;s glare on the
            plastic.
          </p>
          <div className="idscan-actions">
            <button type="button" className="btn btn-p btn-sm" disabled={disabled || starting} onClick={shoot}>
              <Icon name="qr" size={14} /> Capture
            </button>
            <button type="button" className="btn btn-o btn-sm" disabled={disabled} onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="idscan-empty">
            <Icon name="document" size={22} />
            <p>{hint ?? 'No photo yet'}</p>
          </div>
          <div className="idscan-actions">
            <button type="button" className="btn btn-p btn-sm" disabled={disabled} onClick={() => { setError(null); setMode('camera'); }}>
              <Icon name="qr" size={14} /> Scan with camera
            </button>
            <button type="button" className="btn btn-o btn-sm" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
              <Icon name="document" size={14} /> Choose a photo
            </button>
          </div>
        </>
      )}

      <input
        ref={fileInputRef} id={inputId} type="file" accept="image/*" capture="environment"
        className="idscan-file" tabIndex={-1} aria-hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          // Reset the input so picking the same file twice after a retake
          // still fires a change event.
          e.target.value = '';
          if (picked) { setError(null); onCapture(picked); }
        }}
      />

      {error && (
        <div role="alert" className="idscan-err">
          <Icon name="alert-circle" size={15} />
          <span>{error}</span>
          <button type="button" className="btn btn-o btn-sm" onClick={() => { setError(null); setAttempt((n) => n + 1); setMode('camera'); }}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'id-photo';
}

/** One short, actionable line per failure kind, and never a walkthrough of
 *  browser settings. Mirrors CameraScanner's toCameraError — same failures
 *  reach both, and someone should not get two different explanations of
 *  the same blocked permission depending on which screen they are on. */
function cameraMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e ?? '');
  const name = e instanceof Error ? e.name : '';
  const hay = `${name} ${message}`;

  if (/NotAllowedError|PermissionDenied|permission .*denied|not allowed/i.test(hay)) {
    return "Camera access is blocked for this site. Allow it from the icon in your browser's address bar, or choose a photo instead.";
  }
  if (/NotFoundError|DevicesNotFound|no .*camera/i.test(hay)) {
    return 'No camera was found on this device. Choose a photo instead.';
  }
  if (/NotReadableError|TrackStartError|AbortError|busy|could not be started/i.test(hay)) {
    return 'The camera is busy — close whatever else is using it, then try again.';
  }
  if (/secure connection|secure context/i.test(hay)) return message;
  if (/won't give|browser/i.test(hay)) return message;
  return `Couldn't start the camera${message ? ` (${message})` : ''}. Choose a photo instead.`;
}
