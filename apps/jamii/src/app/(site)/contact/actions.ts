'use server';

import { jamiiContactSchema } from '@esoqo/domain';

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/**
 * No ticketing system wired up yet — this validates and logs for a
 * human to follow up, the same "record it, don't lose it" bar the rest
 * of the platform holds itself to, kept intentionally small until
 * there's a real inbox to route to.
 */
export async function actionSendContact(raw: unknown): Promise<ActionResult<void>> {
  const parsed = jamiiContactSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };

  console.log('[jamii contact]', parsed.data);
  return { ok: true, data: undefined };
}
