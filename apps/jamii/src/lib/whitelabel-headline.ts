/**
 * Splits an org's tagline into the template's three progressively-
 * coloured hero lines (l1 ink / l2 crimson / l3 cyan — see
 * .wl-hero-headline in jamii.css). The source template hand-picked its
 * split ("Voices" / "heard." / "Lives transformed.") for one specific
 * tagline; this is the generic equivalent — CSS uppercases the whole
 * headline regardless of casing, so only the *clause* split matters.
 *
 * Two-sentence taglines ("X. Y.") split naturally: the first word of
 * the first sentence becomes l1, the rest of it l2, the second
 * sentence l3. Anything else (one clause, or none at all) falls back
 * to the org's own name as l1 with the tagline as l2.
 */
export function splitHeroHeadline(tagline: string | null | undefined, orgName: string): [string, string, string | null] {
  const sentences = (tagline ?? '').split('.').map((s) => s.trim()).filter(Boolean);
  if (sentences.length >= 2) {
    const [first, ...rest] = sentences[0]!.split(' ');
    return [first!, rest.join(' ') || sentences[0]!, sentences.slice(1).join('. ')];
  }
  return [orgName, tagline?.trim() || '', null];
}
