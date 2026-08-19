import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { getOrgLinkMode } from '@/lib/org-links';
import { Accordion } from '@/components/Accordion';
import { OrgDonateBand } from '@/components/OrgDonateBand';
import { Icon, type IconName } from '@esoko/ui';

export const dynamic = 'force-dynamic';

export default async function ProgramsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const mode = await getOrgLinkMode(slug);
  const onCustomDomain = mode.base === '';

  return (
    <OrgSectionShell
      slug={slug} title="Programmes" eyebrow="What we do" noSidebar={onCustomDomain}
      lede={onCustomDomain ? 'Each programme answers a real barrier our members raised — not a template of services.' : undefined}
    >
      {page.programs.length === 0 ? (
        <p className={onCustomDomain ? 'wl-lede' : undefined}>No programmes listed yet.</p>
      ) : onCustomDomain ? (
        <>
          <div className="wl-programmes">
            {page.programs.map((prog) => (
              <article key={prog.id} className="wl-programme">
                <div className="wl-prog-idx">
                  <span className="dot" aria-hidden="true" />
                  {prog.icon && <Icon name={prog.icon as IconName} size={14} />}
                  Programme area
                </div>
                <h3>{prog.title}</h3>
                <p>{prog.body}</p>
              </article>
            ))}
          </div>
          <div style={{ marginTop: 56 }}>
            <OrgDonateBand
              mode={mode}
              eyebrow="Fund this work"
              heading="Back one of these programmes"
              body={`Every programme above runs on funding and hands-on partners. Tell ${page.organisation.officialName} which one you'd like to support.`}
              panelBody="A public page — who we are, what we're raising for, and a receipt for every shilling given, sent straight to the donor's phone. Verified by CECF staff."
              ctaLabel="Talk to us about funding"
            />
          </div>
        </>
      ) : (
        <section className="osec">
          <h2>Programs</h2>
          <Accordion
            defaultOpen={0}
            items={page.programs.map((p) => ({ title: p.title, icon: p.icon ?? undefined, body: p.body }))}
          />
        </section>
      )}
    </OrgSectionShell>
  );
}
