import { notFound } from 'next/navigation';
import { getJamiiPostForManagement } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { PostForm } from '../../new/PostForm';

export default async function EditPostScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, page } = await requireMyPage();
  const post = await getJamiiPostForManagement(ctx, page.organisationId, id);
  if (!post) notFound();

  return (
    <>
      <h1>Edit update</h1>
      <p className="sub">This appears in the updates carousel on your public page.</p>
      <PostForm
        pageId={page.organisationId}
        postId={post.id}
        initial={{ title: post.title, excerpt: post.excerpt ?? '', body: post.body, imageUrl: post.imageUrl }}
      />
    </>
  );
}
