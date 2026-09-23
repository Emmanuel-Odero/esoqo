'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  flushCustody, Icon, pendingCustodyCount, PrintableLuggageTag, PrintStyles,
  queueCustody,
} from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import type { FareStage } from '@/lib/fleet';
import type { LuggageClaimMethod, LuggageClaimResult, LuggageTag } from '@/lib/luggage';
import {
  actionBoardLuggage, actionClaimLuggage, actionListTripLuggage, actionTagLuggage,
} from './actions';
import { beep, flash } from './feedback';

/**
 * The crew's luggage desk — tagging bags on, and handing them back.
 *
 * Every decision in this file is dictated by one number: forty bags in
 * three minutes, at a stage, in the dark. That is under five seconds a
 * bag, which rules out a wizard, a confirm dialog, a route transition,
 * and any keypad that could have been a chip.
 *
 * So: one view with two modes, the scan field owns focus permanently,
 * the trip is chosen once and stays chosen, the destination is a chip
 * row built from the route's own stages, the piece count is a "+"
 * button, and the only thing anyone types is a surname. Feedback is
 * physical (colour flash + distinct beep) because a conductor in a
 * moving vehicle does not read prose.
 *
 * Mirrors the parcel counter's stated standard — "one view, not a
 * wizard… counter work is measured in seconds per customer and every
 * route transition is a stall" (packages/ui/src/ParcelCounter.tsx) —
 * for the same reason, against a tighter budget.
 */

type Mode = 'board' | 'claim';

/**
 * A running vehicle, as this desk needs it.
 *
 * Purpose-built rather than the wire's FleetTrip: those older fleet
 * structs carry Go field names (VehiclePlate, ShortRouteID) that must
 * match the server byte for byte, and that convention has no business
 * spreading into a component the server never sees. The page maps once,
 * here it reads like a UI.
 */
export interface DeskTrip {
  id: string;
  plate: string;
  routeId: string | null;
  routeName: string | null;
}

const CLAIM_METHOD_LABEL: Record<LuggageClaimMethod, string> = {
  STUB_SCAN: 'Stub scanned',
  CODE_TYPED: 'Code typed',
  TICKET_MATCH: 'Ticket matched',
  OVERRIDE: 'Released without a stub',
};

export function LuggageDesk({
  orgId, trips, stagesByRoute, orgName, webUrl, canTag, canClaim,
}: {
  orgId: string;
  trips: DeskTrip[];
  /** Drop-point chips, keyed by the trip's short route. A trip with no
   *  route gets a free-text destination instead — plenty of runs have
   *  no named stages and must still be able to tag a bag. */
  stagesByRoute: Record<string, FareStage[]>;
  orgName: string;
  webUrl: string;
  canTag: boolean;
  canClaim: boolean;
}) {
  const announce = useAnnounce();
  const scanRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>(canTag ? 'board' : 'claim');
  const [tripId, setTripId] = useState<string>(trips[0]?.id ?? '');
  const [scan, setScan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Boarding form. Three fields, one of them typed.
  const [passengerName, setPassengerName] = useState('');
  const [destination, setDestination] = useState('');
  const [dropStageId, setDropStageId] = useState<string | null>(null);
  const [pieceCount, setPieceCount] = useState(1);

  // What just happened — the tags to print, or the claim to confirm.
  const [printing, setPrinting] = useState<LuggageTag[] | null>(null);
  const [claimed, setClaimed] = useState<LuggageClaimResult | null>(null);
  const [manifest, setManifest] = useState<LuggageTag[]>([]);
  // Boarding scans held on this phone because there was no signal. Shown
  // as a badge rather than hidden: a conductor who cannot see that nine
  // bags are still only on the handset has no way to know the trip's
  // record is incomplete.
  const [queued, setQueued] = useState(0);

  const trip = useMemo(() => trips.find((t) => t.id === tripId), [trips, tripId]);
  const stages = useMemo(
    () => (trip?.routeId ? (stagesByRoute[trip.routeId] ?? []) : []),
    [trip, stagesByRoute],
  );

  /** The scan field holds focus from mount and takes it back after every
   *  action — a handheld gun is just a keyboard that types fast and hits
   *  Enter, so anything that steals focus costs a scan. */
  const refocus = useCallback(() => {
    // rAF rather than a bare call: React may still be committing the
    // state change that re-enabled the input.
    requestAnimationFrame(() => scanRef.current?.focus());
  }, []);
  useEffect(refocus, [refocus, mode, busy]);

  const refreshManifest = useCallback(async () => {
    if (!tripId) return;
    const res = await actionListTripLuggage(orgId, tripId);
    if (res.ok) setManifest(res.data);
  }, [orgId, tripId]);

  useEffect(() => { void refreshManifest(); }, [refreshManifest]);

  /**
   * Push held boarding scans up whenever there is a network.
   *
   * On mount, on the browser's `online` event, and on a slow interval —
   * three triggers because none is reliable alone: `online` fires on a
   * captive portal that still cannot reach us, and a phone in a pocket
   * all afternoon may never fire it. Replay is a no-op server-side, so
   * running this more often than needed costs a request and nothing else.
   */
  const flush = useCallback(async () => {
    await flushCustody<{ code: string }>(async (entry) => {
      try {
        const r = await actionBoardLuggage(orgId, entry.input.code);
        return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
      } catch {
        throw new Error('offline');
      }
    });
    setQueued(await pendingCustodyCount());
    void refreshManifest();
  }, [orgId, refreshManifest]);

  useEffect(() => {
    void flush();
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    const id = setInterval(() => void flush(), 30000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(id);
    };
  }, [flush]);

  function fail(message: string) {
    setError(message);
    flash('bad');
    beep('bad');
    announce(message, 'assertive');
    refocus();
  }

  function succeed(message: string) {
    setError(null);
    flash('good');
    beep('good');
    announce(message, 'assertive');
    refocus();
  }

  /** Tag this passenger's bags and hand back the tags to print. */
  async function tag() {
    if (busy) return;
    if (!tripId) return fail('Pick the vehicle first');
    if (!passengerName.trim()) return fail('Whose bag is it?');
    if (!destination.trim()) return fail('Where does it come off?');
    setBusy(true);
    const res = await actionTagLuggage(orgId, {
      tripId,
      passengerName: passengerName.trim(),
      destinationLabel: destination.trim(),
      dropStageId,
      pieceCount,
    });
    setBusy(false);
    if (!res.ok) return fail(res.error);
    setPrinting(res.data);
    succeed(
      pieceCount > 1
        ? `${pieceCount} tags for ${passengerName.trim()} — tear the stubs off`
        : `Tag ${res.data[0]?.code ?? ''} — tear the stub off`,
    );
    // Keep the destination and the trip: the next passenger at this
    // stage is usually going to the same place, and re-picking it forty
    // times is forty taps nobody has. Name and piece count reset,
    // because those never repeat.
    setPassengerName('');
    setPieceCount(1);
    void refreshManifest();
  }

  /** Scan a tag onto the vehicle. Idempotent server-side, so a
   *  double-scan is a no-op rather than something to stop and read —
   *  and that same property is what makes queueing it safe when the
   *  network is gone, which at a stage is most of the time. */
  async function board(code: string) {
    if (busy) return;
    setBusy(true);
    let res: Awaited<ReturnType<typeof actionBoardLuggage>>;
    try {
      res = await actionBoardLuggage(orgId, code);
    } catch {
      // The mast, not the server. The bag is going on the bus either
      // way; refusing to record it would leave the only account of it
      // in a conductor's memory.
      setBusy(false);
      try {
        await queueCustody('luggage.board', code, { code });
        setQueued((n) => n + 1);
        succeed(`${code} aboard — held on this phone until there's signal`);
        setScan('');
      } catch {
        fail('No signal, and this phone cannot hold work offline.');
      }
      return;
    }
    setBusy(false);
    if (!res.ok) return fail(res.error);
    succeed(`${res.data.code} aboard — ${res.data.destinationLabel}`);
    setScan('');
    void refreshManifest();
  }

  /** Hand a bag back. */
  async function claim(code: string, method: LuggageClaimMethod, reason?: string) {
    if (busy) return;
    setBusy(true);
    const res = await actionClaimLuggage(orgId, code, method, reason);
    setBusy(false);
    if (!res.ok) return fail(res.error);
    setClaimed(res.data);
    const left = res.data.siblingsStillAboard;
    succeed(
      left > 0
        ? `${res.data.tag.code} handed over — ${left} more still aboard`
        : `${res.data.tag.code} handed over`,
    );
    setScan('');
    void refreshManifest();
  }

  /** One field, two meanings. In board mode a scanned code goes aboard;
   *  in claim mode it goes out. The crew never picks which — the mode
   *  they are already in decides, which is one fewer decision per bag. */
  function onScanSubmit() {
    const code = scan.trim();
    if (!code) return;
    // A camera decodes the tracking URL, a gun the bare code — accept
    // either rather than making the crew care which device they grabbed.
    const clean = code.includes('/') ? (code.split('/').pop() ?? code).split('?')[0]! : code;
    if (mode === 'board') void board(clean.toUpperCase());
    else void claim(clean.toUpperCase(), 'STUB_SCAN');
  }

  const aboard = manifest.filter((t) => t.status === 'ABOARD' || t.status === 'TAGGED');

  return (
    <div className="luggage-desk">
      <PrintStyles />

      {queued > 0 && (
        <div
          className="card"
          role="status"
          style={{
            padding: '12px 16px', marginBottom: 16,
            background: 'var(--blue-t)', border: '1px solid var(--blue)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="wifi-off" size={18} />
            <strong>{queued} scan{queued > 1 ? 's' : ''} held on this phone</strong>
          </div>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            They will go up on their own once there is signal.
          </p>
        </div>
      )}

      {/* ── The trip. Chosen once, then out of the way. ───────────── */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label className="sub" htmlFor="lug-trip" style={{ display: 'block', marginBottom: 6 }}>
          Vehicle on this run
        </label>
        <select
          id="lug-trip"
          className="input"
          value={tripId}
          onChange={(e) => { setTripId(e.target.value); setDropStageId(null); setDestination(''); }}
          style={{ minHeight: 48, fontSize: '1.05rem' }}
        >
          {trips.length === 0 && <option value="">No vehicle is out right now</option>}
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.plate}{t.routeName ? ` · ${t.routeName}` : ''}
            </option>
          ))}
        </select>
        {trips.length === 0 && (
          <p className="sub" style={{ margin: '8px 0 0', color: 'var(--red)' }}>
            Start a trip on the Fleet page before tagging bags — a bag with no
            vehicle is not something this can help with.
          </p>
        )}
      </div>

      {/* ── Mode. Two big targets, thumb-reachable. ───────────────── */}
      <div role="tablist" aria-label="Luggage mode" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {canTag && (
          <ModeTab active={mode === 'board'} onClick={() => setMode('board')} icon="plus" label="Tag & load" />
        )}
        {canClaim && (
          <ModeTab active={mode === 'claim'} onClick={() => setMode('claim')} icon="check" label="Hand back" />
        )}
      </div>

      {/* ── The scan field. Owns focus, always. ───────────────────── */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label className="sub" htmlFor="lug-scan" style={{ display: 'block', marginBottom: 6 }}>
          {mode === 'board' ? 'Scan the tag you just stuck on' : 'Scan the passenger’s stub'}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="lug-scan"
            ref={scanRef}
            className="input mono"
            value={scan}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="LUG-…"
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScanSubmit(); } }}
            style={{ flex: 1, minHeight: 56, fontSize: '1.15rem', letterSpacing: '.04em' }}
          />
          <button
            type="button"
            className="btn btn-p"
            disabled={busy || !scan.trim()}
            onClick={onScanSubmit}
            style={{ minHeight: 56, minWidth: 96 }}
          >
            {busy ? '…' : mode === 'board' ? 'Aboard' : 'Hand back'}
          </button>
        </div>
        {mode === 'claim' && (
          <button
            type="button"
            className="btn btn-o btn-sm"
            style={{ marginTop: 10 }}
            disabled={busy || !scan.trim()}
            onClick={() => {
              const reason = window.prompt(
                'No stub. Say what happened — this goes on the trip’s close-out.',
              );
              if (reason && reason.trim()) void claim(scan.trim().toUpperCase(), 'OVERRIDE', reason.trim());
            }}
          >
            <Icon name="alert-triangle" size={14} /> No stub — release anyway
          </button>
        )}
        {error && (
          <p role="alert" className="sub" style={{ margin: '10px 0 0', color: 'var(--red)', fontWeight: 600 }}>
            {error}
          </p>
        )}
      </div>

      {mode === 'board' && canTag && (
        <TagForm
          passengerName={passengerName}
          setPassengerName={setPassengerName}
          destination={destination}
          setDestination={setDestination}
          dropStageId={dropStageId}
          setDropStageId={setDropStageId}
          pieceCount={pieceCount}
          setPieceCount={setPieceCount}
          stages={stages}
          busy={busy}
          onSubmit={() => void tag()}
        />
      )}

      {claimed && mode === 'claim' && <ClaimCard result={claimed} onNext={() => { setClaimed(null); refocus(); }} />}

      {printing && (
        <PrintPanel
          tags={printing}
          orgName={orgName}
          webUrl={webUrl}
          onDone={() => { setPrinting(null); refocus(); }}
        />
      )}

      <Manifest aboard={aboard} total={manifest.length} />
    </div>
  );
}

function ModeTab({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: 'plus' | 'check'; label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={active ? 'btn btn-p' : 'btn btn-o'}
      style={{ flex: 1, minHeight: 52, fontSize: '1.02rem', gap: 8 }}
    >
      <Icon name={icon} size={18} />{label}
    </button>
  );
}

/**
 * The tagging form. One typed field, one chip row, one stepper.
 *
 * Destination is chips rather than a select because a select is two
 * taps and a scroll; the stages of the route this vehicle is actually
 * running are a short, known list, which is exactly what chips are for.
 * A route with no named stages falls back to free text rather than
 * blocking — plenty of runs have none.
 */
function TagForm({
  passengerName, setPassengerName, destination, setDestination,
  dropStageId, setDropStageId, pieceCount, setPieceCount, stages, busy, onSubmit,
}: {
  passengerName: string; setPassengerName: (v: string) => void;
  destination: string; setDestination: (v: string) => void;
  dropStageId: string | null; setDropStageId: (v: string | null) => void;
  pieceCount: number; setPieceCount: (v: number) => void;
  stages: FareStage[]; busy: boolean; onSubmit: () => void;
}) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <label className="sub" htmlFor="lug-name" style={{ display: 'block', marginBottom: 6 }}>
        Passenger — surname is enough
      </label>
      <input
        id="lug-name"
        className="input"
        value={passengerName}
        autoComplete="off"
        placeholder="e.g. Wanjiku"
        onChange={(e) => setPassengerName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        style={{ minHeight: 52, fontSize: '1.08rem' }}
      />

      <p className="sub" style={{ margin: '14px 0 6px' }}>Comes off at</p>
      {stages.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {stages.map((s) => {
            const on = dropStageId === s.ID;
            return (
              <button
                key={s.ID}
                type="button"
                aria-pressed={on}
                className={on ? 'btn btn-p btn-sm' : 'btn btn-o btn-sm'}
                onClick={() => { setDropStageId(s.ID); setDestination(s.Name); }}
                style={{ minHeight: 46, padding: '0 16px', fontSize: '1rem' }}
              >
                {s.Name}
              </button>
            );
          })}
          {/* The terminus is a real, common answer and must not need the
              free-text escape hatch. */}
          <button
            type="button"
            aria-pressed={dropStageId === null && destination === 'Terminus'}
            className={dropStageId === null && destination === 'Terminus' ? 'btn btn-p btn-sm' : 'btn btn-o btn-sm'}
            onClick={() => { setDropStageId(null); setDestination('Terminus'); }}
            style={{ minHeight: 46, padding: '0 16px', fontSize: '1rem' }}
          >
            Terminus
          </button>
        </div>
      ) : (
        <input
          className="input"
          value={destination}
          placeholder="e.g. Nakuru"
          onChange={(e) => { setDestination(e.target.value); setDropStageId(null); }}
          style={{ minHeight: 52, fontSize: '1.08rem' }}
        />
      )}

      {/* Piece count. A stepper, not a keypad — the answer is almost
          always 1 and never large, and "3 of 4" is the field that makes
          a missing bag visible at the far end. */}
      <p className="sub" style={{ margin: '14px 0 6px' }}>How many pieces</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button" className="btn btn-o" aria-label="One fewer piece"
          disabled={pieceCount <= 1}
          onClick={() => setPieceCount(Math.max(1, pieceCount - 1))}
          style={{ minWidth: 56, minHeight: 52, fontSize: '1.4rem' }}
        >−</button>
        <strong style={{ fontSize: '1.6rem', minWidth: 32, textAlign: 'center' }}>{pieceCount}</strong>
        <button
          type="button" className="btn btn-o" aria-label="One more piece"
          onClick={() => setPieceCount(Math.min(20, pieceCount + 1))}
          style={{ minWidth: 56, minHeight: 52, fontSize: '1.4rem' }}
        >+</button>
        {pieceCount > 1 && (
          <span className="sub">{pieceCount} tags print, numbered 1–{pieceCount}</span>
        )}
      </div>

      <button
        type="button"
        className="btn btn-p"
        disabled={busy}
        onClick={onSubmit}
        style={{ width: '100%', minHeight: 58, marginTop: 18, fontSize: '1.08rem' }}
      >
        {busy ? 'Tagging…' : pieceCount > 1 ? `Tag ${pieceCount} pieces` : 'Tag this bag'}
      </button>
    </div>
  );
}

/**
 * What the crew sees the instant a bag goes out.
 *
 * The sibling count is the whole point of this card: "2 of 3, one still
 * aboard" is the difference between catching a forgotten bag while the
 * passenger is still standing there and a phone call the next day.
 */
function ClaimCard({ result, onNext }: { result: LuggageClaimResult; onNext: () => void }) {
  const left = result.siblingsStillAboard;
  return (
    <div
      className="card"
      style={{
        padding: 20, marginBottom: 16,
        background: left > 0 ? 'var(--amber-t, #FFF6E5)' : 'var(--green-t)',
        border: `2px solid ${left > 0 ? 'var(--amber, #C77700)' : 'var(--green)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Icon name={left > 0 ? 'alert-triangle' : 'check'} size={22} />
        <strong style={{ fontSize: '1.2rem' }}>
          {left > 0 ? `${left} more bag${left > 1 ? 's' : ''} still aboard` : 'Handed over'}
        </strong>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
        <span className="mono">{result.tag.code}</span> ·{' '}
        {result.tag.pieceNo} of {result.tag.pieceCount} · {result.tag.destinationLabel}
      </p>
      {result.tag.claimMethod && (
        <p className="sub" style={{ margin: 0 }}>{CLAIM_METHOD_LABEL[result.tag.claimMethod]}</p>
      )}
      {result.siblings.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          {result.siblings.map((s) => (
            <li key={s.id} style={{ fontSize: '.95rem' }}>
              <span className="mono">{s.code}</span> — piece {s.pieceNo}:{' '}
              <strong>{s.status === 'CLAIMED' ? 'handed over' : 'still aboard'}</strong>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-o btn-sm" onClick={onNext} style={{ marginTop: 14 }}>
        Next passenger
      </button>
    </div>
  );
}

/** The tags, ready to peel. Printed the moment they exist — the
 *  passenger is standing there and the bag has no tag on it yet. */
function PrintPanel({ tags, orgName, webUrl, onDone }: {
  tags: LuggageTag[]; orgName: string; webUrl: string; onDone: () => void;
}) {
  return (
    <div className="card print-modal-escape" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {tags.map((t) => (
          <PrintableLuggageTag
            key={t.id}
            tag={{
              code: t.code,
              passengerName: t.passengerName,
              destinationLabel: t.destinationLabel,
              pieceNo: t.pieceNo,
              pieceCount: t.pieceCount,
            }}
            trackingUrl={webUrl ? `${webUrl.replace(/\/$/, '')}/t/${t.code}` : undefined}
            orgName={orgName}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" className="btn btn-p" onClick={() => window.print()} style={{ minHeight: 48 }}>
          <Icon name="print" size={16} /> Print {tags.length > 1 ? `${tags.length} tags` : 'tag'}
        </button>
        <button type="button" className="btn btn-o" onClick={onDone} style={{ minHeight: 48 }}>
          Next passenger
        </button>
      </div>
    </div>
  );
}

/** What is on the vehicle right now, in the order it comes off. */
function Manifest({ aboard, total }: { aboard: LuggageTag[]; total: number }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <strong style={{ fontSize: '1.1rem' }}>On board</strong>
        <span className="sub">{aboard.length} of {total} tagged</span>
      </div>
      {aboard.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>Nothing aboard yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {aboard.map((t) => (
            <li
              key={t.id}
              style={{
                display: 'flex', justifyContent: 'space-between', gap: 12,
                padding: '10px 0', borderBottom: '1px solid var(--line)',
              }}
            >
              <span>
                <strong>{t.destinationLabel}</strong>
                {t.pieceCount > 1 && <span className="sub"> · {t.pieceNo} of {t.pieceCount}</span>}
                <br />
                <span className="sub">{t.passengerName}</span>
              </span>
              <span className="mono sub">{t.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
