'use client';

import { Icon } from '@esoqo/ui';

/**
 * The only interactive thing on the manifest. Its own client component
 * so the sheet itself stays a server component — a document has no
 * state, and shipping a whole page to the browser to hold one onClick
 * would be backwards.
 */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-p btn-sm" onClick={() => window.print()}>
      <Icon name="print" size={15} />Print manifest
    </button>
  );
}
