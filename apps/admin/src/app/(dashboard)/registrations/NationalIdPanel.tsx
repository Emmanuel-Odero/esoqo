'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  actionUploadNationalIdImage, actionSaveNationalId, actionGetNationalId, actionConfirmNationalId,
} from './actions';

/**
 * Manual-entry-after-scan capture, per the Phase 3 plan: front/back
 * photos go through the same upload pipeline every other document
 * uses, and staff type what the card says — no OCR call happens here.
 * A follow-up wires an OCR provider to prefill these same fields once
 * one is chosen; this form stays either way, since a legal ID should
 * never be trusted on OCR output alone.
 */

type GetResult = Awaited<ReturnType<typeof actionGetNationalId>>;
type OkResult = Extract<GetResult, { ok: true }>;
type NationalIdRecord = OkResult['record'];

export default function NationalIdPanel({ partyId }: { partyId: string }) {
  const [record, setRecord] = useState<NationalIdRecord>(null);
  const [idNumber, setIdNumber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [sex, setSex] = useState('');
  const [districtOfBirth, setDistrictOfBirth] = useState('');
  const [dateOfIssue, setDateOfIssue] = useState('');
  const [frontDocumentId, setFrontDocumentId] = useState<string | undefined>(undefined);
  const [backDocumentId, setBackDocumentId] = useState<string | undefined>(undefined);
  const [uploadingSide, setUploadingSide] = useState<'front' | 'back' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  useEffect(() => {
    void (async () => {
      const r = await actionGetNationalId(partyId);
      if (r.ok && r.record) {
        setRecord(r.record);
        setIdNumber(r.record.idNumber);
        setSerialNumber(r.record.serialNumber ?? '');
        setSex(r.record.sex ?? '');
        setDistrictOfBirth(r.record.districtOfBirth ?? '');
        setDateOfIssue(r.record.dateOfIssue ?? '');
        setFrontDocumentId(r.record.frontDocumentId ?? undefined);
        setBackDocumentId(r.record.backDocumentId ?? undefined);
      }
    })();
  }, [partyId]);

  function upload(side: 'front' | 'back', file: File) {
    setError(null);
    setUploadingSide(side);
    start(async () => {
      const fd = new FormData();
      fd.set('partyId', partyId);
      fd.set('side', side);
      fd.set('file', file);
      const r = await actionUploadNationalIdImage(fd);
      setUploadingSide(null);
      if (r.ok) {
        if (side === 'front') setFrontDocumentId(r.doc.id); else setBackDocumentId(r.doc.id);
        announce(`${side === 'front' ? 'Front' : 'Back'} image uploaded`, 'assertive');
      } else setError(r.error);
    });
  }

  function save() {
    if (!idNumber.trim()) { setError('Enter the ID number'); return; }
    setError(null);
    start(async () => {
      const r = await actionSaveNationalId(partyId, {
        idNumber, serialNumber: serialNumber || undefined, sex: sex || undefined,
        districtOfBirth: districtOfBirth || undefined, dateOfIssue: dateOfIssue || undefined,
        frontDocumentId, backDocumentId,
      });
      if (r.ok) {
        announce('National ID saved', 'assertive');
        const refreshed = await actionGetNationalId(partyId);
        if (refreshed.ok) setRecord(refreshed.record);
      } else setError(r.error);
    });
  }

  function confirm() {
    setError(null);
    start(async () => {
      const r = await actionConfirmNationalId(partyId);
      if (r.ok) {
        announce('National ID confirmed', 'assertive');
        const refreshed = await actionGetNationalId(partyId);
        if (refreshed.ok) setRecord(refreshed.record);
      } else setError(r.error);
    });
  }

  return (
    <div>
      {error && <p className="pill p-bad" style={{ padding: '10px 13px', marginBottom: 14 }}>{error}</p>}

      {record?.verifiedAt && (
        <p className="pill p-ok" style={{ padding: '10px 13px', marginBottom: 14 }}>
          <Icon name="check" size={14} /> Confirmed {record.verifiedAt.slice(0, 10)}
        </p>
      )}

      <div className="grid2" style={{ gap: 14, marginBottom: 16 }}>
        {(['front', 'back'] as const).map((side) => {
          const docId = side === 'front' ? frontDocumentId : backDocumentId;
          return (
            <div key={side}>
              <label className="sub" style={{ display: 'block', marginBottom: 6 }}>
                {side === 'front' ? 'Front of ID' : 'Back of ID'}
              </label>
              {docId ? (
                <img
                  src={`/api/national-id-image/${docId}`}
                  alt={`${side} of national ID`}
                  style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }}
                />
              ) : (
                <div style={{
                  border: '1px dashed var(--line)', borderRadius: 8, padding: 20, textAlign: 'center', color: 'var(--tx-2)',
                }}>
                  No {side} image yet
                </div>
              )}
              <input
                type="file" accept="image/*" style={{ marginTop: 8, width: '100%' }}
                disabled={uploadingSide === side}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(side, f); }}
              />
            </div>
          );
        })}
      </div>

      <div className="grid2" style={{ gap: 14 }}>
        <div>
          <label className="sub" htmlFor="nid-idNumber" style={{ display: 'block', marginBottom: 6 }}>ID number *</label>
          <input id="nid-idNumber" className="inp" style={{ width: '100%' }}
            value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
        </div>
        <div>
          <label className="sub" htmlFor="nid-serial" style={{ display: 'block', marginBottom: 6 }}>Serial number</label>
          <input id="nid-serial" className="inp" style={{ width: '100%' }}
            value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
        </div>
        <div>
          <label className="sub" htmlFor="nid-sex" style={{ display: 'block', marginBottom: 6 }}>Sex</label>
          <select id="nid-sex" className="inp" style={{ width: '100%' }}
            value={sex} onChange={(e) => setSex(e.target.value)}>
            <option value="">Select…</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </div>
        <div>
          <label className="sub" htmlFor="nid-district" style={{ display: 'block', marginBottom: 6 }}>District of birth</label>
          <input id="nid-district" className="inp" style={{ width: '100%' }}
            value={districtOfBirth} onChange={(e) => setDistrictOfBirth(e.target.value)} />
        </div>
        <div>
          <label className="sub" htmlFor="nid-issue" style={{ display: 'block', marginBottom: 6 }}>Date of issue</label>
          <input id="nid-issue" type="date" className="inp" style={{ width: '100%' }}
            value={dateOfIssue} onChange={(e) => setDateOfIssue(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="btn btn-p" onClick={save} disabled={pending}>Save</button>
        {record && !record.verifiedAt && (
          <button className="btn btn-o" onClick={confirm} disabled={pending}>
            <Icon name="check" size={14} /> Confirm matches this person
          </button>
        )}
      </div>
    </div>
  );
}
