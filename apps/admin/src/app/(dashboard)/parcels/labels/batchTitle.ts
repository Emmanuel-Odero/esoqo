import type { ParcelLabelBatchRow } from '../actions';

/**
 * A human-readable name for a batch, computed from what's already on
 * the row rather than stored — a batch has no properties of its own
 * beyond the labels in it (see ListParcelLabelBatches's own comment),
 * so a title column would be a second place for "who was this printed
 * for" to drift from the labels it describes.
 */
export function batchTitle(batch: ParcelLabelBatchRow): string {
  return `${batch.orgName ?? 'Esoqo pool'} · ${batch.total} label${batch.total === 1 ? '' : 's'} · ${batchStamp(batch.createdAt)} · #${batchShortCode(batch.batchId)}`;
}

export function batchShortCode(batchId: string): string {
  return batchId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function batchStamp(createdAt: string): string {
  // Pinned to Africa/Nairobi — this feeds BatchesPanel, a client
  // component server-rendered on first load, so a bare toLocaleString
  // (machine-local-zone) disagrees between the container and the
  // browser and React reports it as a hydration mismatch.
  return new Date(createdAt).toLocaleString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Africa/Nairobi',
  });
}
