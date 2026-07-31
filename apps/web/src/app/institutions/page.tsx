import type { Metadata } from 'next';
import { Icon, type IconName } from '@esoko/ui';
import { anonCtx, listIssuers } from '@esoko/db';

export const metadata: Metadata = {
  title: 'Institutions',
  description: 'Bodies and institutions connected to Esoko, and what each requires.',
};
export const dynamic = 'force-dynamic';

const ICON: Record<string, IconName> = {
  MINISTRY: 'gov', AGENCY: 'building', JUDICIARY: 'scales',
  COUNTY: 'pin', BANK: 'bank', INSURER: 'umbrella', BUYER: 'truck', NGO: 'handshake',
};

export default async function InstitutionsPage() {
  const issuers = await listIssuers(anonCtx());

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Institutions</p>
          <h1>Who is connected, and what each one asks for</h1>
          <p className="lead">
            Lenders, insurers, buyers and government bodies that work with Esoko records — what
            they offer, what they require before they will consider you, and exactly what they
            would see.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="note n-amber">
            <span className="icbox icbox-a icbox-sm"><Icon name="alert-triangle" size={16} /></span>
            <p>
              <strong>Requirements, not approvals.</strong> Meeting what is listed here means an
              institution will consider your application. It does not mean it will be granted, and
              Esoko does not decide.
            </p>
          </div>

          <h2 id="directory" style={{ marginBottom: 14 }}>Who is connected</h2>
          <div className="tbl" style={{ marginBottom: 34 }}>
            <div className="th" style={{ gridTemplateColumns: '1.5fr 1fr 1.4fr' }}>
              <span>Body</span><span>Kind</span><span>What it issues</span>
            </div>
            {issuers.map((i) => (
              <div className="tr" key={i.id} style={{ gridTemplateColumns: '1.5fr 1fr 1.4fr' }}>
                <div className="ib" style={{ alignItems: 'center' }}>
                  <span className="icbox icbox-b icbox-sm">
                    <Icon name={ICON[i.kind] ?? 'building'} size={16} />
                  </span>
                  <div>
                    <strong>{i.name}</strong>
                    {i.shortName && <span className="sub" style={{ display: 'block' }}>{i.shortName}</span>}
                  </div>
                </div>
                <span className="sub">{i.kind.toLowerCase()}</span>
                <span className="sub">
                  {i.allowedClaims.length
                    ? i.allowedClaims.map((c) => c.replace(/_/g, ' ').toLowerCase()).join(', ')
                    : 'Nothing yet'}
                </span>
              </div>
            ))}
          </div>

          <h2 id="consent" style={{ margin: '40px 0 16px' }}>Consent, and how to end it</h2>
          <div className="grid g2">
            <div className="card" style={{ borderLeft: '4px solid var(--green)' }}>
              <span className="icbox icbox-g" style={{ marginBottom: 13 }}>
                <Icon name="shield-check" size={20} />
              </span>
              <h3 style={{ marginBottom: 9 }}>Nothing is shared until you say so</h3>
              <p className="sub" style={{ fontSize: '.93rem', margin: 0 }}>
                An institution sees nothing about you until you grant it, naming that institution
                and the reason, for a period you set. You can end it at any time by dialling
                *483*77# and choosing 5. The institution is told; nothing else you hold changes.
              </p>
            </div>
            <div className="card" id="connect">
              <span className="icbox icbox-b" style={{ marginBottom: 13 }}>
                <Icon name="handshake" size={20} />
              </span>
              <h3 style={{ marginBottom: 9 }}>For institutions</h3>
              <p className="sub" style={{ fontSize: '.93rem', marginBottom: 12 }}>
                If you lend, insure, buy from or license small enterprises in Kenya and want to work
                with verified, consented records, write to{' '}
                <strong style={{ color: 'var(--navy)' }}>partners@esoko.co.ke</strong>.
              </p>
              <p className="sub" style={{ fontSize: '.93rem', margin: 0 }}>
                We will ask what you need to see, what you require, and how you would send outcomes
                back.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
