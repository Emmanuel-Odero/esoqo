/**
 * Deterministic pick from a list of active JamiiMediaAsset rows, keyed
 * by some stable id (a page's organisationId, a post's id, ...) — same
 * input always picks the same pattern, so a page's placeholder doesn't
 * change on every render/revalidation, without needing to persist
 * "which pattern this org got" anywhere.
 */
export function pickMediaAsset<T extends { patternKey: string }>(assets: T[], seed: string): T | null {
  if (assets.length === 0) return null;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return assets[hash % assets.length]!;
}
