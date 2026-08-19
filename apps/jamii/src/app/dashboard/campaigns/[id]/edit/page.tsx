import { notFound } from 'next/navigation';
import { getCampaign } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { CampaignForm } from '../../CampaignForm';

export default async function EditCampaignScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, page } = await requireMyPage();
  const campaign = await getCampaign(ctx, page.organisationId, id);
  if (!campaign) notFound();

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
    </>
  );
}
