import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * One-time data touch-up, not a schema migration — run once by hand
 * after the Tiptap/rich-text change (see packages/domain/src/rich-text.ts
 * and RichText.tsx) ships. Existing content in these fields is plain
 * text with `\n\n`-separated paragraphs (the old rendering convention);
 * the new renderer expects sanitized HTML instead. This wraps each
 * paragraph in a <p> tag so existing content keeps its visual paragraph
 * breaks under the new renderer, without otherwise altering the text.
 *
 * Idempotent: a value that's already HTML (starts with a tag after
 * trimming) is left untouched, so reruns are harmless.
 *
 * Run with: pnpm --filter @esoqo/db backfill:rich-text
 */

function looksLikeHtml(value: string): boolean {
  return /^\s*<[a-z][a-z0-9]*[\s/>]/i.test(value);
}

/** Plain text -> `<p>` per blank-line-separated paragraph. Escapes the
 *  handful of characters that would otherwise be misread as markup —
 *  everything else in the allow-list (links, formatting) never existed
 *  in the old plain-text convention, so there's nothing else to carry
 *  over. */
function toParagraphHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function backfillValue(value: string | null): string | undefined {
  if (!value?.trim()) return undefined; // nothing to do
  if (looksLikeHtml(value)) return undefined; // already migrated
  return toParagraphHtml(value);
}

async function main() {
  let touched = 0;

  const pages = await prisma.jamiiPage.findMany({ select: { organisationId: true, aboutUs: true, faq: true } });
  for (const page of pages) {
    const aboutUs = backfillValue(page.aboutUs);
    let faq: unknown;
    if (Array.isArray(page.faq)) {
      let faqChanged = false;
      faq = page.faq.map((item) => {
        if (typeof item !== 'object' || item === null || !('a' in item) || typeof (item as { a: unknown }).a !== 'string') return item;
        const a = backfillValue((item as { a: string }).a);
        if (a === undefined) return item;
        faqChanged = true;
        return { ...item, a };
      });
      if (!faqChanged) faq = undefined;
    }
    if (aboutUs !== undefined || faq !== undefined) {
      await prisma.jamiiPage.update({
        where: { organisationId: page.organisationId },
        data: { ...(aboutUs !== undefined ? { aboutUs } : {}), ...(faq !== undefined ? { faq: faq as never } : {}) },
      });
      touched++;
    }
  }

  const programs = await prisma.jamiiProgram.findMany({ select: { id: true, body: true } });
  for (const p of programs) {
    const body = backfillValue(p.body);
    if (body !== undefined) { await prisma.jamiiProgram.update({ where: { id: p.id }, data: { body } }); touched++; }
  }

  const posts = await prisma.jamiiPost.findMany({ select: { id: true, body: true } });
  for (const p of posts) {
    const body = backfillValue(p.body);
    if (body !== undefined) { await prisma.jamiiPost.update({ where: { id: p.id }, data: { body } }); touched++; }
  }

  const campaigns = await prisma.campaign.findMany({ select: { id: true, body: true } });
  for (const c of campaigns) {
    const body = backfillValue(c.body);
    if (body !== undefined) { await prisma.campaign.update({ where: { id: c.id }, data: { body } }); touched++; }
  }

  const updates = await prisma.campaignUpdate.findMany({ select: { id: true, body: true } });
  for (const u of updates) {
    const body = backfillValue(u.body);
    if (body !== undefined) { await prisma.campaignUpdate.update({ where: { id: u.id }, data: { body } }); touched++; }
  }

  console.log(`Backfilled ${touched} row(s) to paragraph HTML.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
