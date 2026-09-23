'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';
import { Icon } from './Icon';

/**
 * Camera-based QR/barcode scanner for any Esoqo code — one component
 * behind every "Scan" button on the web: the guest tracker, the
 * universal /scan page, and a courier company's own counter and
 * scanner console. Decodes whatever html5-qrcode's ZXing decoder
 * recognises (QR and Code128, the two formats every printed parcel
 * label carries) and hands the raw decoded text straight back — what
 * that text MEANS (a bare code, an esoqo:// payload, a tracking URL)
 * is for the caller to decide.
 *
 * Two things every prior version of this got wrong, fixed here:
 *
 * 1. The trigger must never disappear. A `navigator.permissions.query`
 *    pre-check that hides the "Scan" button once a browser reports
 *    "denied" leaves someone who re-enabled the permission from their
 *    address bar with no way to try again short of a reload — and on
 *    browsers that don't support the query at all (Safari, Firefox),
 *    treating the failure as "no camera" hides a working button behind
 *    a guess. Only `getUserMedia` itself — called on tap — knows the
 *    truth, and calling it is also the only thing that ever shows the
 *    browser's native "Allow camera?" prompt. So the button always
 *    renders; permission is discovered by asking, not predicted.
 *
 * 2. A device request must never hard-require a rear camera. Asking
 *    for `facingMode: 'environment'` as an exact constraint fails
 *    outright on any laptop or desktop webcam — those only expose a
 *    front-facing camera, so "environment" has no match and the
 *    browser refuses before a permission prompt even has a reason to
 *    appear. The fix: enumerate the actual cameras after permission is
 *    granted, prefer one whose label says rear/back/environment when
 *    there's a choice, and otherwise take whatever camera exists — a
 *    single front-facing webcam is still a camera.
 */
export function CameraScanner({
  onScan,
  hint = "Point your camera at the code's QR or barcode.",
}: {
  onScan: (code: string) => void;
  /** What to aim at. Callers name the specific thing (a parcel label,
   *  "any Esoqo code") since this component doesn't know. */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewId = `esoqo-scan-view-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const scannerRef = useRef<Html5QrcodeType | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let didStart = false;
    setStarting(true);
    setError(null);

    async function start() {
      try {
        if (!window.isSecureContext) {
          throw new CameraError('Camera scanning needs a secure connection (https, or localhost on this device).', false);
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new CameraError("This browser doesn't expose camera access. Type the code instead.", false);
        }

        if (cancelled || !containerRef.current) return;

        // Dynamically imported on first open only: html5-qrcode touches
        // `document`/`window` at module scope, so a static import pulls it
        // into every Server Component that transitively imports @esoqo/ui
        // (layout → IconSprite → index → here) and 500s the whole site
        // when the server bundle resolves it. Dynamic + client-only keeps
        // the initial page light and SSR safe.
        const { Html5Qrcode: Html5QrcodeClass } = await import('html5-qrcode');

        // Ask for the camera explicitly first — this is the call that
        // makes the browser show its native permission prompt, and it's
        // also what unlocks real device labels for the enumeration
        // below (labels stay blank pre-permission). Stopped immediately;
        // the decoder below opens its own stream.
        const priming = await navigator.mediaDevices.getUserMedia({ video: true })
          .catch((e) => { throw toCameraError(e); });
        priming.getTracks().forEach((t) => t.stop());
        if (cancelled || !containerRef.current) return;

        const cameras = await Html5QrcodeClass.getCameras().catch(() => []);
        const rear = cameras.find((c) => /back|rear|environment/i.test(c.label));
        // No rear match (most laptops, some phones with one camera) —
        // any enumerated camera is still a camera; take the first.
        const chosen = rear ?? cameras[0];

        const scanner = new Html5QrcodeClass(viewId);
        scannerRef.current = scanner;
        const onSuccess = (decodedText: string) => {
          onScanRef.current(decodedText.trim());
          setOpen(false);
        };
        // A fixed 220px qrbox reads as a tiny target inside a preview
        // that now fills a phone's width (see .cscan-view in ui.css) —
        // scale it to the actual live-view size instead, so the aiming
        // box stays a sensible fraction of the frame at any width.
        const config = {
          fps: 10,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            // html5-qrcode throws a plain, unmatched string (not caught
            // by toCameraError's patterns, so it fell through to the
            // generic "Couldn't start the camera" message) if either
            // side of the box comes out under its own 50px floor — which
            // happens whenever the live view is still 0×0 at the instant
            // this runs (e.g. right after permission is granted, before
            // the video element has laid out). Floor it here so a small
            // or momentarily-unsized viewport degrades to a small box
            // instead of an opaque failure.
            const edge = Math.max(50, Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75));
            return { width: edge, height: edge };
          },
        };

        // deviceId when we found one (exact — we know it exists), else
        // a soft facingMode hint, else whatever camera the browser
        // wants to hand back. Each is a real fallback, not a retry of
        // the same failing request.
        const attempts: Array<() => Promise<unknown>> = [
          ...(chosen ? [() => scanner.start({ deviceId: { exact: chosen.id } }, config, onSuccess, undefined)] : []),
          () => scanner.start({ facingMode: 'environment' }, config, onSuccess, undefined),
          () => scanner.start({ facingMode: 'user' }, config, onSuccess, undefined),
        ];
        let lastErr: unknown;
        for (const tryStart of attempts) {
          if (cancelled) return;
          try {
            await tryStart();
            didStart = true;
            lastErr = undefined;
            break;
          } catch (e) {
            lastErr = e;
            // eslint-disable-next-line no-console -- the only way to see
            // *which* start attempt failed and why when self-testing on
            // a phone with no attached debugger.
            console.error('[CameraScanner] start attempt failed', e);
          }
        }
        // Permission was already granted (priming succeeded above) —
        // every attempt here failed inside html5-qrcode itself, not at
        // the permission prompt. Say so explicitly so "no prompt showed"
        // and "prompt showed, decoder still failed" never look the same
        // failure to someone testing this on-device.
        if (!didStart) throw toCameraError(lastErr, true);

        if (cancelled && didStart) {
          scanner.stop().catch(() => {}).finally(() => scanner.clear());
        }
      } catch (e) {
        if (!cancelled) {
          // eslint-disable-next-line no-console -- see the attempt-level log above
          console.error('[CameraScanner] failed to start', e);
          setError(e instanceof CameraError ? e : toCameraError(e));
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner && didStart) {
        scanner.stop().catch(() => {}).finally(() => {
          try { scanner.clear(); } catch { /* already cleared */ }
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attempt` is a manual retry trigger, not a data dependency
  }, [open, attempt, viewId]);

  return (
    <>
      <button
        type="button"
        className={`btn ${open ? 'btn-o' : 'btn-p'} btn-lg btn-block`}
        disabled={starting}
        onClick={() => { setError(null); setOpen((v) => !v); }}
        aria-expanded={open}
      >
        <Icon name="qr" size={20} />
        {starting ? 'Starting camera…' : open ? 'Close scanner' : 'Scan with camera'}
      </button>
      {open && (
        <div className="cscan">
          <div className="cscan-frame">
            <div id={viewId} ref={containerRef} className="cscan-view" />
            {!error && (
              <div aria-hidden className="cscan-corners">
                <span /><span /><span /><span />
              </div>
            )}
            {starting && (
              <div className="cscan-loading" aria-hidden>
                <span className="cscan-pulse" />
                <span>Opening camera…</span>
              </div>
            )}
          </div>
          {!error && <p className="sub" style={{ margin: '10px 0 0', textAlign: 'center' }}>{hint}</p>}
          {error && (
            <div role="alert" className="cscan-err">
              <Icon name="alert-circle" size={16} />
              <span>{error.message}</span>
              {error.retryable && (
                <button type="button" className="btn btn-o btn-sm" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

class CameraError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

/** One short, actionable line per failure kind — never a walkthrough of
 *  browser settings. html5-qrcode throws plain strings (not Errors) for
 *  its own failures, so both shapes are matched by name and message.
 *  `permissionGranted` marks failures that happened *after* the browser
 *  already handed us the camera (priming succeeded) — those are a
 *  decoder problem, not a permission one, and should never be worded
 *  like a permission problem. The raw message is appended so someone
 *  self-testing on a phone (no attached debugger) can still read what
 *  actually failed instead of only the generic line. */
function toCameraError(e: unknown, permissionGranted = false): CameraError {
  if (e instanceof CameraError) return e;
  const message = e instanceof Error ? e.message : String(e ?? '');
  const name = e instanceof Error ? e.name : '';
  const hay = `${name} ${message}`;

  if (!permissionGranted && /NotAllowedError|PermissionDenied|permission .*denied|not allowed/i.test(hay)) {
    return new CameraError(
      "Camera access is blocked for this site. Click the camera icon in your browser's address bar to allow it, then try again.",
      true,
    );
  }
  if (/NotFoundError|DevicesNotFound|no .*camera/i.test(hay)) {
    return new CameraError('No camera was found on this device. Type the code instead.', false);
  }
  if (/NotReadableError|TrackStartError|AbortError|busy|could not be started/i.test(hay)) {
    return new CameraError('The camera is busy — close whatever else is using it, then try again.', true);
  }
  if (/Overconstrained/i.test(hay)) {
    return new CameraError("Couldn't match a camera to use. Try again, or type the code instead.", true);
  }
  const detail = message && message !== 'undefined' ? ` (${message})` : '';
  return new CameraError(
    permissionGranted
      ? `Camera access was granted, but the scanner couldn't start${detail}. Try again.`
      : `Couldn't start the camera${detail}. Try again, or type the code instead.`,
    true,
  );
}
