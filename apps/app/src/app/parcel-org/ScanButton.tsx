"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@esoqo/ui";
import { extractParcelCode } from "@esoqo/domain";

/**
 * Camera + handheld-gun scan entry for parcel-company desks.
 *
 * Two readers, one callback:
 * - Phone camera (html5-qrcode, dynamic import so the decoder only loads
 *   when someone taps Scan): decodes the QR (tracking URL) or the
 *   Code128 (bare PKG- code) off a printed label. Prefers the rear
 *   camera via device enumeration, falling back to a facingMode request
 *   for browsers that don't expose labels until permission is granted.
 * - Handheld scanner gun: these behave as a keyboard (keystrokes +
 *   Enter), so every text input beside this button already accepts them
 *   with focus + Enter-to-submit — no hardware integration needed.
 *
 * Raw decoded text always passes through extractParcelCode first, so a
 * QR holding "https://…/p/PKG-X?k=…" and a barcode holding "PKG-X" both
 * arrive as the bare code the server resolves.
 *
 * Camera failures are diagnosed, not swallowed: browsers only expose
 * cameras in a secure context (https or localhost — plain http over LAN
 * is blocked by the browser itself), and denial / missing / busy
 * hardware each get their own message. The diagnosis stays visible next
 * to the button even after the preview closes.
 */
// Use a simple incrementing counter for view IDs instead of useId()
// to avoid hydration mismatches between server and client
let scanViewCounter = 0;

export function ScanButton({ onScan }: { onScan: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewId = `porg-scan-view-${++scanViewCounter}`;
  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void;
  } | null>(null);
  const onScanRef = useRef(onScan);
  const acceptedRef = useRef(false);
  onScanRef.current = onScan;

  // Check camera permissions availability upfront to avoid hanging
  const [canUseCamera, setCanUseCamera] = useState<boolean | null>(null);

  useEffect(() => {
    // Check camera permissions availability upfront to avoid hanging
    const checkCameraAvailability = async () => {
      try {
        // Check if navigator.mediaDevices exists
        if (!navigator.mediaDevices?.getUserMedia) {
          setCanUseCamera(false);
          return;
        }
        // Try a dummy permission check (doesn't prompt user)
        const permission = await (navigator as any).permissions?.query?.({
          name: "camera" as any,
        });
        setCanUseCamera(
          permission?.state === "granted" || permission?.state === "prompt",
        );
      } catch {
        // If we can't check permissions, assume camera might work
        setCanUseCamera(true);
      }
    };
    checkCameraAvailability();
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    acceptedRef.current = false;
    // Set only once a start() has actually resolved. stop() throws
    // *synchronously* ("Cannot stop, scanner is not running or paused")
    // when the scanner never started — a failed start followed by
    // setOpen(false) would otherwise turn one camera failure into two
    // errors via the cleanup below.
    let didStart = false;

    async function start() {
      setStarting(true);
      try {
        // Browsers gate cameras behind a secure context. Plain http over
        // the LAN (e.g. testing on a phone via http://192.168.x.x:3001)
        // has no camera API at all — https or localhost only.
        if (!window.isSecureContext) {
          throw namedError(
            "SecurityError",
            "This page is not a secure context, so the browser blocks camera access. " +
              "Open it over https — or on this device via http://localhost:3001 — " +
              "or type the code instead.",
          );
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw namedError(
            "NotFoundError",
            "This browser exposes no camera API on this device. Use a scanner gun in the input, or type the code.",
          );
        }
        if (!containerRef.current) {
          throw new Error("Scanner view is not ready — close and try again.");
        }
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled || !containerRef.current) {
          throw new Error("Scanner was closed before the camera started.");
        }

        // Ask for the camera explicitly FIRST. This is the call that
        // makes the browser show its native permission prompt on first
        // tap — enumeration alone never prompts, and its device labels
        // stay empty until permission is granted, so priming first also
        // makes the rear-camera pick below reliable. The priming tracks
        // are stopped immediately; the decoder acquires its own stream.
        let cameraId: string | undefined;
        let priming: MediaStream | null = null;
        try {
          priming = await navigator.mediaDevices.getUserMedia({ video: true });
          const cameras = await Html5Qrcode.getCameras();
          const rear =
            cameras.find((c) => /back|rear|environment/i.test(c.label)) ??
            cameras[cameras.length - 1];
          cameraId = rear?.id;
        } finally {
          priming?.getTracks().forEach((t) => t.stop());
        }
        if (cancelled || !containerRef.current) {
          throw new Error("Scanner was closed before the camera started.");
        }

        const scanner = new Html5Qrcode(viewId);
        scannerRef.current = scanner;

        const onSuccess = (decodedText: string) => {
          if (acceptedRef.current) return;
          const code = extractParcelCode(decodedText.trim());
          if (!code) return;
          acceptedRef.current = true;
          onScanRef.current(code);
          if (!cancelled) setOpen(false);
        };
        const config = { fps: 10, qrbox: { width: 220, height: 220 } };
        try {
          await scanner.start(
            cameraId
              ? { deviceId: { exact: cameraId } }
              : { facingMode: "environment" },
            config,
            onSuccess,
            undefined,
          );
          didStart = true;
        } catch (firstErr) {
          // An exact deviceId is over-constrained on some Android
          // WebViews — retry once with a plain facingMode request before
          // calling it a failure.
          if (cameraId && !cancelled) {
            await scanner.start(
              { facingMode: "environment" },
              config,
              onSuccess,
              undefined,
            );
            didStart = true;
          } else {
            throw firstErr;
          }
        }
        // Closing while the browser was negotiating the camera used to
        // leave a stream running: the cleanup saw didStart=false, then
        // start resolved afterwards. Stop this late-started instance here.
        if (cancelled && didStart) {
          try {
            await scanner.stop();
            scanner.clear();
          } catch {
            /* the browser already released it */
          }
        }
      } catch (e) {
        if (!cancelled) {
          const errorMsg = describeCameraError(e);
          setError(errorMsg);
          // Keep the modal open when there's an error so the user can read
          // the diagnostic message. They can still close it manually if needed.
          setOpen(true);
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
      // Only a started scanner can be stopped; anything else (failed or
      // still-pending start, user closed early) throws synchronously from
      // stop() itself, so the call is guarded both by the flag and by a
      // try/catch — there must be no error path out of a cleanup.
      if (scanner && didStart) {
        try {
          const stopping = scanner.stop();
          if (stopping && typeof stopping.catch === "function") {
            stopping
              .catch(() => {})
              .finally(() => {
                try {
                  scanner.clear();
                } catch {
                  /* already cleared */
                }
              });
          }
        } catch {
          /* never started — nothing to stop */
        }
      }
    };
  }, [open, viewId]);

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {canUseCamera !== false ? (
          <button
            type="button"
            className="btn btn-o btn-sm"
            disabled={starting || canUseCamera === false}
            onClick={() => {
              setError(null);
              setOpen((v) => !v);
            }}
          >
            <Icon name="qr" size={14} />
            {starting ? "Starting camera…" : open ? "Close scanner" : "Scan"}
          </button>
        ) : null}
        <span style={{ color: "var(--tx-3)", fontSize: "0.85rem" }}>
          {canUseCamera === false
            ? "Camera not available"
            : "Scan with camera or type code"}
        </span>
      </div>
      {/* Show error above the button if scanner failed to initialize */}
      {error && !open && (
        <div
          role="alert"
          style={{
            background: "#FFF0F0",
            border: "1px solid var(--red)",
            color: "var(--red)",
            padding: "12px",
            borderRadius: 8,
            marginTop: "8px",
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
            fontSize: "0.85rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: "8px",
            }}
          >
            <Icon name="alert-circle" size={18} />
            <strong>Scanner not available</strong>
          </div>
          {error}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 12 }}>
          <div
            id={viewId}
            ref={containerRef}
            style={{
              width: "100%",
              maxWidth: 320,
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid var(--line)",
              minHeight: 120,
            }}
          />
          <p className="sub" style={{ margin: "8px 0 0" }}>
            Point the camera at the label&apos;s QR or barcode. A scanner gun
            works too — click the input and scan.
          </p>
          {/* Show error inside the modal if it occurs while scanner is open */}
          {error && (
            <div
              role="alert"
              style={{
                background: "#FFF0F0",
                border: "1px solid var(--red)",
                color: "var(--red)",
                padding: "12px",
                borderRadius: 8,
                marginTop: "8px",
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: "0.85rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: "8px",
                }}
              >
                <Icon name="alert-circle" size={18} />
                <strong>Scanner not available</strong>
              </div>
              {error}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Shape a synthetic DOMException-like for the pre-check failures, so
 *  one mapper below covers library errors and our own. */
function namedError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

/** One honest message per failure kind — "check permission" is only
 *  the right advice for one of them. html5-qrcode throws plain strings
 *  (not Errors) for its own failures, so both shapes are matched. */
function describeCameraError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e ?? "");
  const name = e instanceof Error ? e.name : "";
  const hay = `${name} ${message}`;

  // Most common issue: not in a secure context (HTTPS or localhost)
  if (name === "SecurityError" || /secure context/i.test(message)) {
    return (
      "Camera scanning is not available in this browser context.\n\n" +
      "To use camera scanning, please open this page over:\n" +
      "• HTTPS (https://yourdomain.com), OR\n" +
      "• http://localhost:3001 on this device\n\n" +
      "If you're on a mobile device connected to your network, use your computer's IP address:\n" +
      "1. Find your computer's IP (Terminal: ipconfig getifaddr en0 on Mac)\n" +
      "2. Access http://YOUR_COMPUTER_IP:3001\n\n" +
      "Alternatively, you can type the parcel code manually in the input box above."
    );
  }

  if (
    /NotAllowedError|PermissionDenied|permission .*denied|not allowed/i.test(
      hay,
    )
  ) {
    return (
      "Camera permission was denied.\n\n" +
      "To fix this:\n" +
      "1. Open your browser settings\n" +
      "2. Find 'Site settings' or 'Permissions'\n" +
      "3. Search for this site and enable camera access\n" +
      "4. Reload the page\n\n" +
      "Or type the parcel code manually in the input box above."
    );
  }
  if (
    /NotFoundError|DevicesNotFound|Overconstrained|no .*camera|not found/i.test(
      hay,
    )
  ) {
    return (
      `No usable camera was found${message ? ` (${message})` : ""}.\n\n` +
      "Possible causes:\n" +
      "• No camera is connected to this device\n" +
      "• The camera is being used by another app\n" +
      "• Camera drivers are not installed\n\n" +
      "To use a scanner gun: click the input box above and scan the barcode.\n" +
      "Or type the parcel code manually."
    );
  }
  if (
    /NotReadableError|TrackStartError|AbortError|busy|could not be started/i.test(
      hay,
    )
  ) {
    return (
      `The camera is busy or could not be started${message ? ` (${message})` : ""}.\n\n` +
      "Try these steps:\n" +
      "1. Close any other tabs or apps using the camera\n" +
      "2. Restart your browser\n" +
      "3. Reload this page\n\n" +
      "Or type the parcel code manually in the input box above."
    );
  }

  // Generic error with helpful suggestions
  return (
    `Couldn't start the camera${message ? ` (${message})` : ""}.\n\n` +
    "Please check:\n" +
    "1. Camera permission is enabled in browser settings\n" +
    "2. The page is loaded over HTTPS or localhost\n" +
    "3. No other app is using the camera\n" +
    "4. Camera drivers are installed\n\n" +
    "Alternatively, type the parcel code manually in the input box above."
  );
}
