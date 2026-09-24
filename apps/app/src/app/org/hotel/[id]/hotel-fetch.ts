/**
 * Hotel portal fetch helper.
 * Thin wrapper around orgFetch that fixes the org type to 'hotel'.
 */
import { orgFetch } from '@/lib/org-session';

export async function hotelFetch<T>(orgId: string, path: string, init?: RequestInit): Promise<T> {
  return orgFetch<T>('hotel', path, init);
}
