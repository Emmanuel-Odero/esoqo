import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';

export const dynamic = 'force-dynamic';

export default async function OrgContactPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);

  return (
    <OrgSectionShell slug={slug}>
      <section className="osec">
        <h2>Contact</h2>
        <ul className="contactlist">
          {page.meetingSchedule && <li><b>Meets</b><span>{page.meetingSchedule}</span></li>}
          {page.contactPhone && <li><b>Phone</b><span className="mono">{page.contactPhone}</span></li>}
          {page.contactEmail && <li><b>Email</b><span className="mono">{page.contactEmail}</span></li>}
          {page.website && <li><b>Website</b><span>{page.website}</span></li>}
          {!page.meetingSchedule && !page.contactPhone && !page.contactEmail && !page.website && (
            <li><span>This organisation hasn&rsquo;t added contact details yet.</span></li>
          )}
        </ul>
      </section>
    </OrgSectionShell>
  );
}
