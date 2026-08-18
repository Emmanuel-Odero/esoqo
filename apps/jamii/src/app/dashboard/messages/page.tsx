import { listJamiiContactMessages } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { MessagesPanel } from './MessagesPanel';

export default async function MessagesScreen() {
  const { ctx, page } = await requireMyPage();
  const messages = await listJamiiContactMessages(ctx, page.organisationId);

  return (
    <>
      <h1>Messages</h1>
      <p className="sub">Sent through your public page&rsquo;s Contact form, most recent first.</p>
      <MessagesPanel pageId={page.organisationId} messages={messages} />
    </>
  );
}
