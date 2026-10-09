'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { OrgRoute, ParcelOrgStationRow } from '@/lib/parcel-org-session';
import { deleteOrgRoute, saveOrgRoute, type OrgRouteStopInput } from '../../actions';

/** A stop being edited: either an existing station id, or a free-text
 *  place with none yet (a bus passing through a town with no shop). */
type StopDraft = { stationId: string } | { placeName: string };

function stopKey(s: StopDraft, i: number): string {
  return ('stationId' in s ? `s:${s.stationId}` : `p:${s.placeName}`) + `-${i}`;
}

/**
 * Building a route is picking stations in travel order, so the editor is
 * an ordered list you add to and reorder — not a form with an origin
 * field and a destination field. Two stops is a leg; five stops is four
 * legs; the shape of the control should say that before any copy does.
 *
 * Order is positional and saved as an array, which is why reordering is
 * just another save: there is no move-stop endpoint to get out of step
 * with the list.
 */
export function RoutesManager({
  routes, stations,
}: { routes: OrgRoute[]; stations: ParcelOrgStationRow[] }) {
  const [editing, setEditing] = useState<OrgRoute | 'new' | null>(null);

  const active = stations.filter((s) => s.active);

  return (
    <div className="porgroutes">
      {editing === null && (
        <>
          <div className="porgroutes-bar">
            <button
              type="button"
              className="btn btn-p btn-sm"
              onClick={() => setEditing('new')}
            >
              <Icon name="plus" size={15} />New route
            </button>
          </div>

          {routes.length === 0 ? (
            <p className="porgroutes-empty">
              No routes yet. Runs can still be opened ad-hoc; a route just saves
              typing the same leg every morning and lets you price by it.
            </p>
          ) : (
            <ul className="porgroutes-list">
              {routes.map((r) => (
                <li key={r.id}>
                  <div className="porgroutes-id">
                    <span className="porgroutes-name">
                      {r.name}
                      {r.code && <span className="mono porgroutes-code">{r.code}</span>}
                      {!r.active && <span className="pill p-warn">Paused</span>}
                    </span>
                    <span className="sub">
                      {r.stops.map((s) => s.stationName ?? s.placeName).join(' → ') || 'No stops'}
                    </span>
                    <span className="sub">
                      {Math.max(0, r.stops.length - 1)}{' '}
                      {r.stops.length === 2 ? 'leg' : 'legs'}
                      {r.distanceKm != null && ` · ${r.distanceKm} km`}
                      {r.openRuns > 0 && ` · ${r.openRuns} out now`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-o btn-sm"
                    onClick={() => setEditing(r)}
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {editing !== null && (
        <RouteEditor
          route={editing === 'new' ? null : editing}
          stations={active}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RouteEditor({
  route, stations, onDone,
}: {
  route: OrgRoute | null;
  stations: ParcelOrgStationRow[];
  onDone: () => void;
}) {
  const [name, setName] = useState(route?.name ?? '');
  const [code, setCode] = useState(route?.code ?? '');
  const [distanceKm, setDistanceKm] = useState(route?.distanceKm != null ? String(route.distanceKm) : '');
  const [active, setActive] = useState(route?.active ?? true);
  const [stops, setStops] = useState<StopDraft[]>(
    route?.stops.map((s) => (s.stationId ? { stationId: s.stationId } : { placeName: s.placeName ?? '' })) ?? [],
  );
  const [customPlace, setCustomPlace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const nameOf = (s: StopDraft) => ('stationId' in s ? stations.find((st) => st.id === s.stationId)?.name ?? 'Unknown station' : s.placeName);
  const lastStop = stops[stops.length - 1];
  // A station may legitimately appear twice on a long route (out and
  // back), so the picker never removes one — it only stops you adding
  // the same stop twice in a row, which is not a leg.
  const addable = stations.filter((s) => !(lastStop && 'stationId' in lastStop && lastStop.stationId === s.id));

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setStops(next);
  }

  function addCustomPlace() {
    const place = customPlace.trim();
    if (!place) return;
    setStops([...stops, { placeName: place }]);
    setCustomPlace('');
  }

  function save() {
    setError(null);
    start(async () => {
      const stopsInput: OrgRouteStopInput[] = stops.map((s) => (
        'stationId' in s ? { stationId: s.stationId } : { placeName: s.placeName }
      ));
      const res = await saveOrgRoute({
        id: route?.id, name, code: code || null, stops: stopsInput,
        distanceKm: distanceKm.trim() ? Number(distanceKm) : null, active,
      });
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteOrgRoute(route!.id);
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <div className="porgroutes-editor">
      <h2>{route ? 'Edit route' : 'New route'}</h2>

      <div className="porgroutes-fields">
        <label>
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nairobi — Kisumu"
          />
        </label>
        <label>
          <span>Short code</span>
          <input
            className="mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="NBO-KSM"
            maxLength={16}
          />
          <em className="sub">Printed on manifests. Optional.</em>
        </label>
        <label>
          <span>Distance (km)</span>
          <input type="number" min={0} value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} placeholder="Optional" />
        </label>
        <label className="porgroutes-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Running — uncheck to pause it without deleting</span>
        </label>
      </div>

      <h3>Stops, in travel order</h3>
      {stops.length === 0 ? (
        <p className="sub">Add the first stop below.</p>
      ) : (
        <ol className="porgroutes-stops">
          {stops.map((s, i) => (
            <li key={stopKey(s, i)}>
              <span className="porgroutes-seq mono">{i + 1}</span>
              <span className="porgroutes-stop">
                {nameOf(s)}
                {!('stationId' in s) && <span className="pill p-mute">No station yet</span>}
              </span>
              <span className="porgroutes-moves">
                <button type="button" className="btn btn-o btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${nameOf(s)} earlier`}>↑</button>
                <button type="button" className="btn btn-o btn-sm" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${nameOf(s)} later`}>↓</button>
                <button type="button" className="btn btn-o btn-sm" onClick={() => setStops(stops.filter((_, k) => k !== i))} aria-label={`Remove ${nameOf(s)}`}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <label className="porgroutes-add">
        <span>Add a stop</span>
        <select
          value=""
          onChange={(e) => { if (e.target.value) setStops([...stops, { stationId: e.target.value }]); }}
        >
          <option value="">Choose a station…</option>
          {addable.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      <label className="porgroutes-add">
        <span>Or add a place with no station yet</span>
        <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <input
            value={customPlace}
            onChange={(e) => setCustomPlace(e.target.value)}
            placeholder="Kisii"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomPlace(); } }}
          />
          <button type="button" className="btn btn-o btn-sm" onClick={addCustomPlace} disabled={!customPlace.trim()}>
            Add
          </button>
        </span>
        <em className="sub">
          A town the route passes through with no shop of yours yet — a bus can still
          stop there.
        </em>
      </label>

      {error && (
        <p className="porg-export-note" role="status">
          <Icon name="alert-triangle" size={15} />{error}
        </p>
      )}

      <div className="porgroutes-actions">
        <button type="button" className="btn btn-p btn-sm" onClick={save} disabled={pending || stops.length < 2 || !name.trim()}>
          {pending ? 'Saving…' : 'Save route'}
        </button>
        <button type="button" className="btn btn-o btn-sm" onClick={onDone} disabled={pending}>
          Cancel
        </button>
        {route && (
          <button type="button" className="btn btn-o btn-sm porgroutes-del" onClick={remove} disabled={pending}>
            Delete
          </button>
        )}
      </div>
      {stops.length < 2 && (
        <p className="sub">A route needs at least two stops — one place isn&rsquo;t a journey.</p>
      )}
    </div>
  );
}
