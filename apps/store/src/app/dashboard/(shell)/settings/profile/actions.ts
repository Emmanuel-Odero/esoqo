'use server';

import { revalidatePath } from 'next/cache';
import {
  updateStoreProfile, addStorePhoto, deleteStorePhoto, getStoreForOwner,
  sniff, makeStorageKey, putObject, MAX_BYTES, deleteObject,
} from '@esoqo/db';
import {
  storeIdentitySchema, storeBrandingSchema, storeCatalogSchema,
  storeShippingSchema, storePaymentsSchema,
} from '@esoqo/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true; url?: string; photoId?: string } | { ok: false; error: string };

const STEP_SCHEMAS = {
  identity: storeIdentitySchema,
  branding: storeBrandingSchema,
  catalog: storeCatalogSchema,
  shipping: storeShippingSchema,
  payments: storePaymentsSchema,
} as const;
export type ProfileStep = keyof typeof STEP_SCHEMAS;

export async function saveProfileStep(storeId: string, step: ProfileStep, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const schema = STEP_SCHEMAS[step];
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await updateStoreProfile(ctx, storeId, parsed.data);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save this step' };
  }
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { ok: true };
}

/** Shared POST handler for logo/favicon/photo uploads — same sniff-guard
 *  as product photos. `target` selects the store column; photos go into
 *  the StorePhoto table. When replacing an existing logo/favicon the old
 *  object is deleted so the storefront never serves stale bytes. */
async function handleUpload(storeId: string, target: 'logo' | 'favicon' | 'photo', form: FormData): Promise<ActionResult> {
  const ctx = await requireSubject();
  let photoId: string | null = null;
  let newUrl: string;
  try {
    const file = form.get('file');
    if (!(file instanceof File)) return { ok: false, error: 'No file was attached' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'That file is larger than 10 MB' };

    const buf = Buffer.from(await file.arrayBuffer());
    const check = sniff(buf, file.type, file.name);
    if (!check.ok || !check.mime || !check.mime.startsWith('image/')) {
      return { ok: false, error: check.reason ?? 'Only PNG or JPEG photos are accepted' };
    }
    if (target === 'logo' || target === 'favicon') {
      if (buf.length > 2 * 1024 * 1024) return { ok: false, error: 'Logos and favicons must be under 2 MB' };
    }

    const storageKey = makeStorageKey(check.mime);
    await putObject(storageKey, buf);
    newUrl = `/img/${storageKey}`;

    const store = await getStoreForOwner(ctx, storeId);
    const oldKey = target === 'logo' ? store.logoStorageKey : target === 'favicon' ? store.faviconStorageKey : null;

    if (target === 'photo') {
      const photo = await addStorePhoto(ctx, storeId, { storageKey, url: newUrl });
      photoId = photo.id;
    } else {
      const patch = target === 'logo'
        ? { logoStorageKey: storageKey, logoUrl: newUrl }
        : { faviconStorageKey: storageKey, faviconUrl: newUrl };
      await updateStoreProfile(ctx, storeId, patch);
      if (oldKey && oldKey !== storageKey) await deleteObject(oldKey).catch(() => undefined);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That image didn't upload — try again" };
  }
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { ok: true, url: newUrl, photoId: photoId ?? undefined };
}

export async function uploadLogo(storeId: string, form: FormData): Promise<ActionResult> {
  return handleUpload(storeId, 'logo', form);
}

export async function uploadFavicon(storeId: string, form: FormData): Promise<ActionResult> {
  return handleUpload(storeId, 'favicon', form);
}

export async function uploadStorePhoto(storeId: string, form: FormData): Promise<ActionResult> {
  return handleUpload(storeId, 'photo', form);
}

export async function removeStorePhoto(photoId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await deleteStorePhoto(ctx, photoId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not remove this photo' };
  }
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { ok: true };
}