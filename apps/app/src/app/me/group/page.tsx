import { Icon } from '@esoko/ui';
import { getMyRecord } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MyGroup() {
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  const m = me?.memberships[0];

  if (!m) {
    return (
      <>
        <div className="mehead"><h1>Your group</h1></div>
        <div className="mcard">
          <div className="mempty">
            <span className="ico"><Icon name="users" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>You are not in a group on Esoko</h2>
            <p style={{ margin: 0 }}>
              If your chama is already here, its treasurer can add you. Dial *483*77# and choose 4
              to ask.
            </p>
          </div>
        </div>
      </>
    );
  }

  const org = m.org.organisation;
  return (
    <>
      <div className="mehead">
        <h1>{org?.officialName}</h1>
        <p>{org?.knownAs && `Known as ${org.knownAs} · `}{m.org.county}</p>
      </div>
      <div className="mcard">
        <h2><Icon name="users" size={18} />Your membership</h2>
        <div className="mrow"><span className="k">Your role</span>
          <span className="v">{m.role.toLowerCase()}</span></div>
        <div className="mrow"><span className="k">Members</span>
          <span className="v mono">{m.org._count.members}</span></div>
        <div className="mrow"><span className="k">You joined</span>
          <span className="v">{m.joinedAt.toLocaleDateString('en-KE')}</span></div>
        <div className="mrow"><span className="k">Registered</span>
          <span className="v">
            {org?.registrationNo
              ? <span className="badge b-ok"><Icon name="check" size={11} />{org.registrationNo}</span>
              : <span className="badge b-warn">Not registered yet</span>}
          </span></div>
      </div>
      <div className="mcard">
        <h2><Icon name="keypad" size={18} />What you can do by dialling</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.92rem', margin: 0 }}>
          Dial <strong className="mono">*483*77#</strong> and choose <strong>4</strong> to see the
          group balance, pay a contribution, vote on a loan, or check who has not paid. It works
          from any handset, including one without internet.
        </p>
      </div>
    </>
  );
}
