"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@esoqo/ui";
import {
  cancelCounterSettlementStk,
  confirmCounterSettlementManualCode,
  getCounterSettlementStatus,
  type CounterSettlementStatus,
} from "./actions";

/** Fast while the payer is likely still holding their phone, slower
 *  after — the server's reconcile sweep keeps checking regardless. */
const FAST_POLL_MS = 3000;
const SLOW_POLL_MS = 10000;
const SLOW_AFTER_MS = 3 * 60 * 1000;

/**
 * Everything a clerk needs while an M-Pesa counter prompt is out, shared
 * by the scanner and the counter queue so the two never drift:
 *
 *  - the live state (sent how long ago, the provider's own word on it),
 *    polled automatically — each poll also makes core-go ask Co-op;
 *  - "Check payment now", for when the payer says "done" before the
 *    next poll;
 *  - "Cancel prompt", once the prompt can no longer be approved (core-go
 *    owns that window and refuses earlier), so the clerk can re-prompt
 *    or take cash instead of being stuck on "in progress";
 *  - the M-Pesa code fallback, for a payment that went through but was
 *    never confirmed back to us.
 *
 * Never reports a timeout as "failed": the payment may still land, and a
 * clerk told it failed will charge the client twice.
 */
export function MpesaPromptWatch({
  code, onSettled, onReleased,
}: {
  code: string;
  onSettled: (receipt: string | null) => void;
  /** The prompt is gone (declined, expired or cancelled) — offer a new one. */
  onReleased: (message: string) => void;
}) {
  const [status, setStatus] = useState<CounterSettlementStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [cancelling, startCancel] = useTransition();
  const [manualCode, setManualCode] = useState("");
  const [manualPending, startManual] = useTransition();
  const [showManual, setShowManual] = useState(false);
  // Null until mounted so server and client render the same markup.
  const [now, setNow] = useState<number | null>(null);
  const mountedAt = useRef<number | null>(null);
  const callbacks = useRef({ onSettled, onReleased });
  callbacks.current = { onSettled, onReleased };
  const done = useRef(false);
  // Absolute time the server allows cancelling, so the countdown ticks
  // locally between polls.
  const [cancelAt, setCancelAt] = useState<number | null>(null);

  const apply = useCallback((s: CounterSettlementStatus, cancelled = false) => {
    if (done.current) return;
    setStatus(s);
    if (s.cancelableInSeconds !== undefined) setCancelAt(Date.now() + s.cancelableInSeconds * 1000);
    if (s.status === "SETTLED") {
      done.current = true;
      callbacks.current.onSettled(s.mpesaReceiptCode);
    } else if (s.status === "NOT_STARTED") {
      done.current = true;
      callbacks.current.onReleased(cancelled
        ? "Prompt cancelled. Send a new one, or take cash."
        : "The payer declined, cancelled or let the M-Pesa prompt expire. Send it again, or take cash.");
    }
  }, []);

  const check = useCallback(async (force = false) => {
    try {
      const res = await getCounterSettlementStatus(code, force);
      if (res.ok) {
        setError(null);
        apply(res.status);
      } else {
        setError(res.error);
      }
    } catch (e) {
      // Don't crash polling loop on transient network drop
    }
  }, [code, apply]);

  useEffect(() => {
    mountedAt.current = Date.now();
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await check(false);
      if (cancelled || done.current) return;
      const age = Date.now() - (mountedAt.current ?? Date.now());
      timer = setTimeout(() => void loop(), age > SLOW_AFTER_MS ? SLOW_POLL_MS : FAST_POLL_MS);
    };
    void loop();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [check]);

  const sentAt = status?.requestedAt ? new Date(status.requestedAt).getTime() : mountedAt.current;
  const elapsed = now && sentAt ? Math.max(0, Math.floor((now - sentAt) / 1000)) : null;
  const cancelIn = cancelAt === null || now === null ? null : Math.max(0, Math.ceil((cancelAt - now) / 1000));
  const canCancel = cancelIn === 0;

  return (
    <div style={{ display: "grid", gap: 8 }} aria-live="polite">
      <p className="sub" style={{ margin: 0, fontSize: ".88rem" }}>
        <Icon name="info" size={14} /> Waiting for the payer to approve the M-Pesa prompt on their phone
        {elapsed !== null ? ` — sent ${fmtElapsed(elapsed)} ago` : ""}.
        {status?.providerStatus ? <span className="mono" style={{ marginLeft: 6 }}>({status.providerStatus})</span> : null}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          type="button" className="btn btn-p btn-sm" disabled={checking || cancelling}
          onClick={() => startCheck(() => check(true))}
        >
          <Icon name="refresh" size={14} /> {checking ? "Checking…" : "Check payment now"}
        </button>
        <button
          type="button" className="btn btn-o btn-sm" disabled={!canCancel || cancelling || checking}
          title={canCancel ? "Free this prompt so you can send a new one or take cash" : "M-Pesa prompts stay live for about a minute"}
          onClick={() => startCancel(async () => {
            const res = await cancelCounterSettlementStk(code);
            if (res.ok) { setError(null); apply(res.status, true); } else { setError(res.error); }
          })}
        >
          {cancelling ? "Cancelling…" : canCancel || cancelIn === null ? "Cancel prompt" : `Cancel prompt (in ${cancelIn}s)`}
        </button>
        <button
          type="button" className="btn btn-o btn-sm" disabled={cancelling || checking}
          onClick={() => setShowManual((v) => !v)}
        >
          Enter M-Pesa code
        </button>
      </div>
      {(showManual || canCancel) && (
        <div style={{ display: "grid", gap: 6 }}>
          <p className="sub" style={{ margin: 0, fontSize: ".82rem" }}>
            Payer already got the M-Pesa &ldquo;money sent&rdquo; SMS? Enter its code instead of prompting again.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="inp mono" style={{ flex: 1, minWidth: 0 }}
              value={manualCode} onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="M-Pesa code, e.g. QFL7XYZ123" aria-label="M-Pesa code from the payer's SMS"
            />
            <button
              type="button" className="btn btn-o btn-sm" disabled={!manualCode.trim() || manualPending}
              onClick={() => startManual(async () => {
                const res = await confirmCounterSettlementManualCode(code, manualCode);
                if (!res.ok) { setError(res.error); return; }
                done.current = true;
                callbacks.current.onSettled(manualCode.trim());
              })}
            >
              {manualPending ? "Saving…" : "Use this code"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${sec % 60}s`;
}
