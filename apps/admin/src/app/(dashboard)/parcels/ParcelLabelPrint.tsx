'use client';

import { Icon, PrintableLabel, PrintStyles } from '@esoqo/ui';

// The label itself, the print-only CSS, LABEL_*/trackingUrlFor all now
// live in @esoqo/ui (see packages/ui/src/ParcelLabel.tsx) — a partner
// company's own front desk needs the exact same physical sticker (see
// apps/app's parcel-org "receive" panel), and duplicating this file
// across two apps is exactly the drift a shared package exists to
// prevent. Re-exported here so this file's own existing importers
// (LabelStockPanel.tsx) don't need to change their import path.
export {
  PrintableLabel, PrintStyles, trackingUrlFor,
  LABEL_WIDTH_MM, LABEL_HEIGHT_MM, LABEL_GAP_MM,
} from '@esoqo/ui';

/**
 * The single-parcel "Print label" panel opened from ParcelDetailModal
 * — no fetch needed, the code is already on hand (it's the row's own
 * `parcel.Code`, already-public info shown right above this panel).
 */
export function ParcelLabelPrint({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>Parcel label</strong>
      {/* print-modal-escape, not just print-label — this one label is
          buried inside the parcel detail modal's own positioning/
          overflow, so printing it needs to break out to the page's
          top-left. The batch page's labels (LabelStockPanel) are
          already at the page's top level and print in their normal
          flex-wrap layout instead — see PrintStyles. */}
      <div className="print-modal-escape">
        <PrintableLabel code={code} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-p btn-sm" onClick={() => window.print()}>
          <Icon name="print" size={13} />Print label
        </button>
        <button className="btn btn-o btn-sm" onClick={onClose}>Close</button>
      </div>
      <PrintStyles />
    </div>
  );
}
