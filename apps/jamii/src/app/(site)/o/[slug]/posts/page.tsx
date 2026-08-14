import Link from 'next/link';
import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';

export const dynamic = 'force-dynamic';

export default async function PostsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);

  return (
    <OrgSectionShell slug={slug} noSidebar>
      <section className="osec" style={{ marginBottom: 0 }}>
        <h2>Updates from the group</h2>
        {page.posts.length === 0 ? (
          <p>No updates yet.</p>
        ) : (
          <div className="postscar">
            {page.posts.map((post) => (
              <Link key={post.id} href={`/o/${slug}/posts/${post.id}`} className="postcard">
                <div className="pc-img">{post.imageUrl && <img src={post.imageUrl} alt="" />}</div>
                <div className="pc-body">
                  <div className="pc-date">
                    {(post.publishedAt ?? post.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                  <h4>{post.title}</h4>
                  {post.excerpt && <p>{post.excerpt}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </OrgSectionShell>
  );
}
