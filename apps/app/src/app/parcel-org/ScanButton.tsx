"use client";

import { CameraScanner } from "@esoqo/ui";
import { extractParcelCode } from "@esoqo/domain";

/**
 * Camera scan entry for parcel-company desks — a thin wrapper over the
 * shared CameraScanner (the same component the guest tracker and the
 * universal /scan page use), converting whatever it decodes through
 * extractParcelCode first. A QR holding a tracking URL and a barcode
 * holding the bare code both arrive here as the same PKG-… string; a
 * handheld scanner gun needs no wrapping at all since every text input
 * beside this button already accepts its keystrokes-and-Enter.
 */
export function ScanButton({ onScan }: { onScan: (code: string) => void }) {
  return (
    <CameraScanner
      onScan={(decoded) => {
        const code = extractParcelCode(decoded);
        if (code) onScan(code);
      }}
      hint="Point the camera at the label's QR or barcode. A scanner gun works too — click the input and scan."
    />
  );
}
