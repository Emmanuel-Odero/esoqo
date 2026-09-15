import Link from 'next/link';
import { listJamiiPostsForOwner } from '@esoqo/db';
import { requireMyPage } from '@/lib/session';

export default async function PostsScreen() {
  const { ctx, page } = await requireMyPage();
  const posts = await listJamiiPostsForOwner(ctx, page.organisationId);

  return (
    <>
      <div className="titlebar">
        <div><h1 style={{ marginBottom: 4 }}>Posts</h1><p className="sub" style={{ marginBottom: 0 }}>Updates shown on your public page.</p></div>
        <Link href="/dashboard/posts/new" className="btn btn-ink btn-sm">Add New</Link>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="dtable">
          <thead><tr><th>Title</th><th>Status</th><th>Date</th><th /></tr></thead>
          <tbody>
            {posts.length === 0 ? (
              <tr><td colSpan={4} style={{ color: '#8a8368' }}>No updates yet.</td></tr>
            ) : posts.map((p) => (
              <tr key={p.id}>
                <td><b>{p.title}</b>{p.excerpt && <div style={{ fontSize: '.8rem', color: '#6b6552' }}>{p.excerpt}</div>}</td>
                <td><span className={`status-pill ${p.status === 'PUBLISHED' ? 'status-active' : 'status-draft'}`}>{p.status === 'PUBLISHED' ? 'Published' : 'Draft'}</span></td>
                <td className="mono">{p.createdAt.toLocaleDateString('en-KE')}</td>
                <td><Link href={`/dashboard/posts/${p.id}/edit`}>Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
