'use server';

import { redirect } from 'next/navigation';
import { createStore } from '@esoko/db';
import { createStoreSchema } from '@esoko/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof Error) return { ok: false, error: e.message };
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

/**
 * Opens a store. A PUBLIC HTTP ENDPOINT wearing a function signature —
 * validated at the boundary with the same Zod schema the wizard uses,
 * then authorised by createStore's own requireCapability call. Redirect
 * happens outside the try/catch: Next's redirect() throws internally,
 * and catching that would turn a successful open into a reported error.
 */
export async function submitStoreWizard(raw: unknown): Promise<ActionResult<{ slug: string }>> {
  const ctx = await requireSubject();
  const parsed = createStoreSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  }

  let slug: string;
  try {
    const store = await createStore(ctx, parsed.data);
    slug = store.slug;
  } catch (e) {
    return fail(e);
  }

  redirect(`/dashboard?opened=${slug}`);
}
