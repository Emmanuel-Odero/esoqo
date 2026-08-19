import sharp from 'sharp';

/**
 * Deliberately its own module, not part of storage.ts, even though
 * conceptually it's "one more storage rule" — storage.ts is imported by
 * dal/cecf-ingest.ts, which is part of the DAL barrel (dal/index.ts)
 * that apps/jamii's middleware.ts imports for resolveJamiiDomain(),
 * and sharp is a native binary addon (libvips bindings) that a
 * middleware/edge bundle can't resolve ("Module not found: Can't
 * resolve 'sharp'" — Turbopack tries to statically bundle every import
 * reachable from middleware.ts, and a native addon has no such bundle
 * to produce). Keeping compressImage here means sharp is only ever
 * pulled in by whatever actually calls this function directly (e.g.
 * apps/jamii's upload-actions.ts, importing from '@esoko/db' — see
 * index.ts's explicit re-export below), never by anything reachable
 * from the DAL-only barrel.
 */

/**
 * Re-encodes an already-sniffed image before it ever reaches putObject —
 * every upload call site that accepts a photo runs its bytes through
 * this first, so storage cost is capped platform-wide rather than
 * per-feature. Non-image mimes (pdf, doc, docx, xls, xlsx) pass through
 * this module entirely untouched: recompressing a document format isn't
 * safe to do generically, and isn't what "compress uploads" means for
 * that content.
 *
 * - Downscales to a max of 2000px on the longest edge (most uploaded
 *   photos are camera-resolution originals nobody will ever view at
 *   full size on a page); `withoutEnlargement` means a smaller source
 *   image is never upscaled.
 * - Re-encodes at a quality that stays visually close to the original
 *   while cutting file size meaningfully — 78 for JPEG (WP/most CMSs
 *   default to 82; a few points lower is not visible at web sizes),
 *   palette-based quantisation for PNG (`quality` under sharp's PNG
 *   encoder controls palette size, not a JPEG-style lossy quality).
 * - sharp strips EXIF/ICC metadata by default (no `.withMetadata()`
 *   call) — a privacy win (camera GPS tags, device serials) that also
 *   shaves a further few KB off every photo.
 *
 * Falls back to the original bytes if compression ever produces a
 * larger file than it started with (rare, but possible for an already
 * heavily-optimised source image) or if sharp throws on a technically
 * valid-per-sniff() but malformed image — never blocks an upload on a
 * compression failure.
 */
export async function compressImage(buf: Buffer, mime: string): Promise<Buffer> {
  if (mime !== 'image/jpeg' && mime !== 'image/png') return buf;

  try {
    const pipeline = sharp(buf).rotate().resize({
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    });

    const out = mime === 'image/jpeg'
      ? await pipeline.jpeg({ quality: 78, mozjpeg: true }).toBuffer()
      : await pipeline.png({ quality: 80, compressionLevel: 9, palette: true }).toBuffer();

    return out.length > 0 && out.length < buf.length ? out : buf;
  } catch {
    return buf;
  }
}
