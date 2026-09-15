'use client';

import { Icon } from '@esoqo/ui';

export function PrintButton() {
  return (
    <button type="button" className="btn btn-p" onClick={() => window.print()} style={{ marginBottom: 18 }}>
      <Icon name="print" size={14} />Print
    </button>
  );
}
