import { ContactForm } from '../ContactForm';
import type { BlockProps } from './types';

interface ContactFormData {
  heading?: string;
  body?: string;
}

/** The public message form, wrapped for the block system — same
 *  ContactForm component the dedicated Contact page uses, styled by
 *  whether this block is rendering into the primary or whitelabel
 *  chrome (see ContactForm's own header comment on `variant`). */
export function ContactFormBlock({ page, mode, data }: BlockProps<ContactFormData>) {
  const orgName = page.organisation.officialName;
  const whitelabel = mode.base === '';

  return (
    <section className="wl-section">
      <div className="wl-section-inner" style={{ maxWidth: 560 }}>
        <div className={whitelabel ? 'wl-form-card' : 'card'} style={whitelabel ? undefined : { padding: 22 }}>
          <h3 style={{ marginBottom: 4 }}>{data.heading?.trim() || 'Send a message'}</h3>
          <p className={whitelabel ? 'wl-lede' : 'sub'} style={{ marginTop: 4, marginBottom: 20 }}>
            {data.body?.trim() || `Goes straight to ${orgName}’s own inbox.`}
          </p>
          <ContactForm pageId={page.organisationId} variant={whitelabel ? 'whitelabel' : 'primary'} orgName={orgName} />
        </div>
      </div>
    </section>
  );
}
