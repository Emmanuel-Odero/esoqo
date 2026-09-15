import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import {
  getJamiiPageForManagement, getJamiiSitePageForDashboard, listJamiiPageBlocksForDashboard,
} from '@esoqo/db';
import { requireMyPage } from '@/lib/session';
import { BlockEditor } from '../../_pages/BlockEditor';
import { PageMetaForm } from './PageMetaForm';
import { AboutContentForm } from './AboutContentForm';
import { OrgProfileForm } from './OrgProfileForm';
import { ContactContentForm } from './ContactContentForm';
import { FaqEditor } from '../../settings/FaqEditor';

/**
 * SYSTEM_* pages whose real content is managed elsewhere in the
 * dashboard — Home/Posts/Programmes/Campaigns/Leadership/Gallery each
 * already have their own dedicated screen (individual posts,
 * programmes, campaign records, team members, photos are more than a
 * simple field-editor can hold). About, FAQ and Contact don't need a
 * separate screen — their content is just a handful of fields/rich
 * text, so it's embedded directly below instead (see
 * AboutContentForm/OrgProfileForm/ContactContentForm/FaqEditor).
 */
const CONTENT_LOCATION: Partial<Record<string, { href: Route; label: string }>> = {
  SYSTEM_HOME: { href: '/dashboard/homepage', label: 'Homepage' },
  SYSTEM_POSTS: { href: '/dashboard/posts', label: 'Posts' },
  SYSTEM_PROGRAMS: { href: '/dashboard/programs', label: 'Programmes' },
  SYSTEM_CAMPAIGNS: { href: '/dashboard/campaigns', label: 'Campaigns' },
  SYSTEM_LEADERSHIP: { href: '/dashboard/leadership', label: 'Leadership' },
  SYSTEM_GALLERY: { href: '/dashboard/gallery', label: 'Gallery' },
};

export default async function PageEditorScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, page: myPage } = await requireMyPage();
  const page = await getJamiiPageForManagement(ctx, myPage.organisationId);
  if (!page) notFound();

  const sitePage = await getJamiiSitePageForDashboard(ctx, page.organisationId, id).catch(() => null);
  if (!sitePage) notFound();

  const blocks = await listJamiiPageBlocksForDashboard(ctx, page.organisationId, sitePage.id);
  const isSystem = sitePage.kind !== 'CUSTOM';
  const contentLocation = CONTENT_LOCATION[sitePage.kind];
  const org = page.organisation;

  return (
    <>
      <h1 style={{ marginBottom: 4 }}>{sitePage.title}</h1>
      <p className="sub">
        {isSystem
          ? 'One of your site’s built-in sections — you can edit its title, SEO details, and every section on it, but it can’t be deleted.'
          : `ourjamii.co.ke/o/${page.slug}/${sitePage.slug}`}
      </p>

      {contentLocation && (
        <div className="card" style={{ padding: 14, marginBottom: 20, maxWidth: 640, background: 'var(--paper-alt, #f4efe0)' }}>
          <b>Looking to edit what&rsquo;s actually written on this page?</b>{' '}
          That content is managed from{' '}
          <Link href={contentLocation.href} style={{ color: 'var(--stamp)', fontWeight: 700 }}>
            {contentLocation.label} →
          </Link>
          . What&rsquo;s below is this page&rsquo;s title, search listing, and any extra sections you add on top.
        </div>
      )}

      {sitePage.kind === 'SYSTEM_ABOUT' && (
        <>
          <AboutContentForm
            pageId={page.organisationId}
            initial={{
              tagline: page.tagline ?? '',
              missionShort: page.missionShort ?? '',
              visionShort: page.visionShort ?? '',
              aboutUs: page.aboutUs ?? '',
            }}
          />
          <OrgProfileForm
            pageId={page.organisationId}
            initial={{
              officialName: org.officialName,
              orgKind: org.kind,
              orgKindOther: org.kindOther ?? '',
              tags: org.tags.join(', '),
              county: org.party.county,
              ward: org.party.ward ?? '',
              registrationNo: org.registrationNo ?? '',
              memberCount: org.memberCount ? String(org.memberCount) : '',
            }}
          />
        </>
      )}

      {sitePage.kind === 'SYSTEM_CONTACT' && (
        <ContactContentForm
          pageId={page.organisationId}
          initial={{
            meetingSchedule: page.meetingSchedule ?? '',
            contactPhone: page.contactPhone ?? '',
            contactEmail: page.contactEmail ?? '',
            website: page.website ?? '',
            facebook: page.facebook ?? '',
            twitter: page.twitter ?? '',
            instagram: page.instagram ?? '',
            whatsapp: page.whatsapp ?? '',
          }}
        />
      )}

      {sitePage.kind === 'SYSTEM_FAQ' && (
        <FaqEditor
          pageId={page.organisationId}
          initial={Array.isArray(page.faq) ? (page.faq as { q: string; a: string }[]) : []}
        />
      )}

      <PageMetaForm
        pageId={page.organisationId}
        sitePage={{
          id: sitePage.id,
          title: sitePage.title,
          slug: sitePage.slug,
          status: sitePage.status,
          seoTitle: sitePage.seoTitle,
          seoDescription: sitePage.seoDescription,
          isSystem,
        }}
      />

      <h2 style={{ marginTop: 28, marginBottom: 8, fontSize: '1.05rem' }}>Sections</h2>
      <BlockEditor
        pageId={page.organisationId}
        sitePageId={sitePage.id}
        photos={page.photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption }))}
        initialBlocks={blocks.map((b) => ({ id: b.id, type: b.type, visible: b.visible, data: b.data as Record<string, unknown> }))}
        saveLabel="Save sections"
      />
    </>
  );
}
