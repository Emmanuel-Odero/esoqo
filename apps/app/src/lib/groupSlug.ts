/**
 * Group URLs read as `/me/group/kikundi-2e55e786/treasury`, not the raw
 * UUID — a human name up front, with a short chunk of the real id after
 * it so two groups that happen to share a name still resolve to
 * different pages. The suffix is never treated as authorization: every
 * caller still resolves it against the signed-in person's own
 * membership list (see group/[orgSlug]/page.tsx), so a copied or
 * hand-edited slug can only ever land on a group you already belong to,
 * exactly as the raw-UUID routes worked before this.
 */
const SUFFIX_LEN = 8;

function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'group';
}

export function orgSlug(name: string, orgId: string): string {
  return `${slugifyName(name)}-${orgId.slice(0, SUFFIX_LEN)}`;
}

/** The id chunk is always the last hyphen-delimited segment. */
export function idSuffixFromSlug(slug: string): string {
  const parts = slug.split('-');
  return parts[parts.length - 1] ?? '';
}
