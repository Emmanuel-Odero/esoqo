'use server';

import { headers } from 'next/headers';
import { submitJamiiContactMessage, JAMII_CONTACT_CREATE, type Ctx } from '@esoqo/db';
import { jamiiContactMessageSchema, clientIpFrom } from '@esoqo/domain';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom((n) => h.get(n)) ?? 'unknown';
}

/** Anonymous by design, same shape as the "apply" flow's anonApplyCtx
 *  (apps/jamii/(site)/apply/actions.ts) — a narrowly-scoped SYSTEM Ctx
 *  that can do exactly this one write. No staff role should ever hold
 *  JAMII_CONTACT_CREATE. */
async function anonContactCtx(): Promise<Ctx> {
  return {
    actorType: 'SYSTEM',
    actorId: null,
    capabilities: [JAMII_CONTACT_CREATE],
    ip: await clientIp(),
    __verified: true,
  };
}

/** Submits a page's public Contact form. `pageId` is that page's own
 *  organisationId, passed by the calling page.tsx (not trusted from
 *  arbitrary client input beyond the id itself — submitJamiiContactMessage
 *  re-checks the page exists and is PUBLISHED before writing anything). */
export async function actionSubmitContactMessage(pageId: string, raw: unknown): Promise<ActionResult> {
  const parsed = jamiiContactMessageSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Check your details', field: issue?.path[0] as string | undefined };
  }

  // Honeypot — a bot filling this hidden field gets a fake success
  // rather than a rejection that would teach it to leave the field
  // blank next time.
  if (parsed.data.website2) return { ok: true, data: undefined };

  try {
    await submitJamiiContactMessage(await anonContactCtx(), pageId, {
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone || undefined,
      subject: parsed.data.subject || undefined,
      message: parsed.data.message,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "That didn't go through — please try again." };
  }
}
