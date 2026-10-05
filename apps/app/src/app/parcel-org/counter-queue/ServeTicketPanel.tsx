"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon } from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import {
  getCounterSettlementStatus,
  receiveWalkInParcel,
  resolveOrgLabel,
  settleCounterParcel,
  settleCounterParcelStk,
} from "../actions";
import type { CounterTicketRow } from "./actions";

/** Same interval/give-up shape apps/web/src/app/pay/PayClient.tsx
 *  already proved for STK push waits: long enough for someone to fumble
 *  their PIN once, short enough that a clerk isn't staring at a spinner
 *  for the rest of their shift. */
const POLL_INTERVAL_MS = 2500;
const POLL_GIVE_UP_MS = 5 * 60 * 1000;

type Step = "label" | "receive" | "settle" | "done";

/**
 * The counter's "serve this one" flow, opened the moment a clerk claims
 * a waiting ticket: confirm the pre-printed label they're sticking on
 * the box, take the parcel into custody, then collect payment — cash
 * recorded on the spot, or an M-Pesa prompt the panel watches until
 * Safaricom actually confirms it.
 *
 * Bridges what were three separate, disconnected places before this:
 * claiming a ticket (this page) dead-ended in a JSON dump; label
 * resolve/attach only existed inside the booking form; and cash
 * settlement only existed on a different page (/parcel-org/scan).
 */
export function ServeTicketPanel({
  ticket,
  onDone,
}: {
  ticket: CounterTicketRow;
  onDone: () => void;
}) {
  const announce = useAnnounce();
  const [step, setStep] = useState<Step>("label");
  const labelInputId = useId();
  const referenceInputId = useId();

  // ── Label ──
  const [labelCode, setLabelCode] = useState("");
  const [labelConfirmed, setLabelConfirmed] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelPending, startLabelTransition] = useTransition();

  // ── Receive ──
  const [reference, setReference] = useState(ticket.serviceTicketNumber);
  const [parcelCode, setParcelCode] = useState<string | null>(null);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [receivePending, startReceiveTransition] = useTransition();

  // ── Settle ──
  const [method, setMethod] = useState<"CASH" | "MPESA">("CASH");
  const [amount, setAmount] = useState("");
  const [msisdn, setMsisdn] = useState(ticket.msisdn);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settlePending, startSettleTransition] = useTransition();
  const [mpesaPhase, setMpesaPhase] = useState<"idle" | "waiting" | "unresolved">("idle");
  const [mpesaReceipt, setMpesaReceipt] = useState<string | null>(null);
  const waitingSince = useRef<number | null>(null);

  function checkLabel() {
    const code = labelCode.trim();
    if (!code) {
      setLabelError("Scan or type the label's code");
      return;
    }
    setLabelError(null);
    startLabelTransition(async () => {
      const res = await resolveOrgLabel(code);
      if (!res.ok) {
        setLabelError(res.error);
        return;
      }
      setLabelConfirmed(res.label.code ?? code);
      announce(`Label ${code} confirmed`, "polite");
    });
  }

  function receive() {
    const ref = reference.trim() || ticket.serviceTicketNumber;
    setReceiveError(null);
    startReceiveTransition(async () => {
      const res = await receiveWalkInParcel(ref);
      if (!res.ok) {
        setReceiveError(res.error);
        return;
      }
      setParcelCode(res.code);
      announce(`Parcel ${res.code} received`, "polite");
      setStep("settle");
    });
  }

  function settle() {
    if (!parcelCode) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setSettleError("Enter what the client is paying");
      return;
    }
    setSettleError(null);

    if (method === "CASH") {
      startSettleTransition(async () => {
        const res = await settleCounterParcel(parcelCode, amt);
        if (!res.ok) {
          setSettleError(res.error);
          return;
        }
        announce(`Payment of ${amt} shillings recorded for ${parcelCode}`, "assertive");
        setStep("done");
      });
      return;
    }

    const phone = msisdn.trim();
    if (!phone) {
      setSettleError("Enter the phone number to charge");
      return;
    }
    startSettleTransition(async () => {
      const res = await settleCounterParcelStk(parcelCode, amt, phone);
      if (!res.ok) {
        setSettleError(res.error);
        return;
      }
      if (res.status === "SETTLED") {
        announce(`M-Pesa payment confirmed for ${parcelCode}`, "assertive");
        setStep("done");
        return;
      }
      waitingSince.current = Date.now();
      setMpesaPhase("waiting");
    });
  }

  // Poll while an STK push is in flight. Stops on a terminal status and
  // gives up after five minutes rather than claim it "failed" — the
  // payment may still land, and telling a clerk it failed invites
  // charging the client twice.
  useEffect(() => {
    if (mpesaPhase !== "waiting" || !parcelCode) return;
    let cancelled = false;

    async function poll() {
      const res = await getCounterSettlementStatus(parcelCode!);
      if (cancelled) return;
      if (res.ok && res.status.status === "SETTLED") {
        setMpesaReceipt(res.status.mpesaReceiptCode);
        setMpesaPhase("idle");
        announce(`M-Pesa payment confirmed for ${parcelCode}`, "assertive");
        setStep("done");
        return;
      }
      const waited = Date.now() - (waitingSince.current ?? Date.now());
      if (waited < POLL_GIVE_UP_MS) {
        setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } else {
        setMpesaPhase("unresolved");
      }
    }
    const timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mpesaPhase, parcelCode, announce]);

  return (
    <div className="chain ok" style={{ marginBottom: 12, flexDirection: "column", alignItems: "stretch", gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Icon name="check-circle" size={16} /> Now serving{" "}
          <strong className="mono">{ticket.serviceTicketNumber}</strong> — {ticket.msisdn}
        </span>
        {step !== "done" && (
          <button className="btn btn-o btn-sm" onClick={onDone}>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {ticket.draftDetails ? (
        <details>
          <summary className="sub" style={{ fontSize: ".8rem", cursor: "pointer" }}>
            Details the client left while waiting
          </summary>
          <pre className="sub" style={{
            margin: "6px 0 0", padding: 10, background: "var(--paper, #f7f7f5)",
            borderRadius: 8, fontSize: ".78rem", overflowX: "auto",
          }}>
            {JSON.stringify(ticket.draftDetails, null, 2)}
          </pre>
        </details>
      ) : null}

      {step === "label" && (
        <div style={{ display: "grid", gap: 8 }}>
          <label
            className="sub"
            htmlFor={labelInputId}
            style={{ fontSize: ".8rem", fontWeight: 600 }}
          >
            1. Attach a label — scan or type one of your own pre-printed codes
          </label>
          <div className="row" style={{ gap: 8 }}>
            <input
              id={labelInputId}
              className="mono"
              style={{ flex: 1, padding: "6px 8px", border: "1.5px solid var(--line)", borderRadius: 6 }}
              value={labelCode}
              onChange={(e) => {
                setLabelCode(e.target.value);
                setLabelConfirmed(null);
              }}
              placeholder="Label code"
            />
            <button className="btn btn-o btn-sm" disabled={labelPending} onClick={checkLabel}>
              {labelPending ? "Checking…" : "Check"}
            </button>
          </div>
          {labelError && (
            <p className="sub" style={{ color: "var(--red, #b42318)", margin: 0, fontSize: ".82rem" }}>{labelError}</p>
          )}
          {labelConfirmed && (
            <p className="sub" style={{ color: "var(--green, #1a7f37)", margin: 0, fontSize: ".82rem" }}>
              <Icon name="check" size={13} /> Label {labelConfirmed} confirmed — it'll print on this parcel.
            </p>
          )}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-o btn-sm" onClick={() => setStep("receive")}>
              Skip (no label yet)
            </button>
            <button
              className="btn btn-p btn-sm"
              disabled={!labelConfirmed}
              onClick={() => setStep("receive")}
            >
              Next: receive
            </button>
          </div>
        </div>
      )}

      {step === "receive" && (
        <div style={{ display: "grid", gap: 8 }}>
          <label
            className="sub"
            htmlFor={referenceInputId}
            style={{ fontSize: ".8rem", fontWeight: 600 }}
          >
            2. Take the parcel into custody
          </label>
          <input
            id={referenceInputId}
            className="mono"
            style={{ padding: "6px 8px", border: "1.5px solid var(--line)", borderRadius: 6 }}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Ticket number or tracking code"
          />
          {receiveError && (
            <p className="sub" style={{ color: "var(--red, #b42318)", margin: 0, fontSize: ".82rem" }}>{receiveError}</p>
          )}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-o btn-sm" onClick={() => setStep("label")}>
              Back
            </button>
            <button className="btn btn-p btn-sm" disabled={receivePending} onClick={receive}>
              {receivePending ? "Receiving…" : "Confirm receipt"}
            </button>
          </div>
        </div>
      )}

      {step === "settle" && parcelCode && (
        <div style={{ display: "grid", gap: 8 }}>
          <span className="sub" style={{ fontSize: ".8rem", fontWeight: 600 }}>
            3. Collect payment for <span className="mono">{parcelCode}</span>
          </span>
          <div className="row" style={{ gap: 12 }}>
            <label className="sub" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".85rem" }}>
              <input
                type="radio"
                checked={method === "CASH"}
                onChange={() => setMethod("CASH")}
                disabled={mpesaPhase === "waiting"}
              />
              Cash
            </label>
            <label className="sub" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".85rem" }}>
              <input
                type="radio"
                checked={method === "MPESA"}
                onChange={() => setMethod("MPESA")}
                disabled={mpesaPhase === "waiting"}
              />
              M-Pesa
            </label>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="mono"
              style={{ flex: 1, padding: "6px 8px", border: "1.5px solid var(--line)", borderRadius: 6 }}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (KES)"
              disabled={mpesaPhase === "waiting"}
            />
            {method === "MPESA" && (
              <input
                className="mono"
                style={{ flex: 1, padding: "6px 8px", border: "1.5px solid var(--line)", borderRadius: 6 }}
                value={msisdn}
                onChange={(e) => setMsisdn(e.target.value)}
                placeholder="M-Pesa phone number"
                disabled={mpesaPhase === "waiting"}
              />
            )}
          </div>
          {settleError && (
            <p className="sub" style={{ color: "var(--red, #b42318)", margin: 0, fontSize: ".82rem" }}>{settleError}</p>
          )}
          {mpesaPhase === "waiting" && (
            <p className="sub" style={{ margin: 0, fontSize: ".85rem" }}>
              <Icon name="info" size={14} /> Waiting for the client to approve the M-Pesa prompt on their phone…
            </p>
          )}
          {mpesaPhase === "unresolved" && (
            <p className="sub" style={{ color: "var(--amber, #9a6700)", margin: 0, fontSize: ".85rem" }}>
              Still no word from Safaricom. Check the client's M-Pesa messages before trying again —
              don't push a second prompt if the first one might still land.
            </p>
          )}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button
              className="btn btn-p btn-sm"
              disabled={settlePending || mpesaPhase === "waiting"}
              onClick={settle}
            >
              {settlePending ? "Recording…" : method === "CASH" ? "Record payment" : "Send M-Pesa prompt"}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div style={{ display: "grid", gap: 8 }}>
          <p className="sub" style={{ margin: 0, fontSize: ".9rem" }}>
            <Icon name="check-circle" size={16} /> Settled{parcelCode ? ` — ${parcelCode}` : ""}
            {mpesaReceipt ? ` (M-Pesa receipt ${mpesaReceipt})` : ""}.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-p btn-sm" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
