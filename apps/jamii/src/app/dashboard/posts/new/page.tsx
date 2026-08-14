import { requireMyPage } from '@/lib/session';
import { PostForm } from './PostForm';

export default async function NewPostScreen() {
  const { page } = await requireMyPage();
  return (
    <>
      <h1>Add New Post</h1>
      <p className="sub">This appears in the updates carousel on your public page.</p>
      <PostForm pageId={page.organisationId} />
    </>
  );
}
