'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { OrgRoute, ParcelOrgStationRow } from '@/lib/parcel-org-session';
import { deleteOrgRoute, saveOrgRoute } from '../../actions';

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
              disabled={active.length < 2}
            >
              <Icon name="plus" size={15} />New route
            </button>
            {active.length < 2 && (
              <span className="sub">
                Add at least two stations first — a route is a journey between them.
              </span>
            )}
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
                      {r.stops.map((s) => s.stationName).join(' → ') || 'No stops'}
                    </span>
                    <span className="sub">
                      {Math.max(0, r.stops.length - 1)}{' '}
                      {r.stops.length === 2 ? 'leg' : 'legs'}
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
  const [active, setActive] = useState(route?.active ?? true);
  const [stops, setStops] = useState<string[]>(
    route?.stops.map((s) => s.stationId) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const nameOf = (id: string) => stations.find((s) => s.id === id)?.name ?? 'Unknown station';
  // A station may legitimately appear twice on a long route (out and
  // back), so the picker never removes one — it only stops you adding
  // the same stop twice in a row, which is not a leg.
  const addable = stations.filter((s) => s.id !== stops[stops.length - 1]);

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setStops(next);
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveOrgRoute({
        id: route?.id, name, code: code || null, stationIds: stops, active,
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
          {stops.map((id, i) => (
            <li key={`${id}-${i}`}>
              <span className="porgroutes-seq mono">{i + 1}</span>
              <span className="porgroutes-stop">{nameOf(id)}</span>
              <span className="porgroutes-moves">
                <button type="button" className="btn btn-o btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${nameOf(id)} earlier`}>↑</button>
                <button type="button" className="btn btn-o btn-sm" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${nameOf(id)} later`}>↓</button>
                <button type="button" className="btn btn-o btn-sm" onClick={() => setStops(stops.filter((_, k) => k !== i))} aria-label={`Remove ${nameOf(id)}`}>
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
          onChange={(e) => { if (e.target.value) setStops([...stops, e.target.value]); }}
        >
          <option value="">Choose a station…</option>
          {addable.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
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
