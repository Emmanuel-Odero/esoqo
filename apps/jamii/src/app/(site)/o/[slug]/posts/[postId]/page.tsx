import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getJamiiPost } from '@esoko/db';
import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { getOrgLinkMode, orgHref } from '@/lib/org-links';

export const dynamic = 'force-dynamic';

export default async function PostDetailPage({
  params,
}: { params: Promise<{ slug: string; postId: string }> }) {
  const { slug, postId } = await params;
  const page = await loadOrgOr404(slug);
  const post = await getJamiiPost(page.organisationId, postId);
  if (!post) notFound();
  const mode = await getOrgLinkMode(slug);

  return (
    <OrgSectionShell slug={slug} title={post.title} noSidebar>
      <section className="osec" style={{ marginBottom: 0 }}>
        <Link href={orgHref(mode, 'posts')} style={{ color: 'var(--stamp)', fontWeight: 700, fontSize: '.85rem', display: 'inline-block', marginBottom: 16 }}>
          ← Back to updates
        </Link>
        {post.imageUrl && (
          <div style={{ height: 260, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
            <img src={post.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}
        <h2>{post.title}</h2>
        <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.75rem', color: '#8a8368' }}>
          {(post.publishedAt ?? post.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
          {' · '}{page.organisation.officialName}
        </p>
        <p>{post.body}</p>
      </section>
    </OrgSectionShell>
  );
}
