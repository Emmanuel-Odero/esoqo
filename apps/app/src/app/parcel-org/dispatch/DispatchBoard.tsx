'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode, TransitionStartFunction } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import type { DispatchPing, DispatchRun, OrgRoute, ParcelOrgStaffRow, ParcelOrgStationRow } from '@/lib/parcel-org-session';
import {
  arriveDispatch, cancelDispatch, createDispatch, departDispatch, getDispatch, listDispatches,
  reportDispatchPosition, type DispatchCrewInput,
} from '../actions';
import { setFormActive } from '../form-activity';
import { DemoCallButton, DemoMessageButton } from '@/components/DemoContact';
import { FleetDispatchMap } from './FleetDispatchMap';
import {
  currentSpeedKmh, distanceCoveredKm, journeyProgress, lastSeenLabel,
  lastSeenTone, recordedStops, remainingStraightKm,
} from './dispatch-stats';

const VEHICLE_TYPES = ['VAN', 'TRUCK', 'BUS', 'PICKUP', 'MOTORBIKE', 'OTHER'] as const;

const CREW_ROLES: [value: string, label: string][] = [
  ['DRIVER', 'Driver'],
  ['TOUT', 'Tout / conductor'],
  ['LOADER', 'Loader'],
  ['OTHER', 'Other…'],
];





interface CrewRow {
  key: number;
  name: string;
  msisdn: string;
  role: string;
  customRole: string;
  staffId: string;
}

let crewKey = 1;
function blankCrewRow(): CrewRow {
  return { key: crewKey++, name: '', msisdn: '', role: 'DRIVER', customRole: '', staffId: '' };
}

/** Match a team member by name, role, phone or station — the same
 *  multi-word behaviour as the board search. */
function matchStaff(
  s: ParcelOrgStaffRow,
  needle: string,
  stationNameOf: (id: string | null) => string,
): boolean {
  if (!needle) return true;
  const hay = [s.name, s.msisdn ?? '', s.role, stationNameOf(s.stationId)].join(' ').toLowerCase();
  return needle.split(/\s+/).every((w) => w && hay.includes(w));
}

// A run now has a loading phase, because it now has cargo. ACTIVE used
// to be the only live status a dispatch could hold — it was created at
// the moment a vehicle set off, having nothing to wait for (ADR-0006).
function statusPill(status: string): string {
  switch (status) {
    case 'LOADING': return 'p-warn';
    case 'DEPARTED': return 'p-ok';
    case 'ARRIVED': return 'p-info';
    default: return 'p-bad';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'LOADING': return 'Loading';
    case 'DEPARTED': return 'On the road';
    case 'ARRIVED': return 'Arrived';
    case 'CANCELLED': return 'Cancelled';
    default: return status;
  }
}

/** Still the dispatcher's problem today: at the shed taking boxes, or
 *  out on the road. Two states where there used to be one. */
function isOpenRun(status: string): boolean {
  return status === 'LOADING' || status === 'DEPARTED';
}

/** Runs that need a dispatcher first: still loading at the shed (load
 *  it, set it off), then on-the-road runs stalest first — a position
 *  hours old is the exception to look at. Closed runs keep
 *  newest-first. The board manages exceptions, not just markers. */
function attentionOrder(a: DispatchRun, b: DispatchRun): number {
  const rank = (r: DispatchRun) => (r.status === 'LOADING' ? 0 : r.status === 'DEPARTED' ? 1 : 2);
  const d = rank(a) - rank(b);
  if (d !== 0) return d;
  if (rank(a) === 1) {
    const at = (r: DispatchRun) => (r.currentAt ? new Date(r.currentAt).getTime() : 0);
    return at(a) - at(b);
  }
  return b.createdAt.localeCompare(a.createdAt);
}

/** One query against everything a dispatcher would name a run by:
 *  plate, stations, crew, receiving team, route, notes. */
function matchRun(r: DispatchRun, needle: string): boolean {
  if (!needle) return true;
  const crew = Array.isArray(r.crew) ? r.crew : [];
  const receivers = Array.isArray(r.receivers) ? r.receivers : [];
  const hay = [
    r.vehiclePlate ?? '',
    r.vehicleType ?? '',
    r.origin?.name ?? '',
    r.destination?.name ?? '',
    r.routeName ?? '',
    r.notes ?? '',
    statusLabel(r.status),
    ...crew.flatMap((c) => [c.name ?? '', c.msisdn ?? '']),
    ...receivers.map((x) => x.name ?? ''),
  ].join(' ').toLowerCase();
  return needle.split(/\s+/).every((w) => w && hay.includes(w));
}

function seenPillTone(tone: 'g' | 'a' | 'r' | undefined): string {
  switch (tone) {
    case 'g': return 'p-ok';
    case 'a': return 'p-warn';
    case 'r': return 'p-bad';
    default: return '';
  }
}

/**
 * A clock that only ticks on the client. The server render and the
 * first client render both see null and print a stable placeholder,
 * so time-relative labels ("8 min ago") can never differ between the
 * two — the hydration mismatch this board used to throw. After mount
 * the labels go live and refresh every 30s.
 */
function useNow(intervalMs = 30000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "8 min ago" pill with a hydration-safe placeholder first render. */
function LastSeenPill({ at, now }: { at: string | null; now: number | null }) {
  if (now === null) return <span className="pill">…</span>;
  return (
    <span className={`pill ${seenPillTone(lastSeenTone(at, now))}`}>
      {lastSeenLabel(at, now)}
    </span>
  );
}

/**
 * The dispatch board: open a run (vehicle + crew + leg + receiving
 * team), watch the whole fleet on one map, and check runs in on
 * arrival. Fleet-level, deliberately — a run is the unit a dispatcher
 * thinks in, so this page still never lists individual parcels.
 *
 * It does now say how many are aboard, and prints the manifest for
 * them. Before ADR-0006 it could do neither: the parcels lived on a
 * separate shipment record with no foreign key to this one, so the
 * board showed a lorry it could not tell you the contents of.
 */
export function DispatchBoard({
  initialRuns, stations, staff, routes, orgName,
}: {
  initialRuns: DispatchRun[];
  stations: ParcelOrgStationRow[];
  staff: ParcelOrgStaffRow[];
  routes: OrgRoute[];
  orgName: string;
}) {
  const [runs, setRuns] = useState(initialRuns);
  // The page's DropoffPoll calls router.refresh() every 30s, which
  // re-runs the server component and hands us a fresh initialRuns. The
  // board must adopt it or the poll would re-fetch endlessly and never
  // move the board — this is the whole "live fleet" mechanism.
  useEffect(() => {
    setRuns(initialRuns);
  }, [initialRuns]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialRuns.find((r) => isOpenRun(r.status))?.id ?? null,
  );
  // What the map marker + inspector highlight (selectedId) is separate
  // from which run card is actually expanded. Picking a marker on the
  // map opens the inspector under the map instead of yanking the page
  // down to the card, and the card only opens when the dispatcher asks
  // for full detail — so a click never feels like it "slides away".
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Live search across the whole board: plate, leg, crew, receivers,
  // route, notes. One query drives the map, the inspector and the run
  // cards together, so "find KDK 214T" never shows it on the map but
  // hides it in the list.
  const [query, setQuery] = useState('');
  const [searchFocus, setSearchFocus] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'open' | 'LOADING' | 'DEPARTED'>('open');
  // Locate-on-map requests: which run to fly to, plus a nonce so
  // tapping Locate twice still re-flies the map.
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  const [trails, setTrails] = useState<Record<string, DispatchPing[]>>({});
  const [showClosed, setShowClosed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const withTrail = (r: DispatchRun): DispatchRun => {
    const t = trails[r.id];
    return t ? { ...r, trail: t } : r;
  };
  const selectedWithTrail = selected ? withTrail(selected) : null;
  const runsWithTrails = runs.map(withTrail);
  // Closed runs, then the status chips, then the live query — in that
  // order, so each control narrows what the previous one left. The map,
  // the inspector and the cards all read `visible`, so the three can
  // never disagree about what matched.
  //
  // One exception: a live query searches the WHOLE board — open,
  // arrived and cancelled alike. Scoping search to open runs hid
  // arrived runs from their own plate number, which read as "search is
  // broken". Browsing (no query) keeps the closed toggle and chips.
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const matched = runsWithTrails.filter((r) => matchRun(r, needle));
    const scoped = needle
      ? matched
      : matched.filter((r) =>
          (showClosed || isOpenRun(r.status)) &&
          (statusFilter === 'open' || r.status === statusFilter),
        );
    return [...scoped].sort(attentionOrder);
  }, [runsWithTrails, showClosed, statusFilter, needle]);
  const searching = needle !== '' || statusFilter !== 'open';
  // The day's plates, for the Open-a-run plate suggestions — the same
  // vans run daily, so retyping them is pure toil.
  const knownPlates = useMemo(
    () => [...new Set(runs.map((r) => (r.vehiclePlate ?? '').trim()).filter(Boolean))].sort(),
    [runs],
  );
  // While searching, the board follows the query: if the highlighted
  // run is filtered out, jump to the first match so the map and the
  // inspector move with the keystrokes.
  useEffect(() => {
    if (!needle || visible.length === 0) return;
    if (!visible.some((r) => r.id === selectedId)) {
      setSelectedId(visible[0]!.id);
    }
  }, [needle, visible, selectedId]);
  // Suggestions under the search box — the jump list. Capped so it
  // stays a jump list, not a second board.
  const suggestions = needle ? visible.slice(0, 8) : [];

  function pickSuggestion(id: string) {
    setSelectedId(id);
    setSearchFocus(false);
    setActiveSuggestion(0);
    document.getElementById('run-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Card → map direction of the sync: highlight the run, fly the map
   *  to it, and bring the map into view. */
  function locate(id: string) {
    setSelectedId(id);
    setFocusReq((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    document.getElementById('fleet-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const activeStaff = staff.filter((s) => s.active);
  // Single client clock for the board's time-relative labels (see
  // useNow) — RunDetail keeps its own, since it mounts on demand.
  const now = useNow();

  async function refresh() {
    // A failed refetch (network blip, or the shift session expired) is
    // not worth throwing the dispatcher out of the board over — the
    // mutation that triggered it already succeeded server-side, and the
    // board stays on what it has. The next action will surface the
    // session problem when it matters.
    try { setRuns(await listDispatches(true)); } catch { /* keep the current board */ }
  }

  // The board list carries no trail (payload weight); the selected
  // run's journey loads on demand for the map line and the detail.
  useEffect(() => {
    if (!selectedId || trails[selectedId]) return;
    let live = true;
    void getDispatch(selectedId).then((detail) => {
      if (live && detail) setTrails((t) => ({ ...t, [selectedId]: detail.trail ?? [] }));
    });
    return () => { live = false; };
  }, [selectedId, trails]);

  // While the create form is open the dashboard poller stands down, so
  // the page never refreshes mid-entry (see DropoffPoll).
  useEffect(() => {
    if (!formOpen) return;
    setFormActive(true);
    return () => setFormActive(false);
  }, [formOpen ]);

  return (
    <>
      <div className="ptoolbar porg-dispatch-toolbar">
        <button className="btn btn-p" onClick={() => setFormOpen(true)}>
          <Icon name="plus" size={16} />
          Open a run
        </button>
        {/* Live search: one query over plate, leg, crew, receivers,
            route and notes — across open, arrived and cancelled runs.
            The dropdown jumps straight to a run; the board below
            filters to every match as you type. */}
        <div className="porg-search-wrap">
          <div className="porg-search" role="search">
            <Icon name="search" size={16} aria-hidden="true" />
            <label className="sr-only" htmlFor="dispatch-search">Search runs</label>
            <input
              id="dispatch-search"
              className="porg-search-input"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveSuggestion(0); }}
              onFocus={() => setSearchFocus(true)}
              onBlur={() => setSearchFocus(false)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && suggestions.length > 0) {
                  e.preventDefault();
                  setActiveSuggestion((i) => (i + 1) % suggestions.length);
                } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
                  e.preventDefault();
                  setActiveSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
                } else if (e.key === 'Enter' && suggestions.length > 0) {
                  e.preventDefault();
                  pickSuggestion(suggestions[activeSuggestion]?.id ?? suggestions[0]!.id);
                } else if (e.key === 'Escape') {
                  setSearchFocus(false);
                }
              }}
              placeholder="Search plate, place, crew…"
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={searchFocus && suggestions.length > 0}
              aria-controls="dispatch-suggestions"
              aria-activedescendant={suggestions.length > 0 ? `dispatch-sug-${suggestions[activeSuggestion]?.id}` : undefined}
            />
            {query && (
              <button
                type="button"
                className="porg-search-clear"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          {searchFocus && needle && (
            <ul id="dispatch-suggestions" className="porg-search-pop" role="listbox" aria-label="Matching runs">
              {suggestions.length === 0 ? (
                <li className="porg-search-none" role="option" aria-selected="false">
                  No runs match — arrived and cancelled were searched too.
                </li>
              ) : (
                suggestions.map((r, i) => (
                  <li
                    key={r.id}
                    id={`dispatch-sug-${r.id}`}
                    role="option"
                    aria-selected={i === activeSuggestion}
                    className={i === activeSuggestion ? 'is-active' : undefined}
                  >
                    {/* mousedown first: the input blurs (closing the
                        popover) before click fires, so the choice must
                        land on mousedown. */}
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickSuggestion(r.id)}
                      onMouseEnter={() => setActiveSuggestion(i)}
                    >
                      <span className="mono">{r.vehiclePlate}</span>
                      <span className="porg-search-leg">{r.origin?.name ?? '—'} → {r.destination?.name ?? '—'}</span>
                      <span className={`pill ${statusPill(r.status)}`}>{statusLabel(r.status)}</span>
                    </button>
                  </li>
                ))
              )}
              {visible.length > suggestions.length && (
                <li className="porg-search-more" aria-hidden="true">
                  +{visible.length - suggestions.length} more below — keep typing to narrow.
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="porg-status-chips" role="group" aria-label="Filter by run state">
          {(['open', 'LOADING', 'DEPARTED'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`porg-chip${statusFilter === s ? ' is-on' : ''}`}
              aria-pressed={statusFilter === s}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'open' ? 'All open' : statusLabel(s)}
            </button>
          ))}
        </div>
        <label className="pfield-check ptoolbar-spacer porg-run-toggle">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          <span>Show arrived &amp; cancelled</span>
        </label>
      </div>
      {searching && (
        <p className="sub porg-search-count" role="status">
          {visible.length === 0
            ? (needle
              ? `No runs match “${query.trim()}” — open, arrived and cancelled were all searched.`
              : 'No open runs in that state.')
            : `${visible.length} of ${runsWithTrails.length} run${runsWithTrails.length === 1 ? '' : 's'} shown${needle ? ' — open, arrived and cancelled all searched' : ''}.`}
          {' '}
          <button type="button" className="linkbtn" onClick={() => { setQuery(''); setStatusFilter('open'); }}>
            Clear
          </button>
        </p>
      )}

      {formOpen && (
        <RunModal onClose={() => setFormOpen(false)} label="Open a run">
          <CreateDispatchForm
            stations={stations}
            staff={activeStaff}
            routes={routes}
            knownPlates={knownPlates}
            pending={pending}
            startTransition={startTransition}
            onDone={(id) => { setFormOpen(false); void refresh().then(() => setSelectedId(id)); }}
          />
        </RunModal>
      )}

      {visible.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="ico"><Icon name={searching ? 'search' : 'send'} size={22} /></span>
            <h3>{searching ? 'No runs match that search.' : 'No runs on the board.'}</h3>
            <p className="sub">
              {searching
                ? 'Try a plate, a place, or a crew name — or clear the search to see the whole fleet.'
                : 'Open a dispatch to put the first fleet on the map.'}
            </p>
            {searching ? (
              <button type="button" className="btn btn-o btn-sm" onClick={() => { setQuery(''); setStatusFilter('open'); }}>
                Clear search
              </button>
            ) : (
              <button type="button" className="btn btn-p btn-sm" onClick={() => setFormOpen(true)}>
                <Icon name="plus" size={14} />Open a run
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <FleetDispatchMap
            runs={visible}
            selectedId={selectedId}
            focus={focusReq}
            onSelect={(id) => {
              setSelectedId(id);
              // The inspector sits just under the map, so this barely
              // moves — it never scrolls the page to the run card.
              document.getElementById('run-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
          />

          <RunInspector
            run={selectedWithTrail}
            now={now}
            onLocate={locate}
            onFullDetails={(id) => {
              setExpandedId((prev) => (prev === id ? null : id));
              document.getElementById(`run-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
          />

          <div className="porg-runs-grid">
            {visible.map((r) => {
              const expanded = r.id === expandedId;
              const crewList = Array.isArray(r.crew) ? r.crew : [];
              const receiverList = Array.isArray(r.receivers) ? r.receivers : [];
              return (
              <article
                key={r.id}
                id={`run-${r.id}`}
                className={`porg-run${r.id === selectedId ? ' is-selected' : ''}`}
                data-status={r.status}
              >
                <div className="porg-run-top">
                  <div className="porg-run-main">
                    <div className="porg-run-plate">
                      <span className="mono">{r.vehiclePlate}</span>
                      <span className={`pill ${statusPill(r.status)}`}>{statusLabel(r.status)}</span>
                      {r.status === 'DEPARTED' && (
                        <LastSeenPill at={r.currentAt} now={now} />
                      )}
                    </div>
                    <p className="porg-run-leg">
                      <span>{r.origin?.name ?? '—'}</span>
                      <Icon name="arrow-right" size={14} aria-hidden="true" />
                      <span>{r.destination?.name ?? '—'}</span>
                    </p>
                    <p className="porg-run-meta">
                      {(r.vehicleType ?? '').toLowerCase()}
                      {r.routeName && <> · {r.routeName}</>}
                      {' · '}{crewList.length} crew
                      {receiverList.length > 0 && <> · receiving: {receiverList.map((x) => x.name).join(', ')}</>}
                    </p>
                  </div>
                  {/* What is actually on the vehicle, and the paper for
                      it. The board could not answer either question
                      before the merge — the parcels lived on a record
                      this one had no key to (ADR-0006). */}
                  <div className="porg-run-side">
                    <span className="porg-run-load">
                      <b className="mono">{r.loaded}</b>
                      {r.loaded === 1 ? 'parcel' : 'parcels'}
                    </span>
                    <div className="porg-run-btns">
                      <button
                        className="btn btn-o btn-sm"
                        onClick={() => locate(r.id)}
                        title="Highlight this run and fly the map to it"
                      >
                        <Icon name="pin" size={14} />Locate
                      </button>
                      <Link
                        className="btn btn-o btn-sm"
                        href={`/parcel-org/dispatch/runs/${r.id}/manifest` as Route}
                      >
                        <Icon name="print" size={14} />Manifest
                      </Link>
                      <button
                        className="btn btn-o btn-sm"
                        onClick={() => {
                          const next = expanded ? null : r.id;
                          setExpandedId(next);
                          if (next) document.getElementById(`run-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }}
                      >
                        {expanded ? 'Hide' : 'Details'}
                        <Icon name="chevron-right" size={14} />
                      </button>
                    </div>
                  </div>
                </div>
                {expanded && (
                  <RunDetail
                    run={r}
                    orgName={orgName}
                    pending={pending}
                    startTransition={startTransition}
                    onChanged={refresh}
                  />
                )}
              </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/**
 * The strip that sits under the fleet map. Clicking a marker puts that
 * run here — plate, driver, how far along the leg, how it's moving —
 * without dragging the page down to the card. "Full details" is the
 * deliberate step for the whole card, with its crew/receiving/custody
 * controls (see DispatchBoard's expandedId).
 */
function RunInspector({
  run, now, onLocate, onFullDetails,
}: {
  run: DispatchRun | null;
  now: number | null;
  onLocate: (id: string) => void;
  onFullDetails: (id: string) => void;
}) {
  if (!run) {
    return (
      <div id="run-inspector" className="card" style={{ padding: 14, marginTop: 10 }}>
        <p className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
          <Icon name="map" size={16} />
          Pick a marker on the map to inspect that run.
        </p>
      </div>
    );
  }

  const crewList = Array.isArray(run.crew) ? run.crew : [];
  const driver = crewList.find((c) => c.role === 'DRIVER') ?? crewList[0] ?? null;
  const progress = journeyProgress(run);
  const toGo = remainingStraightKm(run);
  // DEPARTED, not merely open: a run still at the shed has no position
  // to report and no arrival to confirm, and the server refuses both
  // for a LOADING run (see dbx.ReportRunPosition).
  const isActive = run.status === 'DEPARTED';

  return (
    <div id="run-inspector" className="card" style={{ padding: 14, marginTop: 10 }}>
      <div className="row" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontWeight: 800, fontSize: '1.05rem' }}>{run.vehiclePlate}</span>
            <span className="sub">{(run.vehicleType ?? '').toLowerCase()}</span>
            <span className={`pill ${statusPill(run.status)}`}>{statusLabel(run.status)}</span>
            {isActive && (
              <LastSeenPill at={run.currentAt} now={now} />
            )}
          </span>
          <div className="sub" style={{ marginTop: 4 }}>
            {run.origin?.name ?? '—'} → {run.destination?.name ?? '—'}
            {driver && <> · {driver.name}{driver.msisdn ? ` (${driver.msisdn})` : ''}</>}
            {toGo !== null && (
              <span title="Straight-line distance — the road is longer"> · ~{toGo < 10 ? toGo.toFixed(1) : Math.round(toGo)} km to go</span>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {driver?.msisdn && (
            <>
              <DemoCallButton msisdn={driver.msisdn} primary />
              <DemoMessageButton msisdn={driver.msisdn} />
            </>
          )}
          <button className="btn btn-o btn-sm" onClick={() => onLocate(run.id)} title="Fly the map to this run">
            <Icon name="pin" size={14} />Locate
          </button>
          <button className="btn btn-p btn-sm" onClick={() => onFullDetails(run.id)}>
            Full details<Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>

      {progress !== null && (
        <div aria-label={`${Math.round(progress * 100)}% of journey complete`} style={{ height: 6, borderRadius: 4, background: 'var(--line)', overflow: 'hidden', marginTop: 14 }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--blue, #1565C0)' }} />
        </div>
      )}
    </div>
  );
}

/**
 * The "Open a run" sheet: a real modal, not an inline panel that shoves
 * the board down the page. Overlay click and Escape both close it; the
 * page behind stops scrolling while it is open; on a phone it docks to
 * the bottom as a sheet with a full-width action. Focus lands on the
 * close control on open so keyboard and screen-reader users start
 * inside the dialog, not behind it.
 */
function RunModal({
  onClose, label, children,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    // The scrim click is a convenience duplicate: the dialog's close
    // button and Escape are the keyboard/screen-reader paths.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="porg-modal-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="porg-modal" role="dialog" aria-modal="true" aria-label={label}>
        <div className="porg-modal-bar">
          <strong>{label}</strong>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-o btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="porg-modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}

function CreateDispatchForm({
  stations, staff, routes, knownPlates, pending, startTransition, onDone,
}: {
  stations: ParcelOrgStationRow[];
  staff: ParcelOrgStaffRow[];
  routes: OrgRoute[];
  /** Plates already on the board — the same vans run daily. */
  knownPlates: string[];
  pending: boolean;
  startTransition: TransitionStartFunction;
  onDone: (id: string) => void;
}) {
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<string>('VAN');
  const [routeId, setRouteId] = useState('');
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [notes, setNotes] = useState('');
  const [crew, setCrew] = useState<CrewRow[]>([blankCrewRow()]);
  const [crewSearch, setCrewSearch] = useState('');
  const [receiverIds, setReceiverIds] = useState<string[]>([]);
  const [receiverSearch, setReceiverSearch] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [extraReceivers, setExtraReceivers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ready = plate.trim() && destinationId && crew.some((c) => c.name.trim());
  const stationNameOf = (id: string | null) =>
    (id && stations.find((s) => s.id === id)?.name) || '';

  function patchCrew(key: number, patch: Partial<CrewRow>) {
    setCrew((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  // Roster first, typing last: whoever is picked from the team arrives
  // with their phone number and roster link already attached. The
  // first pick drives (the common case); the rest ride as touts until
  // the dispatcher says otherwise. A lone empty row is replaced rather
  // than kept alongside the pick.
  function addCrewFromStaff(member: ParcelOrgStaffRow) {
    if (crew.some((c) => c.staffId === member.id)) return;
    const next: CrewRow = {
      key: crewKey++,
      name: member.name,
      msisdn: member.msisdn ?? '',
      role: crew.some((c) => c.role === 'DRIVER' && c.name.trim()) ? 'TOUT' : 'DRIVER',
      customRole: '',
      staffId: member.id,
    };
    setCrew((rows) =>
      rows.length === 1 && !rows[0]!.name.trim() && !rows[0]!.staffId ? [next] : [...rows, next],
    );
  }

  const crewNeedle = crewSearch.trim().toLowerCase();
  const crewCandidates = staff
    .filter((s) => !crew.some((c) => c.staffId === s.id) && matchStaff(s, crewNeedle, stationNameOf));
  const receiverNeedle = receiverSearch.trim().toLowerCase();
  const receiverCandidates = staff.filter((s) => matchStaff(s, receiverNeedle, stationNameOf));

  function save() {
    setError(null);
    const crewInput: DispatchCrewInput[] = crew
      .filter((c) => c.name.trim())
      .map((c) => ({
        name: c.name.trim(),
        msisdn: c.msisdn.trim() || null,
        role: c.role,
        customRole: c.role === 'OTHER' ? c.customRole.trim() || c.name.trim() : null,
        staffId: c.staffId || null,
      }));
    const receivers = [
      ...receiverIds
        .map((id) => staff.find((s) => s.id === id))
        .filter((s): s is ParcelOrgStaffRow => Boolean(s))
        .map((s) => ({ name: s.name, staffId: s.id })),
      ...extraReceivers.map((name) => ({ name, staffId: null as string | null })),
    ];
    startTransition(async () => {
      const result = await createDispatch({
        vehiclePlate: plate,
        vehicleType,
        routeId: routeId || null,
        originStationId: originId || null,
        destinationStationId: destinationId || null,
        notes: notes.trim() || null,
        crew: crewInput,
        receivers,
      });
      if (!result.ok) { setError(result.error); return; }
      onDone(result.id);
    });
  }

  return (
    <section className="ppanel porg-run-form">
      <div className="ppanel-head">
        <div>
          <h2>Open a run</h2>
          <p>
            Put a vehicle on the board: who is aboard and what each person does,
            where it is going, and who checks it in when it arrives. It opens
            loading, so parcels can be scanned onto it before it leaves.
          </p>
        </div>
      </div>

      <div className="ppanel-body porg-run-form-body">
        <fieldset className="psection is-boxed">
          <h3 className="psection-title">Vehicle</h3>
          <div className="pgrid">
            <label className="pfield"><span>Number plate</span>
              <input className="mono" value={plate} placeholder="e.g. KDK 412P"
                list="porg-known-plates"
                onChange={(e) => setPlate(e.target.value.toUpperCase())} />
              {knownPlates.length > 0 && (
                <datalist id="porg-known-plates">
                  {knownPlates.map((p) => <option key={p} value={p} />)}
                </datalist>
              )}
              {knownPlates.length > 0 && (
                <em className="sub">The same vans run daily — pick one already on the board.</em>
              )}
            </label>
            <label className="pfield"><span>Vehicle type</span>
              <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="psection is-boxed">
          <h3 className="psection-title">Journey</h3>
          {/* Route first, and it fills the two fields below. Picking one
              is the common morning case — the same leg every day — and
              typing it out is the exception, not the default. Ad-hoc
              stays possible on purpose: a vehicle at the door nobody
              planned for must not wait on a manager defining a route
              (ADR-0006). */}
          {routes.length > 0 && (
            <label className="pfield"><span>Route</span>
              <select
                value={routeId}
                onChange={(e) => {
                  const id = e.target.value;
                  setRouteId(id);
                  const r = routes.find((x) => x.id === id);
                  const stops = Array.isArray(r?.stops) ? r.stops : [];
                  if (stops.length >= 2) {
                    setOriginId(stops[0]!.stationId);
                    setDestinationId(stops[stops.length - 1]!.stationId);
                  }
                }}
              >
                <option value="">Ad-hoc — no route</option>
                {routes.filter((r) => r.active).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.code ? ` (${r.code})` : ''}
                  </option>
                ))}
              </select>
              <em className="sub">
                Sets where it leaves from and where it ends. Change either below if
                this vehicle is only doing part of the route.
              </em>
            </label>
          )}
          <div className="pgrid">
            <label className="pfield"><span>From</span>
              <select value={originId} onChange={(e) => setOriginId(e.target.value)}>
                <option value="">—</option>
                {stations.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="pfield"><span>To</span>
              <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
                <option value="">—</option>
                {stations.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="pfield"><span>Notes (optional)</span>
            <input value={notes} placeholder="e.g. Two crates of avocados, call on approach"
              onChange={(e) => setNotes(e.target.value)} />
          </label>
        </fieldset>

        <fieldset className="psection is-boxed">
          <h3 className="psection-title">
            Crew aboard{crew.some((c) => c.name.trim()) && <> — {crew.filter((c) => c.name.trim()).length} picked</>}
          </h3>
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            {crew.map((c) => (
              <div key={c.key} className="porg-crew-row">
                <span className="porg-crew-head">
                  <strong>{c.name.trim() || 'New crew member'}</strong>
                  <span className={`pill ${c.staffId ? 'p-ok' : 'p-warn'}`}>
                    {c.staffId ? 'From the team' : 'Off-roster'}
                  </span>
                </span>
                <div className="porg-crew-grid">
                  <label className="pfield"><span>Name</span>
                    <input value={c.name} placeholder="e.g. Otieno"
                      onChange={(e) => patchCrew(c.key, { name: e.target.value })} />
                  </label>
                  <label className="pfield"><span>Phone (optional)</span>
                    <input className="mono" value={c.msisdn} placeholder="07…" inputMode="tel"
                      onChange={(e) => patchCrew(c.key, { msisdn: e.target.value })} />
                  </label>
                  <label className="pfield"><span>Role</span>
                    <select value={c.role} onChange={(e) => patchCrew(c.key, { role: e.target.value })}>
                      {CREW_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  {c.role === 'OTHER' && (
                    <label className="pfield"><span>Custom role</span>
                      <input value={c.customRole} placeholder="e.g. Mechanic"
                        onChange={(e) => patchCrew(c.key, { customRole: e.target.value })} />
                    </label>
                  )}
                  <button
                    className="btn btn-o btn-sm porg-crew-remove" disabled={crew.length <= 1}
                    onClick={() => setCrew((rows) => rows.filter((r) => r.key !== c.key))}
                    aria-label={`Remove ${c.name.trim() || 'crew member'}`}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Roster first: whoever is picked arrives with their phone
              number and roster link attached, so the dispatcher taps
              instead of retyping people the company already employs.
              Typing stays for the day-labourer at the door. */}
          <div className="porg-pick">
            <label className="pfield"><span>Add from the team</span>
              <input
                value={crewSearch}
                onChange={(e) => setCrewSearch(e.target.value)}
                placeholder="Type a name, role or phone…"
                autoComplete="off" spellCheck={false}
              />
            </label>
            <ul className="porg-pick-list">
              {crewCandidates.slice(0, 30).map((s) => (
                <li key={s.id}>
                  <div className="plist-main">
                    <span className="plist-title">{s.name}</span>
                    <span className="plist-sub">
                      {s.role.toLowerCase()}
                      {s.msisdn && <> · <span className="mono">{s.msisdn}</span></>}
                      {stationNameOf(s.stationId) && <> · {stationNameOf(s.stationId)}</>}
                    </span>
                  </div>
                  <button type="button" className="btn btn-o btn-sm" onClick={() => addCrewFromStaff(s)}>
                    <Icon name="plus" size={14} />Add
                  </button>
                </li>
              ))}
              {crewCandidates.length === 0 && (
                <li className="porg-pick-empty sub">Nobody left to add — everyone matching is already aboard.</li>
              )}
            </ul>
            {crewCandidates.length > 30 && (
              <p className="sub">+{crewCandidates.length - 30} more — keep typing to narrow.</p>
            )}
            <button className="btn btn-o btn-sm" style={{ marginTop: 10 }} onClick={() => setCrew((rows) => [...rows, blankCrewRow()])}>
              <Icon name="plus" size={14} />Add someone off-roster
            </button>
          </div>
        </fieldset>

        <fieldset className="psection is-boxed">
          <h3 className="psection-title">
            Receiving team — checks the run in on arrival{receiverIds.length > 0 && <> — {receiverIds.length} picked</>}
          </h3>
          {staff.length === 0 ? (
            <p className="sub">No team members yet — type a name below instead.</p>
          ) : (
            <>
              {staff.length > 6 && (
                <label className="pfield" style={{ marginTop: 8 }}><span>Find on the team</span>
                  <input
                    value={receiverSearch}
                    onChange={(e) => setReceiverSearch(e.target.value)}
                    placeholder="Type a name, role or phone…"
                    autoComplete="off" spellCheck={false}
                  />
                </label>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {receiverCandidates.map((s) => (
                  <label key={s.id} className="sub porg-receiver-check" title={`${s.role.toLowerCase()}${stationNameOf(s.stationId) ? ` · ${stationNameOf(s.stationId)}` : ''}`}>
                    <input
                      type="checkbox"
                      checked={receiverIds.includes(s.id)}
                      onChange={(e) => setReceiverIds((ids) => e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))}
                    />
                    {s.name}
                  </label>
                ))}
                {receiverCandidates.length === 0 && (
                  <p className="sub">Nobody on the team matches — type the name below instead.</p>
                )}
              </div>
            </>
          )}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <input
              className="pinput" style={{ flex: 1 }}
              value={receiverName}
              placeholder="Or type a name at the counter…"
              onChange={(e) => setReceiverName(e.target.value)}
            />
            <button
              className="btn btn-o btn-sm"
              disabled={!receiverName.trim()}
              onClick={() => { setExtraReceivers((xs) => [...xs, receiverName.trim()]); setReceiverName(''); }}
            >
              <Icon name="plus" size={14} />Add
            </button>
          </div>
          {extraReceivers.length > 0 && (
            <p className="sub" style={{ marginTop: 8 }}>
              Added: {extraReceivers.join(', ')}{' '}
              <button className="btn btn-o btn-sm" onClick={() => setExtraReceivers([])}>Clear</button>
            </p>
          )}
        </fieldset>

        {error && (
          <p role="alert" className="pnote pnote-bad">
            <Icon name="alert-circle" size={16} /><span>{error}</span>
          </p>
        )}

        {/* The primary action sits inside the panel body, at the end of
            the thing it commits — it used to float outside the padded
            area against the card edge. */}
        <div className="ptoolbar porg-run-form-actions">
          <button className="btn btn-p" disabled={pending || !ready} onClick={save}>
            <Icon name="send" size={16} />{pending ? 'Opening…' : 'Open the run'}
          </button>
          {!ready && (
            <span className="sub">Needs a plate, a destination, and at least one crew member.</span>
          )}
        </div>
      </div>
    </section>
  );
}

function RunDetail({
  run, orgName, pending, startTransition, onChanged,
}: {
  run: DispatchRun;
  orgName: string;
  pending: boolean;
  startTransition: TransitionStartFunction;
  onChanged: () => Promise<void>;
}) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // DEPARTED, not merely open: a run still at the shed has no position
  // to report and no arrival to confirm, and the server refuses both
  // for a LOADING run (see dbx.ReportRunPosition).
  const isActive = run.status === 'DEPARTED';
  const isLoading = run.status === 'LOADING';
  const now = useNow();
  const crewList = Array.isArray(run.crew) ? run.crew : [];
  const receiverList = Array.isArray(run.receivers) ? run.receivers : [];
  const trail = Array.isArray(run.trail) ? run.trail : [];
  const driver = crewList.find((c) => c.role === 'DRIVER') ?? crewList[0] ?? null;
  const others = crewList.filter((c) => c !== driver);
  const stops = recordedStops(trail);
  const speed = currentSpeedKmh(trail);
  const progress = journeyProgress(run);
  const covered = distanceCoveredKm(trail);

  function useMyLocation() {
    if (!('geolocation' in navigator)) { setError('This device has no location to share'); return; }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
      },
      () => { setLocating(false); setError('Could not read this device’s location'); },
      { timeout: 10000 },
    );
  }

  function postPosition() {
    setError(null);
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) { setError('Enter a valid latitude and longitude'); return; }
    startTransition(async () => {
      const result = await reportDispatchPosition(run.id, la, ln);
      if (!result.ok) { setError(result.error); return; }
      setLat(''); setLng('');
      await onChanged();
    });
  }

  function arrive() {
    setError(null);
    startTransition(async () => {
      const result = await arriveDispatch(run.id, receivedBy);
      if (!result.ok) { setError(result.error); return; }
      await onChanged();
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelDispatch(run.id);
      if (!result.ok) { setError(result.error); return; }
      await onChanged();
    });
  }

  function depart() {
    setError(null);
    startTransition(async () => {
      const result = await departDispatch(run.id);
      if (!result.ok) { setError(result.error); return; }
      await onChanged();
    });
  }

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      {/* Loading availability, stated once per run so nobody has to
          guess: only a LOADING run accepts parcels. The server enforces
          the same rule (see dbx.LoadParcelOntoOrgShipment) — this is
          the sign on the door, not the lock. */}
      {isLoading && (
        <p className="pnote pnote-warn porg-load-note" role="note">
          <Icon name="box" size={16} />
          <span>
            Still loading at the shed — scan parcels onto this run from the{' '}
            <Link href="/parcel-org/scan">Scanner</Link>.
            Setting off closes loading for good.
          </span>
        </p>
      )}
      {isActive && (
        <p className="pnote porg-load-note porg-load-locked" role="note">
          <Icon name="truck" size={16} />
          <span>
            On the road — loading is closed. The Scanner no longer offers
            this run, and the manifest below is final.
          </span>
        </p>
      )}
      {/* Live summary: status, speed, progress, stops — the glanceable row. */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 12 }}>
        <div className="kpi">
          <span className="l">Status</span>
          <span className="n" style={{ fontSize: '1rem' }}>{isActive ? (now === null ? '…' : lastSeenLabel(run.currentAt, now)) : statusLabel(run.status)}</span>
          <span className="sub">{orgName} fleet</span>
        </div>
        <div className="kpi">
          <span className="l">Moving at</span>
          <span className="n">{speed === null ? '—' : `${Math.round(speed)} km/h`}</span>
          <span className="sub">from the last two reports</span>
        </div>
        <div className="kpi">
          <span className="l">Journey</span>
          <span className="n">{progress === null ? '—' : `${Math.round(progress * 100)}%`}</span>
          <span className="sub">{covered < 1 ? 'just left' : `${covered.toFixed(1)} km covered`}</span>
        </div>
        <div className="kpi">
          <span className="l">Stops made</span>
          <span className="n">{stops.length}</span>
          <span className="sub">{trail.length} position reports</span>
        </div>
      </div>

      {progress !== null && (
        <div style={{ height: 8, borderRadius: 4, background: 'var(--line)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--blue, #1565C0)' }} />
        </div>
      )}

      {stops.length > 0 && (
        <p className="sub" style={{ margin: '0 0 12px' }}>
          <Icon name="pin" size={13} /> Stopped {stops.map((s) => `${s.mins} min`).join(' · ')} along the way.
        </p>
      )}

      <div className="pgrid">
        <div>
          <h4 className="psection-title">Driver</h4>
          {!driver ? (
            <p className="sub" style={{ margin: '8px 0 0' }}>No crew recorded on this run.</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              <strong>{driver.name}</strong>{' '}
              <span className="sub">{(driver.roleLabel ?? driver.role ?? '').toLowerCase()}</span>
              {driver.msisdn && (
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <DemoCallButton msisdn={driver.msisdn} primary />
                  <DemoMessageButton msisdn={driver.msisdn} />
                </div>
              )}
            </div>
          )}
          {others.length > 0 && (
            <>
              <h4 className="psection-title" style={{ marginTop: 12 }}>Also aboard</h4>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {others.map((c) => (
                  <li key={c.id} style={{ marginBottom: 4 }}>
                    <strong>{c.name}</strong>{' '}
                    <span className="sub">{(c.roleLabel ?? c.role ?? '').toLowerCase()}{c.msisdn ? ` · ${c.msisdn}` : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <h4 className="psection-title">Receiving team</h4>
          {receiverList.length === 0 ? (
            <p className="sub" style={{ margin: '8px 0 0' }}>Nobody named — say who signed on arrival.</p>
          ) : (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {receiverList.map((r) => <li key={r.id}>{r.name}</li>)}
            </ul>
          )}
          {run.notes && <p className="sub" style={{ margin: '8px 0 0' }}>Note: {run.notes}</p>}
          {run.status === 'ARRIVED' && (
            <p className="sub" style={{ margin: '8px 0 0' }}>
              Checked in{run.receivedBy ? <> by <strong>{run.receivedBy}</strong></> : ''}.
            </p>
          )}
        </div>
      </div>

      {error && <p role="alert" className="sub" style={{ color: 'var(--red)', marginTop: 12 }}>{error}</p>}

      {/* Still at the shed: the run leaves from here. Departing is the
          point of no return for loading — the server moves LOADING to
          DEPARTED and refuses further loads (see dbx.StartOrgShipment). */}
      {isLoading && (
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Link
            className="btn btn-o btn-sm"
            href={`/parcel-org/dispatch/runs/${run.id}/manifest` as Route}
          >
            <Icon name="print" size={14} />Check the manifest ({run.loaded})
          </Link>
          <button className="btn btn-p btn-sm" disabled={pending} onClick={depart}>
            <Icon name="send" size={14} />{pending ? 'Setting off…' : 'Set off — close loading'}
          </button>
          <button className="btn btn-o btn-sm" disabled={pending} onClick={cancel}>
            Cancel run
          </button>
        </div>
      )}

      {isActive && (
        <>
          <div className="psection is-boxed" style={{ marginTop: 12 }}>
            <h4 className="psection-title">Where is the fleet now?</h4>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                className="pinput mono" style={{ maxWidth: 170 }}
                value={lat} placeholder="Latitude" inputMode="decimal"
                onChange={(e) => setLat(e.target.value.replace(/[^\d.-]/g, ''))}
              />
              <input
                className="pinput mono" style={{ maxWidth: 170 }}
                value={lng} placeholder="Longitude" inputMode="decimal"
                onChange={(e) => setLng(e.target.value.replace(/[^\d.-]/g, ''))}
              />
              <button className="btn btn-o btn-sm" disabled={locating} onClick={useMyLocation}>
                <Icon name="pin" size={14} />{locating ? 'Reading…' : 'Use my location'}
              </button>
              <button className="btn btn-p btn-sm" disabled={pending || !lat || !lng} onClick={postPosition}>
                {pending ? 'Updating…' : 'Update position'}
              </button>
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <input
              className="pinput" style={{ flex: 1, minWidth: 200 }}
              value={receivedBy}
              placeholder={receiverList.length > 0 ? `Who signed? (${receiverList.map((r) => r.name).join(', ')})` : 'Who signed at the counter?'}
              onChange={(e) => setReceivedBy(e.target.value)}
            />
            <button className="btn btn-p btn-sm" disabled={pending} onClick={arrive}>
              <Icon name="check" size={14} />Mark arrived
            </button>
            <button className="btn btn-o btn-sm" disabled={pending} onClick={cancel}>
              Cancel run
            </button>
          </div>
        </>
      )}
    </div>
  );
}
