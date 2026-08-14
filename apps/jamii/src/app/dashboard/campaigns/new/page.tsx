import { requireMyPage } from '@/lib/session';
import { CampaignForm } from './CampaignForm';

export default async function NewCampaignScreen() {
  const { page } = await requireMyPage();
  return (
    <>
      <h1>New Campaign</h1>
      <p className="sub">Set a goal and tell donors what it&rsquo;s for.</p>
      <CampaignForm pageId={page.organisationId} />
    </>
  );
}
