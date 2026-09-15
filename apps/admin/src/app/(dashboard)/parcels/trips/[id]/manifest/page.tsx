import { requireStaff } from '@/lib/session';
import { actionGetTripManifest } from '../../../actions';
import { ManifestSheet } from './ManifestSheet';

export const dynamic = 'force-dynamic';

/** The dispatcher's printed run sheet for one trip. The crew read the
 *  same manifest on a phone; this is the copy that gets signed and
 *  stays in the depot. */
export default async function TripManifestPage(
  { params }: { params: Promise<{ id: string }> },
) {
  await requireStaff();
  const { id } = await params;
  const parcels = await actionGetTripManifest(id);

  return (
    <>
      <div className="head">
        <div>
          <h1>Run sheet</h1>
          <p>
            What is in the vehicle, in the order it comes off. Print it, have the driver sign
            it, keep it — a signature settles a dispute long after the phone that recorded
            everything has been replaced.
          </p>
        </div>
      </div>
      <ManifestSheet tripId={id} parcels={parcels} />
    </>
  );
}
