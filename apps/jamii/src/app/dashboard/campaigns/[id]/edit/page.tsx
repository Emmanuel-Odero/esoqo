import { notFound } from 'next/navigation';
import { getCampaign, listCampaignUpdatesForOwner } from '@esoqo/db';
import { sanitizeRichText } from '@esoqo/domain';
import { requireMyPage } from '@/lib/session';
import { CampaignForm } from '../../CampaignForm';
import { CampaignUpdatesPanel } from '../../CampaignUpdatesPanel';

export default async function EditCampaignScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, page } = await requireMyPage();
  const campaign = await getCampaign(ctx, page.organisationId, id);
  if (!campaign) notFound();

  // CampaignUpdatesPanel renders these bodies with dangerouslySetInnerHTML
  // and is a Client Component, so it cannot use <RichText> (that pulls
  // isomorphic-dompurify/jsdom into the client bundle). Sanitizing here,
  // on the server, gives the same render-time defense in depth: the write
  // path already sanitizes via richTextField, but rows stored before that
  // existed — or written by any direct-DB path — would otherwise reach
  // the browser as raw HTML.
  const stored = await listCampaignUpdatesForOwner(ctx, page.organisationId, campaign.id);
  const updates = stored.map((u) => ({ ...u, body: sanitizeRichText(u.body) }));

  return (
    <>
      <h1>Edit Campaign</h1>
      <p className="sub">Update the goal, story or status donors see.</p>
      <CampaignForm
        pageId={page.organisationId}
        campaignId={campaign.id}
        initial={{
          title: campaign.title,
          summary: campaign.summary,
          body: campaign.body,
          goalKes: Number(campaign.goalKes),
          coverUrl: campaign.coverUrl,
          endsAt: campaign.endsAt ? campaign.endsAt.toISOString().slice(0, 10) : null,
          status: campaign.status,
        }}
      />
      <CampaignUpdatesPanel pageId={page.organisationId} campaignId={campaign.id} initial={updates} />
    </>
  );
}
