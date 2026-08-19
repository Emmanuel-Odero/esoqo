import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { RichText } from '@/components/RichText';

export const dynamic = 'force-dynamic';

export default async function FaqPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const faq = Array.isArray(page.faq) ? (page.faq as { q: string; a: string }[]) : [];

  return (
    <OrgSectionShell slug={slug} title="FAQ">
      <section className="osec">
        <h2>Frequently asked</h2>
        {faq.length === 0 ? (
          <p>No questions answered yet.</p>
        ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            {faq.map((item, i) => (
              <details key={i} className="faqitem">
                <summary className="faqq">{item.q}</summary>
                <RichText html={item.a} className="faqa" />
              </details>
            ))}
          </div>
        )}
      </section>
    </OrgSectionShell>
  );
}
