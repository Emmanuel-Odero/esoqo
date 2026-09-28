import { Icon, type IconName } from '@esoqo/ui';
import { getDisplayPrefs, getMyRecord } from '@esoqo/db';
import { formatMsisdn } from '@esoqo/domain';
import { requireSubject } from '@/lib/session';
import { PrefsPanel } from './PrefsPanel';
import { CloseAccountPanel } from './CloseAccountPanel';
import { EsoqoIdCard } from './EsoqoIdCard';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = {
  PENDING_REVIEW: ['b-warn', 'Being checked'],
  ACCEPTED: ['b-ok', 'Accepted'],
  REJECTED: ['b-bad', 'Not accepted'],
  SUPERSEDED: ['b-mute', 'Replaced'],
};

function fileIcon(mime: string): IconName {
  if (mime.startsWith('image/')) return 'certificate';
  if (mime.includes('sheet') || mime.includes('excel')) return 'grid';
  return 'document';
}

/**
 * Esoqo's confirmations on this profile — used to be /me home's front
 * door under a "papers confirmed" ring; it lives here now, beside the
 * identity it describes and the files that back it, so the dashboard
 * can lead with what somebody actually does instead of a compliance
 * checklist.
 */
const CREDENTIALS: [string, string, string, string | null][] = [
  ['MSISDN_VERIFIED', 'Phone number confirmed', 'Esoqo', null],
  ['NATIONAL_ID_CONFIRMED', 'National ID confirmed', 'Esoqo', 'Needed for credit above KES 50,000'],
  ['GROUP_REGISTERED', 'Group registered', 'Ministry of Labour', 'Opens a group bank account'],
  ['BUSINESS_REGISTERED', 'Business registered', 'Business Registration Service', 'Lets you sign contracts in your own name'],
  ['KRA_PIN', 'KRA PIN', 'Kenya Revenue Authority', 'Needed for larger facilities'],
];

export default async function SettingsPage() {
  const ctx = await requireSubject();
  const [prefs, me] = await Promise.all([getDisplayPrefs(ctx), getMyRecord(ctx)]);
  const p = me?.person;
  const attestations = me?.attestations ?? [];
  const has = (t: string) => attestations.find((a) => a.claimType === t);
  const docs = me?.documents ?? [];

  const confirmedCount = CREDENTIALS.filter(([type]) => has(type)).length;
  const acceptedDocs = docs.filter((d) => d.status === 'ACCEPTED').length;

  return (
    <>
      <header className="hero" style={{ padding: '4px 0 14px' }}>
        <p className="kicker">Settings</p>
        <h1>Who you are</h1>
        <p className="lead" style={{ maxWidth: 560 }}>
          What Esoqo has confirmed, the files behind it, and how this looks — nothing here touches your balance or your group.
        </p>
      </header>

      <div className="premium-stats" aria-label="Settings at a glance">
        <div className="pstat">
          <span className="pstat-k">Confirmed</span>
          <span className="pstat-v">{confirmedCount} of {CREDENTIALS.length}</span>
          <span className="pstat-h">Identity &amp; credentials</span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Files</span>
          <span className="pstat-v">{docs.length}</span>
          <span className="pstat-h">{docs.length ? `${acceptedDocs} accepted` : 'None uploaded'}</span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Esoqo ID</span>
          <span className="pstat-v" style={{ fontSize: '.92rem' }}>{me?.esoqoPaymentId ? 'Active' : 'Not set'}</span>
          <span className="pstat-h">How people pay you</span>
        </div>
      </div>

      {p && (
        <section className="mcard">
          <h2><Icon name="user" size={18} />Who you are</h2>
          <div className="mrow">
            <span className="k">Name</span>
            <span className="v">{p.knownAs || p.officialName}</span>
          </div>
          {p.knownAs && (
            <div className="mrow"><span className="k">Official name</span><span className="v">{p.officialName}</span></div>
          )}
          <div className="mrow">
            <span className="k">Phone</span>
            <span className="v mono">
              {p.msisdn ? formatMsisdn(p.msisdn) : 'No phone on file'}{' '}
              {p.msisdn && (p.msisdnVerifiedAt
                ? <span className="badge b-ok"><Icon name="check" size={11} />Confirmed</span>
                : <span className="badge b-warn">Not confirmed</span>)}
            </span>
          </div>
          {p.email && <div className="mrow"><span className="k">Email</span><span className="v">{p.email}</span></div>}
          {me && (
            <div className="mrow">
              <span className="k">Where you trade</span>
              <span className="v">{me.county}{me.ward ? ` · ${me.ward}` : ''}</span>
            </div>
          )}
          {me?.enterprises[0] && (
            <div className="mrow"><span className="k">What you do</span><span className="v">{me.enterprises[0].workRaw}</span></div>
          )}
        </section>
      )}

      {me?.esoqoPaymentId && <EsoqoIdCard code={me.esoqoPaymentId.code} />}

      <section className="mcard">
        <h2><Icon name="certificate" size={18} />Confirmations</h2>
        <ul className="papers">
          {CREDENTIALS.map(([type, label, issuer, opens]) => {
            const a = has(type);
            const expiring = a?.expiresAt && a.expiresAt.getTime() - Date.now() < 60 * 864e5;
            return (
              <li className="paper" key={type}>
                <span className={`ps ${a ? (expiring ? 'soon' : 'ok') : 'gap'}`} aria-hidden="true">
                  {a
                    ? <Icon name={expiring ? 'clock' : 'check'} size={16} />
                    : <Icon name="plus" size={16} />}
                </span>
                <span className="pt">
                  <span className="t">{label}</span>
                  <span className="s">
                    {a
                      ? `Given by ${issuer} · ${a.issuedAt.toLocaleDateString('en-KE')}${expiring ? ' · expiring soon' : ''}`
                      : opens ?? `Issued by ${issuer}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mcard">
        <h2><Icon name="document" size={18} />Files you&rsquo;ve given us</h2>
        {docs.length === 0 ? (
          <div className="mempty">
            <span className="ico"><Icon name="document" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>Nothing here yet</h2>
            <p style={{ margin: 0 }}>
              You can add a document at any time — dial *483*77# and choose 6, or ask a field
              officer.
            </p>
          </div>
        ) : (
          <ul className="papers">
            {docs.map((d) => {
              const [cls, label] = STATUS[d.status] ?? ['b-mute', d.status];
              return (
                <li className="paper" key={d.id}>
                  <span className="ps" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
                    <Icon name={fileIcon(d.mimeType)} size={16} />
                  </span>
                  <span className="pt">
                    <span className="t">{d.title}</span>
                    <span className="s">
                      Added {d.uploadedAt.toLocaleDateString('en-KE')} ·{' '}
                      {Math.round(d.sizeBytes / 1024)} KB
                      {d.reviewNote && d.status === 'REJECTED' && ` · ${d.reviewNote}`}
                    </span>
                  </span>
                  <span className={`badge ${cls}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mehead" style={{ marginTop: 8 }}>
        <h2 style={{ marginBottom: 4 }}>How this looks</h2>
        <p>
          These settings are saved to your profile, not to this phone — so they follow you if you
          use a different handset, or borrow someone else's.
        </p>
      </div>
      <PrefsPanel initial={prefs} />
      <CloseAccountPanel />
    </>
  );
}
