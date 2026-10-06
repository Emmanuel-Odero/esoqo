'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { actionApproveHandleApplication } from './actions';

interface ApplicationDocument {
  id: string;
  title: string;
  kind: string;
  mimeType: string;
  uploadedAt: Date;
}

interface Application {
  orgPartyId: string;
  name: string;
  documents: ApplicationDocument[];
}

export function ApplicationList({
  applications, canApprove,
}: { applications: Application[]; canApprove: boolean }) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function approve(orgPartyId: string) {
    setError(null);
    setBusyId(orgPartyId);
    start(async () => {
      const res = await actionApproveHandleApplication(orgPartyId);
      if (!res.ok) setError(res.error);
      setBusyId(null);
    });
  }

  return (
    <div className="card">
      {error && <div className="note n-red" style={{ marginBottom: 14 }} role="alert"><div><p>{error}</p></div></div>}
      <table className="tbl">
        <thead>
          <tr><th>Organisation</th><th>Documents</th><th /></tr>
        </thead>
        <tbody>
          {applications.map((app) => (
            <tr key={app.orgPartyId}>
              <td>{app.name}</td>
              <td>
                {app.documents.map((doc) => (
                  <a key={doc.id} href={`/api/documents/${doc.id}`} download
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 12 }}>
                    <Icon name="document" size={14} />{doc.title}
                  </a>
                ))}
              </td>
              <td>
                {canApprove && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-p btn-sm" disabled={pending && busyId === app.orgPartyId}
                      onClick={() => approve(app.orgPartyId)}>
                      {pending && busyId === app.orgPartyId ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
