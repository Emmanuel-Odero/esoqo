'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
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

        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled || !containerRef.current) return;

        // Ask for the camera explicitly first — this is the call that
        // makes the browser show its native permission prompt, and it's
        // also what unlocks real device labels for the enumeration
        // below (labels stay blank pre-permission). Stopped immediately;
        // the decoder below opens its own stream.
        const priming = await navigator.mediaDevices.getUserMedia({ video: true })
          .catch((e) => { throw toCameraError(e); });
        priming.getTracks().forEach((t) => t.stop());
        if (cancelled || !containerRef.current) return;

        const cameras = await Html5Qrcode.getCameras().catch(() => []);
        const rear = cameras.find((c) => /back|rear|environment/i.test(c.label));
        // No rear match (most laptops, some phones with one camera) —
        // any enumerated camera is still a camera; take the first.
        const chosen = rear ?? cameras[0];

        const scanner = new Html5Qrcode(viewId);
        scannerRef.current = scanner;
        const onSuccess = (decodedText: string) => {
          onScanRef.current(decodedText.trim());
          setOpen(false);
        };
        const config = { fps: 10, qrbox: { width: 220, height: 220 } };

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
          }
        }
        if (!didStart) throw toCameraError(lastErr);

        if (cancelled && didStart) {
          scanner.stop().catch(() => {}).finally(() => scanner.clear());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof CameraError ? e : toCameraError(e));
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
        className="btn btn-o btn-sm"
        disabled={starting}
        onClick={() => { setError(null); setOpen((v) => !v); }}
      >
        <Icon name="qr" size={14} />
        {starting ? 'Starting camera…' : open ? 'Close scanner' : 'Scan code'}
      </button>
      {open && (
        <div className="cscan">
          <div id={viewId} ref={containerRef} className="cscan-view" />
          {!error && <p className="sub" style={{ margin: '8px 0 0' }}>{hint}</p>}
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
 *  its own failures, so both shapes are matched by name and message. */
function toCameraError(e: unknown): CameraError {
  if (e instanceof CameraError) return e;
  const message = e instanceof Error ? e.message : String(e ?? '');
  const name = e instanceof Error ? e.name : '';
  const hay = `${name} ${message}`;

  if (/NotAllowedError|PermissionDenied|permission .*denied|not allowed/i.test(hay)) {
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
  return new CameraError("Couldn't start the camera. Try again, or type the code instead.", true);
}
