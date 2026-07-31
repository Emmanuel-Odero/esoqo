import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { getMyRecord } from '@esoko/db';
import { formatMsisdn } from '@esoko/domain';
import { requireSubject } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * "Your standing" — the record as a document that visibly fills in.
 *
 * The gaps are as legible as the entries, and each gap names what filling
 * it would open. That was the design decision in the channels document:
 * an empty state that explains nothing is a failure.
 */
export default async function MePage() {
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  if (!me) return <p>Record not found.</p>;

  const p = me.person!;
  const held = me.attestations;
  const has = (t: string) => held.find((a) => a.claimType === t);
  const membership = me.memberships[0];
  const group = membership?.org;

  const CREDENTIALS = [
    ['MSISDN_VERIFIED', 'Phone number confirmed', 'Esoko', null],
    ['NATIONAL_ID_CONFIRMED', 'National ID confirmed', 'Esoko', 'Needed for credit above KES 50,000'],
    ['GROUP_REGISTERED', 'Group registered', 'Ministry of Labour', 'Opens a group bank account'],
    ['BUSINESS_REGISTERED', 'Business registered', 'Business Registration Service', 'Lets you sign contracts in your own name'],
    ['KRA_PIN', 'KRA PIN', 'Kenya Revenue Authority', 'Needed for larger facilities'],
  ] as const;

  return (
    <>
      <div className="mehead">
        <h1>Your standing</h1>
        <p>Everything Esoko holds about you. Nobody else sees any of it unless you say so.</p>
      </div>

      <div className="mcard">
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
            {formatMsisdn(p.msisdn)}{' '}
            {p.msisdnVerifiedAt
              ? <span className="badge b-ok"><Icon name="check" size={11} />Confirmed</span>
              : <span className="badge b-warn">Not confirmed</span>}
          </span>
        </div>
        {p.email && <div className="mrow"><span className="k">Email</span><span className="v">{p.email}</span></div>}
        <div className="mrow">
          <span className="k">Where you trade</span>
          <span className="v">{me.county}{me.ward ? ` · ${me.ward}` : ''}</span>
        </div>
        {me.enterprises[0] && (
          <div className="mrow"><span className="k">What you do</span><span className="v">{me.enterprises[0].workRaw}</span></div>
        )}
      </div>

      <div className="mcard">
        <h2><Icon name="certificate" size={18} />Your papers</h2>
        {CREDENTIALS.map(([type, label, issuer, opens]) => {
          const a = has(type);
          const expiring = a?.expiresAt && a.expiresAt.getTime() - Date.now() < 60 * 864e5;
          return (
            <div className="mrow" key={type}>
              <span className="k" style={{ width: 30 }}>
                {a
                  ? <Icon name={expiring ? 'clock' : 'check-circle'} size={18}
                      style={{ color: expiring ? 'var(--amber)' : 'var(--green)' }} />
                  : <Icon name="plus" size={18} style={{ color: 'var(--tx-3)' }} />}
              </span>
              <span style={{ flex: 1 }}>
                <span className="v" style={{ display: 'block' }}>{label}</span>
                <span className="hint" style={{ margin: 0 }}>
                  {a
                    ? `${issuer} · ${a.issuedAt.toLocaleDateString('en-KE')}${expiring ? ' · expiring soon' : ''}`
                    : opens ?? `Issued by ${issuer}`}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="mcard">
        <h2><Icon name="eye" size={18} />Who can see this</h2>
        <div className="mempty" style={{ padding: '18px 0', textAlign: 'left' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Nobody. You have granted no access.</p>
          <p className="hint" style={{ margin: '6px 0 0' }}>
            Not a bank, not a buyer, not a county, not CECF. When you apply for something you will
            be asked, each time, and you can end it at any point.
          </p>
        </div>
        <Link className="btn btn-o" href="/me/consents" style={{ marginTop: 10 }}>
          <Icon name="arrow-right" size={15} />Manage permissions
        </Link>
      </div>

      {membership && group && (
        <div className="mcard">
          <h2><Icon name="users" size={18} />Your group</h2>
          <div className="mrow">
            <span className="k">Group</span>
            <span className="v">{group.officialName}</span>
          </div>
          <div className="mrow">
            <span className="k">Your role</span>
            <span className="v">{membership.role.toLowerCase()}</span>
          </div>
          <div className="mrow">
            <span className="k">Members</span>
            <span className="v mono">{group._count.members}</span>
          </div>
        </div>
      )}
    </>
  );
}
