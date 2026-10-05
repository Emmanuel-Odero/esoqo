'use client';
import { useState } from 'react';
import { Icon, QrCode } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';

/**
 * The code every payer needs to pay this person directly (see /pay and
 * payeeEsoqoId throughout the payments flow) — real everywhere except
 * here. Mobile has shown this since account_details_screen.dart existed;
 * web's getMyRecord simply never fetched it. Same "code + QR + copy"
 * shape as mobile, not a new design.
 */
export function EsoqoIdCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const announce = useAnnounce();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      announce('Esoqo ID copied.', 'polite');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      announce('Could not copy — select and copy the code by hand.', 'assertive');
    }
  }

  return (
    <section className="mcard mcard--premium">
      <h2><Icon name="qr" size={18} />Your Esoqo ID</h2>
      <p className="mcard-lede">
        What anyone pays you with — on the <code className="mono">/pay</code> page, or by scanning
        this code.
      </p>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <QrCode value={code} size={128} />
        <div>
          <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--navy)' }}>{code}</div>
          <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 10 }} onClick={copy}>
            <Icon name={copied ? 'check' : 'link'} size={15} />{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </section>
  );
}
