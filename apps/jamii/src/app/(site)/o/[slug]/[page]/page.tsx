import { notFound } from 'next/navigation';
import { getJamiiSitePageBySlug, listJamiiPageBlocksPublic } from '@esoko/db';
import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { getOrgLinkMode } from '@/lib/org-links';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { buildOrgMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

/**
 * The generic-CMS page renderer — any CUSTOM JamiiSitePage an org has
 * created from the dashboard's "Pages" screen. Next.js resolves the
 * fixed folders (about/, faq/, programs/, ...) ahead of this dynamic
 * segment for the same path, so this only ever sees a slug that isn't
 * one of those reserved names — no conflict with the SYSTEM_* pages,
 * which keep rendering from their own dedicated routes (each has its
 * own bespoke primary-domain vs. whitelabel layout that a generic
 * block renderer can't reproduce without regressing it; see the
 * "Migration safety" section of the CMS plan).
 */
async function loadCustomPage(slug: string, pageSlug: string) {
  const page = await loadOrgOr404(slug);
  const sitePage = await getJamiiSitePageBySlug(page.organisationId, pageSlug);
  if (!sitePage || sitePage.kind !== 'CUSTOM') notFound();
  return { page, sitePage };
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page: pageSlug } = await params;
  const org = await loadOrgOr404(slug).catch(() => null);
  if (!org) return {};
  const mode = await getOrgLinkMode(slug);
  const sitePage = await getJamiiSitePageBySlug(org.organisationId, pageSlug);
  if (!sitePage || sitePage.kind !== 'CUSTOM') return {};
  return buildOrgMetadata(org, mode, {
    path: sitePage.slug,
    titleSuffix: sitePage.title,
    seoTitle: sitePage.seoTitle,
    seoDescription: sitePage.seoDescription,
  });
}

export default async function CustomPage({
  params,
}: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page: pageSlug } = await params;
  const { page, sitePage } = await loadCustomPage(slug, pageSlug);
  const mode = await getOrgLinkMode(slug);
  const blocks = await listJamiiPageBlocksPublic(sitePage.id);

  return (
    <OrgSectionShell slug={slug} title={sitePage.title}>
      {blocks.length === 0 ? (
        <section className="osec">
          <p className="hint">This page doesn&rsquo;t have any sections yet.</p>
        </section>
      ) : (
        blocks.map((block) => <BlockRenderer key={block.id} block={block} page={page} mode={mode} />)
      )}
    </OrgSectionShell>
  );
}
