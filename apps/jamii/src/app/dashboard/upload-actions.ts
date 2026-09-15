'use server';

import { revalidatePath } from 'next/cache';
import {
  sniff, makeStorageKey, putObject, deleteObject, MAX_BYTES,
  getJamiiPageForManagement, updateJamiiPage, addJamiiPhoto, removeJamiiPhoto,
} from '@esoqo/db';
// Its own subpath, not the main '@esoqo/db' entry — see that package's
// index.ts for why (sharp, a native binary addon, would otherwise land
// in every app's Server Component graph just for importing anything
// else from @esoqo/db).
import { compressImage } from '@esoqo/db/image-compression';
import { requireSubject } from '@/lib/session';

export type UploadResult = { ok: true; url: string; photoId?: string } | { ok: false; error: string };

async function readImage(form: FormData): Promise<{ buf: Buffer; mime: string } | { error: string }> {
  const file = form.get('file');
  if (!(file instanceof File)) return { error: 'No file was attached' };
  if (file.size > MAX_BYTES) return { error: 'That file is larger than 10 MB' };

  const buf = Buffer.from(await file.arrayBuffer());
  const check = sniff(buf, file.type, file.name);
  if (!check.ok || !check.mime || !check.mime.startsWith('image/')) {
    return { error: check.reason ?? 'Only PNG or JPEG photos are accepted' };
  }
  // Every image this app ever stores goes through here first — see
  // compressImage's own header for why (resize + re-encode, PDFs/docs
  // untouched, always falls back to the original bytes on failure).
  const compressed = await compressImage(buf, check.mime);
  return { buf: compressed, mime: check.mime };
}

/**
 * Logo/cover for the page profile — same sniff-guard and "delete the
 * old object on replace" behaviour as apps/store's uploadLogo/
 * uploadFavicon.
 */
export async function uploadPageAsset(pageId: string, target: 'logo' | 'cover', form: FormData): Promise<UploadResult> {
  const ctx = await requireSubject();
  try {
    const read = await readImage(form);
    if ('error' in read) return { ok: false, error: read.error };
    if (target === 'logo' && read.buf.length > 2 * 1024 * 1024) {
      return { ok: false, error: 'Logos must be under 2 MB' };
    }

    const storageKey = makeStorageKey(read.mime);
    await putObject(storageKey, read.buf);
    const url = `/img/${storageKey}`;

    const page = await getJamiiPageForManagement(ctx, pageId);
    const oldKey = target === 'logo' ? page?.logoStorageKey : page?.coverStorageKey;

    await updateJamiiPage(ctx, pageId, target === 'logo'
      ? { logoStorageKey: storageKey, logoUrl: url }
      : { coverStorageKey: storageKey, coverUrl: url });

    if (oldKey && oldKey !== storageKey) await deleteObject(oldKey).catch(() => undefined);

    revalidatePath('/dashboard/settings');
    revalidatePath(`/o/${page?.slug}`, 'layout');
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That image didn't upload — try again" };
  }
}

export async function uploadGalleryPhoto(pageId: string, form: FormData): Promise<UploadResult> {
  const ctx = await requireSubject();
  try {
    const read = await readImage(form);
    if ('error' in read) return { ok: false, error: read.error };

    const storageKey = makeStorageKey(read.mime);
    await putObject(storageKey, read.buf);
    const url = `/img/${storageKey}`;

    const photo = await addJamiiPhoto(ctx, pageId, { storageKey, url });
    revalidatePath('/dashboard/gallery');
    return { ok: true, url, photoId: photo.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That photo didn't upload — try again" };
  }
}

export async function removeGalleryPhoto(pageId: string, photoId: string, storageKey: string): Promise<UploadResult> {
  const ctx = await requireSubject();
  try {
    await removeJamiiPhoto(ctx, pageId, photoId);
    await deleteObject(storageKey).catch(() => undefined);
    revalidatePath('/dashboard/gallery');
    return { ok: true, url: '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not remove this photo' };
  }
}

/**
 * A plain storage upload with no DB write — for a post/campaign cover
 * chosen before that row exists yet. The picker uploads on selection
 * and the create form just carries the resulting URL along with the
 * rest of its fields.
 */
export async function uploadDraftImage(form: FormData): Promise<UploadResult> {
  await requireSubject();
  try {
    const read = await readImage(form);
    if ('error' in read) return { ok: false, error: read.error };

    const storageKey = makeStorageKey(read.mime);
    await putObject(storageKey, read.buf);
    return { ok: true, url: `/img/${storageKey}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That image didn't upload — try again" };
  }
}
