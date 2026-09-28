'use client';
import { useState, useTransition } from 'react';
import { Icon, Modal } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionSetTreasuryPolicy } from './actions';

interface Props {
  orgId: string;
  contributionsEnabled: boolean;
  contributionAmountKes: number | null;
  contributionCycle: string | null;
  joinFeeKes: number | null;
}

/** Officer-only settings for whether/how this group collects
 *  contributions and whether joining costs anything — see
 *  contributionsEnabled/contributionAmountKes/contributionCycle/
 *  joinFeeKes on GroupTreasuryPolicy. */
export function TreasuryPolicyForm(props: Props) {
  const [open, setOpen] = useState(false);
  const [contributionsEnabled, setContributionsEnabled] = useState(props.contributionsEnabled);
  const [contributionAmountKes, setContributionAmountKes] = useState(props.contributionAmountKes?.toString() ?? '');
  const [contributionCycle, setContributionCycle] = useState(props.contributionCycle ?? '');
  const [joinFeeKes, setJoinFeeKes] = useState(props.joinFeeKes?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function close() { setOpen(false); setError(null); setSaved(false); }

  function submit() {
    setError(null); setSaved(false);
    start(async () => {
      const r = await actionSetTreasuryPolicy({
        orgId: props.orgId,
        contributionsEnabled,
        contributionAmountKes: contributionAmountKes.trim() ? Number(contributionAmountKes) : null,
        contributionCycle: contributionCycle || null,
        joinFeeKes: joinFeeKes.trim() ? Number(joinFeeKes) : null,
      });
      if (r.ok) { setSaved(true); announce('Settings saved.', 'polite'); } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <>
      <button type="button" className="btn btn-o" onClick={() => setOpen(true)}>
        <Icon name="key" size={16} />Contributions &amp; joining
      </button>

      {open && (
        <Modal
          title="Contributions & joining"
          onClose={close}
          footer={(
            <>
              <button type="button" className="btn btn-o" disabled={pending} onClick={close}>
                {saved ? 'Close' : 'Cancel'}
              </button>
              <button type="button" className="btn btn-p" disabled={pending} onClick={submit}>
                {pending ? 'Saving…' : 'Save settings'}
              </button>
            </>
          )}
        >
          <div className="fld">
            <label className="lab" htmlFor="tp-contrib-on">Does this group collect contributions?</label>
            <select className="inp" id="tp-contrib-on" value={contributionsEnabled ? 'yes' : 'no'}
              onChange={(e) => setContributionsEnabled(e.target.value === 'yes')}>
              <option value="yes">Yes</option>
              <option value="no">No — one-off collections only</option>
            </select>
          </div>
          {contributionsEnabled && (
            <>
              <div className="fld">
                <label className="lab" htmlFor="tp-amt">Expected amount (KES, optional)</label>
                <input className="inp mono" id="tp-amt" inputMode="decimal" value={contributionAmountKes}
                  onChange={(e) => setContributionAmountKes(e.target.value)} placeholder="500" />
              </div>
              <div className="fld">
                <label className="lab" htmlFor="tp-cycle">How often?</label>
                <select className="inp" id="tp-cycle" value={contributionCycle} onChange={(e) => setContributionCycle(e.target.value)}>
                  <option value="">No fixed cycle</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </>
          )}
          <div className="fld">
            <label className="lab" htmlFor="tp-joinfee">Join fee (KES, optional)</label>
            <input className="inp mono" id="tp-joinfee" inputMode="decimal" value={joinFeeKes}
              onChange={(e) => setJoinFeeKes(e.target.value)} placeholder="Leave blank for free to join" />
            <p className="hint">
              A new member's spot stays pending until this is paid and confirmed. Changing it never
              affects members already active.
            </p>
          </div>
          {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
          {saved && !error && (
            <p style={{ color: 'var(--green)', fontSize: '.88rem', margin: 0 }}>
              <Icon name="check" size={14} /> Saved.
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
