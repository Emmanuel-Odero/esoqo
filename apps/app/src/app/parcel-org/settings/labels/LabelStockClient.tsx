'use client';

import { useState } from 'react';
import { OrgLabelsClient } from './OrgLabelsClient';
import type { OrgLabelBatchRow, OrgLabelRow } from '../../actions';

/**
 * Holds the state filter (blank / filled / spent / voided) client-side
 * so switching between them doesn't round-trip the whole register —
 * the server hands down every label once and this picks among them,
 * which is what the Counter tab did before this moved.
 */
export function LabelStockClient({
  labels, counts, batches, initialState, orgName, orgLogoUrl,
}: {
  labels: OrgLabelRow[];
  counts: Record<string, number>;
  batches: OrgLabelBatchRow[];
  initialState: string;
  orgName: string;
  orgLogoUrl?: string;
}) {
  const [state, setState] = useState(initialState);

  return (
    <OrgLabelsClient
      labels={labels.filter((l) => state === 'all' || l.state === state)}
      counts={counts}
      batches={batches}
      state={state}
      canManage
      orgName={orgName}
      orgLogoUrl={orgLogoUrl}
      onStateChange={setState}
    />
  );
}
