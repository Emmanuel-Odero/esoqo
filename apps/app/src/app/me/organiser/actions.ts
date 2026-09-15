'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createTicketOrgSchema } from '@esoqo/domain';
import { SESSION_COOKIE } from '@esoqo/auth';
import { requireSubject } from '@/lib/session';
import { goUrl } from '@/lib/ticketing';

const FALLBACK = "That didn't go through. Please try again.";

export async function actionCreateTicketOrg(raw: unknown) {
  const parsed = createTicketOrgSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await requireSubject();
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const res = await fetch(goUrl('/v1/ticketorgs'), {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enterpriseId: parsed.data.enterpriseId,
        name: parsed.data.name,
        vertical: parsed.data.vertical,
        contactPhone: parsed.data.contactPhone ?? null,
        contactEmail: parsed.data.contactEmail ?? null,
      }),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as { org?: { id: string }; error?: { message?: string } } | null;
    if (!res.ok || !json?.org) {
      return { ok: false as const, error: json?.error?.message ?? FALLBACK };
    }
    revalidatePath('/me/organiser');
    return { ok: true as const, data: { orgId: json.org.id } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof Error ? e.message : FALLBACK };
  }
}
