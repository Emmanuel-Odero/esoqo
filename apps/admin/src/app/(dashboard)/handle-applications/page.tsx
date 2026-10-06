import { listPendingHandleApplications } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { ApplicationList } from './ApplicationList';

export const dynamic = 'force-dynamic';

/**
 * A business, chama or other organisation applying to claim its own
 * esoqo ID handle (usually its trading name) instead of the random
 * mnemonic every org otherwise gets — see dal/handle-application.ts and
 * previewBusinessHandleCandidates in dal/payment-id.ts. Approving here
 * only unlocks the org's officer picking a handle; it does not mint one.
 */
export default async function HandleApplicationsPage() {
  const ctx = await requireStaff();
  const applications = await listPendingHandleApplications(ctx);
  const canApprove = ctx.capabilities.includes('*')
    || ctx.capabilities.includes('attestation.issue')
    || ctx.capabilities.includes('attestation.issue:HANDLE_APPLICATION_APPROVED');

  return (
    <>
      <div className="head">
        <div>
          <h1>Handle applications</h1>
          <p>
            Organisations that have uploaded legitimacy documents and are waiting to claim their
            own esoqo ID handle. Review the documents, then approve or reject.
          </p>
        </div>
      </div>

      {applications.length === 0
        ? <div className="card"><p className="sub">Nothing waiting on review.</p></div>
        : <ApplicationList applications={applications} canApprove={canApprove} />}
    </>
  );
}
