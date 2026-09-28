'use client';

import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { COUNTIES, normaliseMsisdn } from '@esoqo/domain';
import type { JoinDetails } from './actions';
import type { JoinInvite } from './JoinWizard';

/**
 * The review step.
 *
 * Every field here may have come straight from OCR (see JoinWizard's
 * runOcr) — this form is the correction step, never a rubber stamp.
 * Nothing here is trusted or persisted until the person reviews it and
 * presses Continue.
 *
 * Which is why the fields the scan filled are *marked*. Filling them
 * silently under a line reading "we filled in what we could read off your
 * ID" tells someone that an unnamed subset of a thirteen-field form was
 * machine-read and leaves them to work out which. The two failure modes
 * that produces are opposite and both bad: trusting a misread ID number
 * because it looks as authoritative as everything else, or re-typing ten
 * correct fields out of suspicion. A badge on the scanned ones resolves
 * both, and the photos stay on screen so checking a digit does not mean
 * going back a step.
 *
 * ## Why it is broken into sections
 *
 * Thirteen inputs in one undifferentiated column is a form that looks
 * like work before you have read a single label, and this one is shown to
 * someone signing up on a phone — often their first contact with Esoqo,
 * often standing in a market. Grouping them into five short, named
 * sections ("Your name", "How we reach you") does not remove a single
 * field, but it turns one long demand into five small, obviously-finite
 * ones, and it lets each group carry a sentence explaining *why* it is
 * being asked. Nobody objects to giving a date of birth; they object to
 * giving it for no stated reason.
 *
 * Two smaller courtesies in the same spirit:
 *
 * - **Optional means optional, out loud.** Four of the thirteen fields
 *   are actually required. Marking the required ones with an asterisk
 *   leaves nine fields looking compulsory to anyone who does not read
 *   asterisks as a convention — so the nine are labelled "optional"
 *   instead, and the four are simply expected.
 *
 * - **The button is never a dead end.** It used to be `disabled` until
 *   everything needed was present, which is the cruellest possible
 *   failure state: an unresponsive button and nothing saying why. It now
 *   always presses, and an incomplete form gets a short list of what is
 *   missing plus focus moved to the first one.
 */

/** The four fields registration genuinely cannot complete without — see
 *  actionStartJoin's own validation, which this mirrors so the person
 *  hears about a problem before a round trip rather than after. */
const REQUIRED: Array<{ field: keyof JoinDetails; id: string; problem: string }> = [
  { field: 'firstName', id: 'j-first', problem: 'Add your first name' },
  { field: 'surname', id: 'j-surname', problem: 'Add your surname' },
  { field: 'county', id: 'j-county', problem: 'Choose your county' },
  { field: 'msisdn', id: 'j-msisdn', problem: 'Add a phone number we can text a code to' },
];

function problemsIn(details: JoinDetails): Map<keyof JoinDetails, string> {
  const out = new Map<keyof JoinDetails, string>();
  for (const { field, problem } of REQUIRED) {
    const value = String(details[field] ?? '');
    const ok = field === 'msisdn'
      // Stripped of formatting a real Kenyan number has at least 10
      // digits — counting them stops the "+254 7" the field starts out
      // holding from passing as a filled-in number.
      ? value.replace(/\D/g, '').length >= 10
      : value.trim().length > 0;
    if (!ok) out.set(field, problem);
  }
  return out;
}

export function DetailsForm({
  details, onChange, error, pending, onSubmit,
  scanned, scanReport, frontPreview, backPreview, onRescan, invite,
}: {
  details: JoinDetails;
  onChange: (d: JoinDetails) => void;
  error: string | null;
  pending: boolean;
  onSubmit: () => void;
  /** Field names the scan filled in. Empty when it was skipped. */
  scanned: ReadonlySet<string>;
  /** How the scan went, or null when the person chose to type it in. */
  scanReport: { read: number; ranOcr: boolean } | null;
  frontPreview: string | null;
  backPreview: string | null;
  onRescan: () => void;
  invite: JoinInvite | null;
}) {
  const [photosOpen, setPhotosOpen] = useState(false);
  // Problems stay invisible until the first press. Marking fields red
  // before someone has had a chance to fill them in is telling a person
  // they are wrong for not having finished yet.
  const [showProblems, setShowProblems] = useState(false);
  const announce = useAnnounce();

  function set<K extends keyof JoinDetails>(key: K, value: JoinDetails[K]) {
    onChange({ ...details, [key]: value });
  }

  const problems = problemsIn(details);
  const problemFor = (field: keyof JoinDetails) => (showProblems ? problems.get(field) : undefined);

  function submit() {
    if (problems.size > 0) {
      setShowProblems(true);
      const first = REQUIRED.find((r) => problems.has(r.field));
      if (first) {
        const el = document.getElementById(first.id);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus({ preventScroll: true });
      }
      announce(
        problems.size === 1
          ? `One thing left: ${[...problems.values()][0]}`
          : `${problems.size} things left before we can send your code`,
        'assertive',
      );
      return;
    }
    onSubmit();
  }

  // An invite's membership is held against the number the officer used,
  // and completeRegistration attaches this signup to the existing Person
  // by matching on exactly that number. Change it and the account is still
  // created — it just isn't the one the group is waiting for. That is far
  // too quiet a way to lose your place, so it is said out loud here.
  const invitedMsisdn = invite?.msisdn ? normaliseMsisdn(invite.msisdn) : null;
  const typedMsisdn = normaliseMsisdn(details.msisdn);
  const msisdnChanged = Boolean(invitedMsisdn && typedMsisdn && invitedMsisdn !== typedMsisdn);

  return (
    <div>
      <ScanSummary report={scanReport} onRescan={onRescan} />

      {(frontPreview || backPreview) && (
        <div className="joinphotos">
          <button
            type="button" className="joinphotos-toggle" aria-expanded={photosOpen}
            onClick={() => setPhotosOpen((v) => !v)}
          >
            <Icon name={photosOpen ? 'chevron-down' : 'chevron-right'} size={14} />
            Your ID photos
            <span className="hint">kept with your record</span>
          </button>
          {photosOpen && (
            <div className="joinphotos-grid">
              {frontPreview && <img src={frontPreview} alt="Front of your ID" />}
              {backPreview && <img src={backPreview} alt="Back of your ID" />}
              <button type="button" className="btn btn-o btn-sm" onClick={onRescan}>
                <Icon name="refresh" size={14} /> Retake or re-read
              </button>
            </div>
          )}
        </div>
      )}

      <Section icon="user" title="Your name" intro="As it appears on your ID, so the two match later.">
        <Field id="j-first" label="First name" scanned={scanned.has('firstName')} problem={problemFor('firstName')}>
          {(p) => (
            <input className="inp" id="j-first" value={details.firstName} autoComplete="given-name"
              onChange={(e) => set('firstName', e.target.value)} {...p} />
          )}
        </Field>
        <Field id="j-middle" label="Middle name" optional scanned={scanned.has('middleName')}>
          {(p) => (
            <input className="inp" id="j-middle" value={details.middleName ?? ''} autoComplete="additional-name"
              onChange={(e) => set('middleName', e.target.value)} {...p} />
          )}
        </Field>
        <Field id="j-surname" label="Surname" scanned={scanned.has('surname')} problem={problemFor('surname')}>
          {(p) => (
            <input className="inp" id="j-surname" value={details.surname} autoComplete="family-name"
              onChange={(e) => set('surname', e.target.value)} {...p} />
          )}
        </Field>
      </Section>

      <Section
        icon="phone" title="How we reach you"
        intro="Your phone number is how you sign in to Esoqo, so this is the one to get right."
      >
        <Field
          id="j-msisdn" label="Phone number" problem={problemFor('msisdn')}
          hint="We'll text a six-digit code here to confirm it's you."
        >
          {(p) => (
            <input className="inp mono" id="j-msisdn" value={details.msisdn} inputMode="tel" autoComplete="tel"
              onChange={(e) => set('msisdn', e.target.value)} {...p} />
          )}
        </Field>
        {msisdnChanged && invite && (
          <div className="note n-amber" style={{ marginBottom: 15 }}>
            <Icon name="alert-triangle" size={18} />
            <div>
              <strong>That&rsquo;s not the number you were invited on</strong>
              <p>
                Your place in {invite.orgName} is held against {invite.msisdn}. Signing up on a
                different number will create an account without that membership &mdash; use the
                invited number, or ask an officer to invite this one instead.
              </p>
            </div>
          </div>
        )}
        <Field id="j-email" label="Email" optional hint="Only used for receipts and notices. You can add it later.">
          {(p) => (
            <input className="inp" id="j-email" type="email" value={details.email ?? ''} autoComplete="email"
              onChange={(e) => set('email', e.target.value)} {...p} />
          )}
        </Field>
      </Section>

      <Section icon="map" title="Where you are" intro="This is how we show you prices and groups near you.">
        <Field
          id="j-county" label="County" scanned={scanned.has('county')} problem={problemFor('county')}
          hint={scanned.has('county')
            ? 'Worked out from the district on your ID, which is where you were born — change it if you live somewhere else now.'
            : undefined}
        >
          {(p) => (
            <select className="inp" id="j-county" value={details.county}
              onChange={(e) => set('county', e.target.value)} {...p}>
              <option value="">Choose your county…</option>
              {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </Field>
        <Field id="j-ward" label="Ward or market" optional hint="Helpful if you trade somewhere in particular.">
          {(p) => (
            <input className="inp" id="j-ward" value={details.ward ?? ''}
              onChange={(e) => set('ward', e.target.value)} {...p} />
          )}
        </Field>
      </Section>

      {/* Every field in this section is optional, so it is said once here
          rather than badged six times — six "optional" pills next to six
          "from your ID" pills is noise, and in the paired narrow columns
          it crowds the labels off their own line. */}
      <Section
        icon="document" title="From your ID card"
        intro={scanReport && scanReport.read > 0
          ? 'Read off the photo you took — worth a glance, since a scan gets it close rather than right. All optional: leave blank anything that did not come out.'
          : 'All optional, but filling them in now saves you proving who you are later.'}
      >
        <div className="grid2">
          <Field id="j-dob" label="Date of birth" scanned={scanned.has('dateOfBirth')}>
            {(p) => (
              <input className="inp" id="j-dob" type="date" value={details.dateOfBirth ?? ''}
                onChange={(e) => set('dateOfBirth', e.target.value)} {...p} />
            )}
          </Field>
          <Field id="j-sex" label="Sex" scanned={scanned.has('sex')}>
            {(p) => (
              <select className="inp" id="j-sex" value={details.sex ?? ''}
                onChange={(e) => set('sex', e.target.value)} {...p}>
                <option value="">Choose…</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            )}
          </Field>
        </div>
        <Field
          id="j-idnum" label="ID number" scanned={scanned.has('idNumber')}
          hint={scanned.has('idNumber')
            ? 'Worth checking digit by digit — this is the one field a misread number is hardest to notice later.'
            : undefined}
        >
          {(p) => (
            <input className="inp mono" id="j-idnum" value={details.idNumber ?? ''} inputMode="numeric"
              onChange={(e) => set('idNumber', e.target.value)} {...p} />
          )}
        </Field>
        <div className="grid2">
          <Field id="j-serial" label="Serial number" scanned={scanned.has('serialNumber')}>
            {(p) => (
              <input className="inp mono" id="j-serial" value={details.serialNumber ?? ''} inputMode="numeric"
                onChange={(e) => set('serialNumber', e.target.value)} {...p} />
            )}
          </Field>
          <Field id="j-issue" label="Date of issue" scanned={scanned.has('dateOfIssue')}>
            {(p) => (
              <input className="inp" id="j-issue" type="date" value={details.dateOfIssue ?? ''}
                onChange={(e) => set('dateOfIssue', e.target.value)} {...p} />
            )}
          </Field>
        </div>
        <Field id="j-district" label="District of birth" scanned={scanned.has('districtOfBirth')}>
          {(p) => (
            <input className="inp" id="j-district" value={details.districtOfBirth ?? ''}
              onChange={(e) => set('districtOfBirth', e.target.value)} {...p} />
          )}
        </Field>
      </Section>

      {showProblems && problems.size > 0 && (
        <div className="note n-amber" style={{ marginBottom: 16 }} role="alert">
          <Icon name="alert-circle" size={18} />
          <div>
            <strong>
              {problems.size === 1 ? 'One thing left' : `${problems.size} things left`}
            </strong>
            <ul className="jproblems">
              {REQUIRED.filter((r) => problems.has(r.field)).map((r) => (
                <li key={r.id}>
                  <button type="button" className="linkish" onClick={() => {
                    const el = document.getElementById(r.id);
                    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    el?.focus({ preventScroll: true });
                  }}>
                    {problems.get(r.field)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {error && <div className="note n-red" style={{ marginBottom: 16 }} role="alert"><div><p>{error}</p></div></div>}

      <button type="button" className="btn btn-p" style={{ width: '100%' }} disabled={pending} onClick={submit}>
        {pending ? 'Sending code…' : 'Send verification code'} <Icon name="send" size={16} />
      </button>
      <p className="hint" style={{ textAlign: 'center' }}>
        Nothing is saved until you confirm the code we send you.
      </p>
    </div>
  );
}

/** A named group of fields with a sentence saying why it is being asked.
 *  Five small, obviously-finite asks read as far less work than one long
 *  undifferentiated column of the same thirteen inputs. */
function Section({
  icon, title, intro, children,
}: {
  icon: IconName;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className="jsec">
      <div className="jsec-h">
        <span className="jsec-ic" aria-hidden="true"><Icon name={icon} size={16} /></span>
        <h2>{title}</h2>
      </div>
      <p className="jsec-intro">{intro}</p>
      {children}
    </section>
  );
}

/**
 * One field: label, its badges, the input, and whatever needs saying
 * under it.
 *
 * The input is a render prop rather than a `type`/`value` API because
 * these are genuinely different controls — text, date, select, tel — and
 * a wrapper that tried to own all of them would be a worse version of the
 * elements themselves. It hands back only the props that have to stay in
 * sync with the label: the accessibility wiring nobody should be able to
 * forget on one field out of thirteen.
 */
function Field({
  id, label, optional = false, scanned = false, hint, problem, children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  /** Read off the ID photo, so flagged as machine-read and worth a check. */
  scanned?: boolean;
  hint?: string;
  problem?: string;
  children: (props: {
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const problemId = problem ? `${id}-problem` : undefined;
  const describedBy = [problemId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="fld">
      <label className="lab" htmlFor={id}>
        {label}
        {(optional || scanned) && (
          <span className="labpills">
            {optional && <span className="optpill">optional</span>}
            {/* Text as well as colour: which fields were machine-read is
                information a screen reader needs too, not decoration. */}
            {scanned && (
              <span className="scanpill">
                <Icon name="document" size={11} /> from your ID
              </span>
            )}
          </span>
        )}
      </label>
      {children({
        ...(problem ? { 'aria-invalid': true as const } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {problem && (
        <p className="err" id={problemId}>
          <Icon name="alert-circle" size={14} />{problem}
        </p>
      )}
      {hint && <p className="hint" id={hintId}>{hint}</p>}
    </div>
  );
}

/**
 * How the scan went, said plainly.
 *
 * Three genuinely different outcomes, and a single line ("we filled in
 * what we could read off your ID") is wrong for two of them: it claims a
 * successful read when OCR threw, and it claims one when the person
 * skipped the scan entirely and is looking at a blank form wondering what
 * was filled in.
 */
function ScanSummary({
  report, onRescan,
}: {
  report: { read: number; ranOcr: boolean } | null;
  onRescan: () => void;
}) {
  if (!report) {
    return (
      <p className="sub" style={{ marginBottom: 16 }}>
        Fill these in and we&apos;ll text a code to confirm your number.{' '}
        <button type="button" className="linkish" onClick={onRescan}>Scan your ID instead</button>
        {' '}if you&apos;d rather not type it all.
      </p>
    );
  }

  if (report.read === 0) {
    return (
      <div className="note n-amber" style={{ marginBottom: 16 }}>
        <Icon name="alert-circle" size={18} />
        <div>
          <strong>
            {report.ranOcr
              ? 'We couldn’t read anything off that photo'
              : 'Reading your ID didn’t work on this device'}
          </strong>
          <p>
            {report.ranOcr
              ? 'Usually it is light or focus — a flat card in daylight, filling the frame, reads best.'
              : 'Nothing is lost: your photos are still here and will be kept with your record.'}
            {' '}You can try again or just type the details in.
          </p>
          <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 8 }} onClick={onRescan}>
            <Icon name="refresh" size={14} /> Try scanning again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="note n-green" style={{ marginBottom: 16 }}>
      <Icon name="check-circle" size={18} />
      <div>
        <strong>
          We read {report.read} {report.read === 1 ? 'detail' : 'details'} off your ID
        </strong>
        <p>
          They are marked <em>from your ID</em>{' '}below. Check them against the card and fix
          anything wrong &mdash; a scan gets it close, not right.
        </p>
      </div>
    </div>
  );
}
