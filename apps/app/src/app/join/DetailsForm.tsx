'use client';

import { Icon } from '@esoqo/ui';
import { COUNTIES } from '@esoqo/domain';
import type { JoinDetails } from './actions';

/**
 * Every field here may have come straight from OCR (see JoinWizard's
 * runOcr) — this form is the correction step, never a rubber stamp.
 * Nothing here is trusted or persisted until the person reviews it and
 * presses Continue.
 */
export function DetailsForm({
  details, onChange, error, pending, onSubmit,
}: {
  details: JoinDetails;
  onChange: (d: JoinDetails) => void;
  error: string | null;
  pending: boolean;
  onSubmit: () => void;
}) {
  function set<K extends keyof JoinDetails>(key: K, value: JoinDetails[K]) {
    onChange({ ...details, [key]: value });
  }

  const canSubmit = details.firstName.trim() && details.surname.trim()
    && details.county.trim() && details.msisdn.replace(/\D/g, '').length >= 10;

  return (
    <div>
      <p className="sub" style={{ marginBottom: 14 }}>
        Check these details — we filled in what we could read off your ID.
      </p>

      <div className="fld">
        <label className="lab" htmlFor="j-first">First name *</label>
        <input className="inp" id="j-first" value={details.firstName} onChange={(e) => set('firstName', e.target.value)} />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="j-middle">Middle name</label>
        <input className="inp" id="j-middle" value={details.middleName ?? ''} onChange={(e) => set('middleName', e.target.value)} />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="j-surname">Surname *</label>
        <input className="inp" id="j-surname" value={details.surname} onChange={(e) => set('surname', e.target.value)} />
      </div>
      <div className="grid2" style={{ gap: 14 }}>
        <div className="fld">
          <label className="lab" htmlFor="j-dob">Date of birth</label>
          <input className="inp" id="j-dob" type="date" value={details.dateOfBirth ?? ''} onChange={(e) => set('dateOfBirth', e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="j-sex">Sex</label>
          <select className="inp" id="j-sex" value={details.sex ?? ''} onChange={(e) => set('sex', e.target.value)}>
            <option value="">Select…</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </div>
      </div>

      <div className="fld">
        <label className="lab" htmlFor="j-idnum">ID number</label>
        <input className="inp mono" id="j-idnum" value={details.idNumber ?? ''} onChange={(e) => set('idNumber', e.target.value)} />
      </div>
      <div className="grid2" style={{ gap: 14 }}>
        <div className="fld">
          <label className="lab" htmlFor="j-serial">Serial number</label>
          <input className="inp mono" id="j-serial" value={details.serialNumber ?? ''} onChange={(e) => set('serialNumber', e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="j-district">District of birth</label>
          <input className="inp" id="j-district" value={details.districtOfBirth ?? ''} onChange={(e) => set('districtOfBirth', e.target.value)} />
        </div>
      </div>

      <div className="fld">
        <label className="lab" htmlFor="j-county">County *</label>
        <select className="inp" id="j-county" value={details.county} onChange={(e) => set('county', e.target.value)}>
          <option value="">Select…</option>
          {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="j-ward">Ward or market (optional)</label>
        <input className="inp" id="j-ward" value={details.ward ?? ''} onChange={(e) => set('ward', e.target.value)} />
      </div>

      <div className="fld">
        <label className="lab" htmlFor="j-msisdn"><Icon name="phone" size={15} />Phone number *</label>
        <input className="inp mono" id="j-msisdn" value={details.msisdn} onChange={(e) => set('msisdn', e.target.value)} inputMode="tel" />
        <p className="hint">We&apos;ll text a code here to confirm it&apos;s you.</p>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="j-email">Email (optional)</label>
        <input className="inp" id="j-email" type="email" value={details.email ?? ''} onChange={(e) => set('email', e.target.value)} />
      </div>

      {error && <div className="note n-red" style={{ marginBottom: 16 }}><div><p>{error}</p></div></div>}

      <button type="button" className="btn btn-p" style={{ width: '100%' }} disabled={pending || !canSubmit} onClick={onSubmit}>
        {pending ? 'Sending code…' : 'Send verification code'} <Icon name="send" size={16} />
      </button>
    </div>
  );
}
