import type { getJamiiPageBySlug } from '@esoqo/db';
import type { OrgLinkMode } from '@/lib/org-links-shared';

export type OrgPage = NonNullable<Awaited<ReturnType<typeof getJamiiPageBySlug>>>;

/** Shared props every block component takes — `data` is this block's
 *  own JSON payload (shape per jamiiBlockDataSchema in @esoqo/domain),
 *  already narrowed to the right variant by BlockRenderer's switch. */
export interface BlockProps<T = Record<string, unknown>> {
  page: OrgPage;
  mode: OrgLinkMode;
  data: T;
}
