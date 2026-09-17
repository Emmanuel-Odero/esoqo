import { requireStaff } from '@/lib/session';
import { actionListParcelOpsQueue } from '../actions';
import { OperationsWorkspace } from './OperationsWorkspace';

export const dynamic = 'force-dynamic';

export default async function ParcelOperationsPage() {
  const ctx = await requireStaff();
  if (!ctx.capabilities.includes('*') && !ctx.capabilities.includes('parcels.assign')) {
    return <div className="card"><h1>Parcel operations</h1><p>You are not authorised to operate parcel intake or shipments.</p></div>;
  }
  const queue = await actionListParcelOpsQueue();
  return (
    <>
      <div className="head">
        <div>
          <h1>Parcel operations</h1>
          <p>Receive parcels, move them through shipments, and resolve the next action in the queue.</p>
        </div>
      </div>
      <OperationsWorkspace initialQueue={queue} />
    </>
  );
}
