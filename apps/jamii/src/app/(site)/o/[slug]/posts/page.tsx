import Link from 'next/link';
import { listActiveMediaAssets } from '@esoqo/db';
import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { getOrgLinkMode, orgHref } from '@/lib/org-links';
import { MediaPlaceholder } from '@/components/placeholders/patterns';
import { pickMediaAsset } from '@/lib/media';
import { buildOrgMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [page, mode] = await Promise.all([loadOrgOr404(slug), getOrgLinkMode(slug)]);
  return buildOrgMetadata(page, mode, { path: 'posts', titleSuffix: 'Updates' });
}

export default async function PostsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const mode = await getOrgLinkMode(slug);
  const postPlaceholders = await listActiveMediaAssets('POST');

  return (
    <OrgSectionShell slug={slug} title="Updates" noSidebar>
      <section className="osec" style={{ marginBottom: 0 }}>
        <h2>Updates from the group</h2>
        {page.posts.length === 0 ? (
          <p>No updates yet.</p>
        ) : (
          <div className="postscar">
            {page.posts.map((post) => {
              const placeholder = pickMediaAsset(postPlaceholders, post.id);
              return (
                <Link key={post.id} href={orgHref(mode, `posts/${post.id}`)} className="postcard">
                  <div className="pc-img">
                    {post.imageUrl
                      ? <img src={post.imageUrl} alt="" />
                      : placeholder && <MediaPlaceholder patternKey={placeholder.patternKey} />}
                  </div>
                  <div className="pc-body">
                    <div className="pc-date">
                      {(post.publishedAt ?? post.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                    <h4>{post.title}</h4>
                    {post.excerpt && <p>{post.excerpt}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </OrgSectionShell>
  );
}
