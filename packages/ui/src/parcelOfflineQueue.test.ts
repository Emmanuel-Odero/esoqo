import { describe, expect, it } from 'vitest';
import { alreadySpent, LABEL_ALREADY_SPENT } from './parcelOfflineQueue';

/**
 * This one predicate decides whether a queued offline booking gets
 * dropped as "already succeeded" or surfaced to a clerk as stuck. Both
 * wrong answers are bad in different ways: a false positive silently
 * discards an intake record, a false negative leaves a permanent stuck
 * item for a parcel that shipped hours ago.
 *
 * The server half of the contract is pinned in
 * services/core-go/internal/httpapi/parcel_error_status_test.go.
 */
describe('alreadySpent', () => {
  it('accepts the code core-go actually sends', () => {
    expect(
      alreadySpent({ errorCode: LABEL_ALREADY_SPENT, error: 'anything at all' }),
    ).toBe(true);
  });

  it('ignores the prose entirely once a code is present', () => {
    // The whole point of the code: a rewritten message must not change
    // the decision, and a message that still contains the old magic
    // words must not override a code that says otherwise.
    expect(
      alreadySpent({
        errorCode: 'BAD_INPUT',
        error: "That label code isn't a known, unused pre-printed label",
      }),
    ).toBe(false);
    expect(
      alreadySpent({ errorCode: LABEL_ALREADY_SPENT, error: 'totally reworded' }),
    ).toBe(true);
  });

  it('treats a real rejection as a real rejection', () => {
    for (const res of [
      { errorCode: 'FOREIGN_LABEL', error: 'That looks like a label printed outside Esoqo' },
      { errorCode: 'BAD_INPUT', error: "That label has been withdrawn and can't be used" },
      { errorCode: 'FORBIDDEN', error: 'That pad belongs to another company' },
      { errorCode: 'UNAUTHORISED', error: 'Your shift session has expired' },
    ]) {
      expect(alreadySpent(res), res.errorCode).toBe(false);
    }
  });

  describe('prose fallback, for a tab open across a deploy', () => {
    // A counter's browser tab can outlive a deploy in either direction,
    // so a flush may hit a server older than the code. Without the
    // fallback that window strands parcels.
    it('still recognises both server paths’ original wording', () => {
      expect(
        alreadySpent({
          error: "That label code isn't a known, unused pre-printed label",
        }),
      ).toBe(true);
      // dbx.importOrgParcelWithLabel worded it in the plural — the path a
      // courier company's own counter books through, and the one whose
      // regex match was an accident of substring.
      expect(
        alreadySpent({
          error: "That label isn't one of your unused pre-printed labels",
        }),
      ).toBe(true);
    });

    it('does not fire on an unrelated failure', () => {
      expect(alreadySpent({ error: 'Request failed (500)' })).toBe(false);
      expect(
        alreadySpent({ error: "That label has been withdrawn and can't be used" }),
      ).toBe(false);
    });
  });
});
