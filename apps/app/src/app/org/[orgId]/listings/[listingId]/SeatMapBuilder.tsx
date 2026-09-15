'use client';
import { useMemo, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { SEAT_MAP_PATTERNS, columnsForPattern, type SeatMapPattern } from '@esoqo/domain';
import { actionSaveSeatMap } from '../actions';

interface TicketClassOption { id: string; name: string; priceKes: number }

/** A soft, distinct colour per ticket class so the painted grid reads
 *  at a glance which seats are which class — cycles if there are more
 *  classes than colours, which is fine, it's a visual aid not an ID. */
const CLASS_COLOURS = ['#dbe9ff', '#ffe4c2', '#d6f5df', '#f6d6e8', '#e6dbff', '#fff3b0'];

export function SeatMapBuilder(
  { orgId, listingId, seatedClasses, existing }:
  {
    orgId: string; listingId: string; seatedClasses: TicketClassOption[];
    existing: { rows: number; pattern: string; seats: { label: string; ticketClassId: string }[] } | null;
  },
) {
  const [rows, setRows] = useState(existing?.rows ?? 11);
  const [pattern, setPattern] = useState<SeatMapPattern>((existing?.pattern as SeatMapPattern) ?? '2+2');
  const [activeClassId, setActiveClassId] = useState(seatedClasses[0]?.id ?? '');
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of existing?.seats ?? []) init[s.label] = s.ticketClassId;
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const { left, right } = useMemo(() => columnsForPattern(pattern), [pattern]);
  const classById = useMemo(() => new Map(seatedClasses.map((c) => [c.id, c])), [seatedClasses]);

  function labelFor(row: number, col: string) { return `${row}${col}`; }

  function buildGrid() {
    // (Re)paints every seat in the new dimensions with the active
    // class — an organiser can then click exceptions (comfort rows)
    // without having to click all 40+ regular seats one by one.
    const next: Record<string, string> = {};
    const cols = [...left, ...right];
    for (let r = 1; r <= rows; r++) {
      for (const c of cols) next[labelFor(r, c)] = activeClassId;
    }
    setAssignments(next);
  }

  function paintSeat(label: string) {
    if (!activeClassId) return;
    setAssignments((prev) => ({ ...prev, [label]: activeClassId }));
  }

  function removeSeat(label: string) {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
  }

  const paintedCount = Object.keys(assignments).length;
  const countByClass = useMemo(() => {
    const m = new Map<string, number>();
    for (const classId of Object.values(assignments)) m.set(classId, (m.get(classId) ?? 0) + 1);
    return m;
  }, [assignments]);

  function submit() {
    setError(null);
    const seats = Object.entries(assignments).map(([label, ticketClassId]) => ({ label, ticketClassId }));
    if (seats.length === 0) { setError('Build the grid, then paint at least one seat'); return; }
    start(async () => {
      const r = await actionSaveSeatMap(orgId, listingId, { rows, pattern, seats });
      if (r.ok) announce('Seat map saved.', 'polite');
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  if (seatedClasses.length === 0) {
    return (
      <div className="mcard" style={{ marginBottom: 16 }}>
        <h2><Icon name="grid" size={18} />Seat map</h2>
        <p style={{ margin: 0, color: 'var(--tx-2)' }}>
          Add a numbered-seat ticket class first (e.g. "Economy seat"), then come back here to lay out the bus.
        </p>
      </div>
    );
  }

  return (
    <div className="mcard" style={{ marginBottom: 16 }}>
      <h2><Icon name="grid" size={18} />Seat map</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--tx-2)', fontSize: '.9rem' }}>
        Lay this out once — every future departure reuses it. Pick a ticket class below, then click seats to
        paint them into it (e.g. leave everything as Economy, then click the front row into Comfort).
      </p>

      <div className="row" style={{ gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="fld" style={{ margin: 0 }}>
          <label className="lab" htmlFor="sm-rows">Rows</label>
          <input className="inp mono" id="sm-rows" inputMode="numeric" style={{ width: 80 }}
            value={rows} onChange={(e) => setRows(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
        </div>
        <div className="fld" style={{ margin: 0 }}>
          <label className="lab" htmlFor="sm-pattern">Layout</label>
          <select className="chip" id="sm-pattern" value={pattern} onChange={(e) => setPattern(e.target.value as SeatMapPattern)}>
            {SEAT_MAP_PATTERNS.map((p) => <option key={p} value={p}>{p} (aisle between)</option>)}
          </select>
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <button type="button" className="btn btn-o" onClick={buildGrid}>Build grid</button>
        </div>
      </div>

      <div className="fld">
        <span className="lab">Painting</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {seatedClasses.map((c, i) => (
            <button key={c.id} type="button"
              className="btn btn-sm"
              style={{
                background: activeClassId === c.id ? CLASS_COLOURS[i % CLASS_COLOURS.length] : 'transparent',
                borderColor: CLASS_COLOURS[i % CLASS_COLOURS.length],
              }}
              onClick={() => setActiveClassId(c.id)}>
              {c.name} — KES {c.priceKes.toLocaleString('en-KE')} ({countByClass.get(c.id) ?? 0} seats)
            </button>
          ))}
        </div>
      </div>

      {paintedCount > 0 && (
        // Rotated to match the public booking page: the bus runs right →
        // left (row 1 on the right), scrolling horizontally instead of
        // stacking every row down the page.
        <div style={{ overflowX: 'auto', marginBottom: 16, padding: '16px 0' }}>
          <div style={{ display: 'inline-flex', flexDirection: 'row-reverse', gap: 10 }}>
            {Array.from({ length: rows }, (_, i) => i + 1).map((row) => (
              <div key={row} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span className="sub mono" style={{ fontSize: '.7rem' }}>{row}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {left.map((c) => (
                    <SeatCell key={c} label={labelFor(row, c)} assignments={assignments} classById={classById}
                      seatedClasses={seatedClasses} onPaint={paintSeat} onRemove={removeSeat} />
                  ))}
                </div>
                <div style={{ height: 14 }} aria-hidden />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {right.map((c) => (
                    <SeatCell key={c} label={labelFor(row, c)} assignments={assignments} classById={classById}
                      seatedClasses={seatedClasses} onPaint={paintSeat} onRemove={removeSeat} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-p" disabled={pending || paintedCount === 0} onClick={submit}>
        {pending ? 'Saving…' : `Save seat map (${paintedCount} seats)`}
      </button>
      <p className="sub" style={{ margin: '10px 0 0', fontSize: '.8rem' }}>
        Only affects departures scheduled after you save — trips already on the calendar keep their seats as-is.
      </p>
    </div>
  );
}

function SeatCell(
  { label, assignments, classById, seatedClasses, onPaint, onRemove }:
  {
    label: string; assignments: Record<string, string>;
    classById: Map<string, TicketClassOption>; seatedClasses: TicketClassOption[];
    onPaint: (label: string) => void; onRemove: (label: string) => void;
  },
) {
  const classId = assignments[label];
  const idx = classId ? seatedClasses.findIndex((c) => c.id === classId) : -1;
  const colour = idx >= 0 ? CLASS_COLOURS[idx % CLASS_COLOURS.length] : undefined;
  const cls = classId ? classById.get(classId) : undefined;

  return (
    <button type="button"
      title={cls ? `${label} — ${cls.name}` : `${label} — unsold`}
      onClick={() => onPaint(label)}
      onContextMenu={(e) => { e.preventDefault(); onRemove(label); }}
      style={{
        width: 34, height: 34, fontSize: '.7rem', borderRadius: 6, border: '1.5px solid var(--line)',
        background: colour ?? 'transparent', color: 'var(--tx-1)', cursor: 'pointer', padding: 0,
      }}>
      {label}
    </button>
  );
}
