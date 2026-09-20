'use client';

import { useMemo, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { OrgShipment } from '@/lib/parcel-org-session';
import { loadOntoRun, openRun } from './actions';

/**
 * "Put it on a run" — the honest other half of dispatch.
 *
 * A parcel reports IN_TRANSIT by being loaded onto a vehicle that is
 * genuinely leaving, never by a button that only moves the status. The
 * difference is not pedantry: a bare status bump texts the receiver
 * "on its way" about a box still on the floor, puts nothing on the
 * dispatch board, and leaves the far end with no manifest to check the
 * box off against on arrival. So the only way to dispatch from this
 * screen is to name the lorry.
 *
 * When nothing is loading, this says so plainly and — for anyone who
 * can dispatch — opens a run right here. Sending a clerk with a queue
 * at the counter off to another page to create one is how boxes end up
 * dispatched "later", meaning never.
 */
export function RunPicker({
  runs, parcelCode, destinationHint, canCreate, label,
  beforeLoad, onLoaded, onError,
}: {
  runs: OrgShipment[];
  parcelCode: string;
  /** The parcel's destination, used only to sort the likely run to the
   *  top. Never to auto-select: a wrong lorry is a parcel in the wrong
   *  town, and free-text destinations do not match reliably enough to
   *  make that choice for somebody. */
  destinationHint: string;
  canCreate: boolean;
  label: string;
  /** Run before loading — the scanner passes custody-taking here, since
   *  a box cannot be on a lorry it was never taken in hand to carry. */
  beforeLoad?: (then: (code: string) => void) => void;
  onLoaded: (run: OrgShipment) => void;
  onError: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [plate, setPlate] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState(destinationHint);
  const [pending, start] = useTransition();

  // Likely match first. A pure sort, never a preselection.
  const sorted = useMemo(() => {
    const needle = destinationHint.toLowerCase();
    const score = (r: OrgShipment) => {
      const dest = r.destinationLabel.toLowerCase();
      if (!needle || !dest) return 0;
      return dest.split(/[\s,]+/).some((w) => w.length > 2 && needle.includes(w)) ? 1 : 0;
    };
    return [...runs].sort((a, b) => score(b) - score(a));
  }, [runs, destinationHint]);

  function load(run: OrgShipment) {
    const go = (code: string) => {
      start(async () => {
        const res = await loadOntoRun(run.id, code);
        if (!res.ok) { onError(res.error); return; }
        onLoaded(run);
      });
    };
    if (beforeLoad) beforeLoad(go);
    else go(parcelCode);
  }

  if (runs.length === 0 && !creating) {
    return (
      <div className="runs-empty">
        <p>
          <Icon name="truck" size={16} /> No run is loading right now, so this can only be
          received and left on the shelf.
        </p>
        {canCreate && (
          <button type="button" className="btn btn-o" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />A vehicle is here — open a run
          </button>
        )}
      </div>
    );
  }

  if (creating) {
    const valid = origin.trim() !== '' && destination.trim() !== '';
    return (
      <form
        className="runs-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          start(async () => {
            const res = await openRun({
              originLabel: origin, destinationLabel: destination, vehiclePlate: plate,
            });
            if (!res.ok) { onError(res.error); return; }
            setCreating(false);
            load(res.shipment);
          });
        }}
      >
        <p className="kicker">Open a run</p>
        <div className="runs-new-grid">
          <label className="fld">
            <span className="lab">Leaving from</span>
            <input className="inp" value={origin} onChange={(e) => setOrigin(e.target.value)}
              placeholder="Nairobi CBD counter" />
          </label>
          <label className="fld">
            <span className="lab">Going to</span>
            <input className="inp" value={destination} onChange={(e) => setDestination(e.target.value)}
              placeholder="Kisumu" />
          </label>
          <label className="fld">
            <span className="lab">Number plate <span className="op">optional</span></span>
            <input className="inp mono" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="KDN 700M" />
          </label>
        </div>
        <div className="scan-actions">
          <button type="submit" className="btn btn-p" disabled={!valid || pending}>
            {pending ? 'Opening…' : 'Open it and load this box'}
          </button>
          <button type="button" className="btn btn-o" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="runs">
      <p className="runs-label">{label}</p>
      <ul className="runs-list">
        {sorted.map((run) => (
          <li key={run.id}>
            <button
              type="button" className="run" disabled={pending}
              onClick={() => load(run)}
            >
              <span className="run-plate mono">{run.vehiclePlate || 'No plate'}</span>
              <span className="run-leg">
                <strong>{run.destinationLabel}</strong>
                <small>
                  from {run.originLabel} · {run.loaded} loaded
                  {run.routeLabel ? ` · ${run.routeLabel}` : ''}
                </small>
              </span>
              <Icon name="arrow-right" size={17} className="run-go" />
            </button>
          </li>
        ))}
      </ul>
      {canCreate && (
        <button type="button" className="linkbtn" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} />Another vehicle is here
        </button>
      )}
    </div>
  );
}
