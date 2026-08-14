import { OrgSectionShell } from '@/components/OrgSectionShell';
import { loadOrgOr404 } from '@/components/OrgSectionShell';

export const dynamic = 'force-dynamic';

export default async function AboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);

  return (
    <OrgSectionShell slug={slug}>
      <section className="osec">
        <h2>About {page.organisation.officialName}</h2>
        {page.aboutUs
          ? page.aboutUs.split('\n\n').map((para, i) => <p key={i}>{para}</p>)
          : <p>This organisation hasn&rsquo;t written its story yet.</p>}
      </section>
    </OrgSectionShell>
  );
}
