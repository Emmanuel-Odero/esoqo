import { OrgSectionShell, loadOrgOr404 } from '@/components/OrgSectionShell';
import { getOrgLinkMode } from '@/lib/org-links';
import { ContactForm } from '@/components/ContactForm';

export const dynamic = 'force-dynamic';

export default async function OrgContactPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadOrgOr404(slug);
  const mode = await getOrgLinkMode(slug);
  const onCustomDomain = mode.base === '';
  const orgName = page.organisation.officialName;

  const cards = [
    page.contactPhone && { k: 'Phone / WhatsApp', v: page.contactPhone, hint: 'Public number' },
    page.contactEmail && { k: 'Email', v: page.contactEmail, hint: 'Monitored inbox for partners and supporters' },
    page.meetingSchedule && { k: 'Meets', v: page.meetingSchedule, hint: undefined },
    page.website && { k: 'Website', v: page.website, hint: undefined },
    page.facebook && { k: 'Facebook', v: page.facebook, hint: undefined },
    page.instagram && { k: 'Instagram', v: page.instagram, hint: undefined },
    page.twitter && { k: 'X (Twitter)', v: page.twitter, hint: undefined },
    page.whatsapp && { k: 'WhatsApp', v: page.whatsapp, hint: undefined },
  ].filter((c): c is { k: string; v: string; hint: string | undefined } => Boolean(c));

  return (
    <OrgSectionShell
      slug={slug} title="Contact" eyebrow="Contact" noSidebar={onCustomDomain}
      lede={onCustomDomain ? `For partnerships, referrals, media enquiries or to give — reach ${orgName} through any of the channels below, or send a message directly.` : undefined}
    >
      {onCustomDomain ? (
        <div className="wl-contact-layout">
          <div>
            {cards.length > 0 ? (
              <div className="wl-contact-grid">
                {cards.map((c) => (
                  <div key={c.k} className="wl-contact-card">
                    <div className="k">{c.k}</div>
                    <div className="v">{c.v}</div>
                    {c.hint && <div className="hint">{c.hint}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="wl-lede">This organisation hasn&rsquo;t listed contact channels yet — send a message below instead.</p>
            )}
          </div>
          <div className="wl-form-card">
            <h3>Send a message</h3>
            <p className="wl-lede" style={{ marginTop: 4, marginBottom: 20 }}>Goes straight to {orgName}&rsquo;s own inbox.</p>
            <ContactForm pageId={page.organisationId} variant="whitelabel" orgName={orgName} />
          </div>
        </div>
      ) : (
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
          <div className="card" style={{ padding: 22, marginTop: 22, maxWidth: 560 }}>
            <h3 style={{ marginBottom: 4 }}>Send a message</h3>
            <p className="sub" style={{ marginBottom: 18 }}>Goes straight to {orgName}&rsquo;s own inbox.</p>
            <ContactForm pageId={page.organisationId} variant="primary" orgName={orgName} />
          </div>
        </section>
      )}
    </OrgSectionShell>
  );
}
