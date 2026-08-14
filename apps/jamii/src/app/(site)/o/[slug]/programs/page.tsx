import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { Accordion } from '@/components/Accordion';

export const dynamic = 'force-dynamic';

export default async function ProgramsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);

  return (
    <OrgSectionShell slug={slug}>
      <section className="osec">
        <h2>Programs</h2>
        {page.programs.length === 0 ? (
          <p>No programmes listed yet.</p>
        ) : (
          <Accordion
            defaultOpen={0}
            items={page.programs.map((p) => ({ title: p.title, icon: p.icon ?? undefined, body: p.body }))}
          />
        )}
      </section>
    </OrgSectionShell>
  );
}
