import type { Metadata } from 'next';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <div className="wrap contactwrap wide">
      <div>
        <p className="kick">Get in touch</p>
        <h1 style={{ fontSize: '2rem', color: 'var(--ink)', margin: '12px 0' }}>Contact Our Jamii</h1>
        <p className="sub" style={{ color: '#6b6552', maxWidth: '44ch' }}>
          Questions about setting up an organisation page, a donation, or a partnership — a real
          person reads every message within one working day.
        </p>
        <ul className="contactlist" style={{ marginTop: 24 }}>
          <li><b>Email</b><span>hello@ourjamii.co.ke</span></li>
          <li><b>Phone</b><span>+254 700 000 000, weekdays 8am–5pm</span></li>
          <li><b>Office</b><span>Nairobi, Kenya</span></li>
        </ul>
      </div>
      <div className="card" style={{ padding: 26 }}>
        <ContactForm />
      </div>
    </div>
  );
}
