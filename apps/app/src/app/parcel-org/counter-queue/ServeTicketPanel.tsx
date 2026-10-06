"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon } from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import {
  confirmCounterSettlementManualCode,
  getCounterSettlementStatus,
  receiveWalkInParcel,
  resolveOrgLabel,
  searchOrgLabels,
  settleCounterParcel,
  settleCounterParcelStk,
} from "../actions";
import type { OrgLabelSearchRow } from "@/lib/parcel-org-session";
import { LabelPicker } from "../LabelPicker";
import { bookCounterTicket, cancelCounterTicket, type CounterTicketRow } from "./actions";

/** What a sender filled in while waiting — see AtOfficeSendForm's
 *  OfficeDraft, the shape autosaved into ticket.draftDetails. Read back
 *  here as an editable confirmation step rather than the read-only JSON
 *  dump this panel used to show. */
interface DraftDetails {
  senderFirstName?: string; senderLastName?: string; senderPhone?: string;
  receiverFirstName?: string; receiverLastName?: string; receiverPhone?: string;
  parcelType?: string; weightKg?: string;
  destinationLabel?: string;
  declaredContents?: string;
}

function fullName(first?: string, last?: string): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

/** Same interval/give-up shape apps/web/src/app/pay/PayClient.tsx
 *  already proved for STK push waits: long enough for someone to fumble
 *  their PIN once, short enough that a clerk isn't staring at a spinner
 *  for the rest of their shift. */
const POLL_INTERVAL_MS = 2500;
const POLL_GIVE_UP_MS = 5 * 60 * 1000;

type Step = "confirm" | "label" | "receive" | "settle" | "done";

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
  const [step, setStep] = useState<Step>("confirm");
  const referenceInputId = useId();

  // ── Confirm (editable, prefilled from what the sender entered) ──
  const draft = (ticket.draftDetails ?? null) as DraftDetails | null;
  const [senderName, setSenderName] = useState(fullName(draft?.senderFirstName, draft?.senderLastName));
  const [senderMsisdn, setSenderMsisdn] = useState(draft?.senderPhone ?? ticket.msisdn);
  const [receiverName, setReceiverName] = useState(fullName(draft?.receiverFirstName, draft?.receiverLastName));
  const [receiverMsisdn, setReceiverMsisdn] = useState(draft?.receiverPhone ?? "");
  const [itemType, setItemType] = useState(draft?.parcelType ?? "");
  const [weightKg, setWeightKg] = useState(draft?.weightKg ?? "");
  const [destination, setDestination] = useState(draft?.destinationLabel ?? "");
  const [itemDescription, setItemDescription] = useState(draft?.declaredContents ?? "");

  // ── Label (live tail-search over the company's own unused stock —
  //    same searchOrgLabels CustomParcelPanel's picker uses) ──
  const [labelTail, setLabelTail] = useState("");
  const [labelResults, setLabelResults] = useState<OrgLabelSearchRow[] | null>(null);
  const [labelSearching, setLabelSearching] = useState(false);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const labelSeq = useRef(0);
  const [labelConfirmed, setLabelConfirmed] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelPending, startLabelTransition] = useTransition();
  const [bookPending, startBookTransition] = useTransition();
  const [bookError, setBookError] = useState<string | null>(null);

  // ── Discard — the sender walked away before a parcel ever existed.
  //    Only reachable from "confirm"/"label": once bookAndContinue has
  //    run, there's a real Parcel and this ticket isn't the thing to
  //    cancel any more (see dbx.CancelCounterTicket). ──
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [discardPending, startDiscardTransition] = useTransition();

  useEffect(() => {
    const tail = labelTail.trim();
    if (!labelPickerOpen || tail.length === 0) {
      setLabelResults(labelPickerOpen ? [] : null);
      setLabelSearching(false);
      return;
    }
    setLabelSearching(true);
    const seq = ++labelSeq.current;
    const id = window.setTimeout(() => {
      void searchOrgLabels(tail).then((rows) => {
        if (labelSeq.current !== seq) return;
        setLabelResults(rows);
        setLabelSearching(false);
      }).catch(() => {
        if (labelSeq.current !== seq) return;
        setLabelResults([]);
        setLabelSearching(false);
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [labelTail, labelPickerOpen]);

  // ── Receive ── reference starts empty; set to the real tracking code
  // once bookAndContinue mints one — a ticket's own TCK-… number was
  // never a parcel ScanHandoff could find (see bookAndContinue).
  const [reference, setReference] = useState("");
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
  const [manualCode, setManualCode] = useState("");
  const [manualCodeError, setManualCodeError] = useState<string | null>(null);
  const [manualCodePending, startManualCodeTransition] = useTransition();

  function pickLabel(code: string) {
    setLabelError(null);
    startLabelTransition(async () => {
      const res = await resolveOrgLabel(code);
      if (!res.ok) {
        setLabelError(res.error);
        return;
      }
      if (res.label.state === "spent") {
        setLabelError(`${code} has already been used on another parcel.`);
        return;
      }
      if (res.label.state === "voided") {
        setLabelError(`${code} has been withdrawn and can't be used.`);
        return;
      }
      setLabelConfirmed(res.label.code ?? code);
      setLabelTail(""); setLabelResults(null); setLabelPickerOpen(false);
      announce(`Label ${code} confirmed`, "polite");
    });
  }

  /** The step a claimed ticket was always missing: nothing before this
   *  ever created an actual parcel, so the ticket's own TCK-… number
   *  never resolved to anything "receive" could find (see
   *  dbx.BookParcelFromCounterTicket). Books one now, from this step's
   *  (possibly edited) confirm-step values plus whichever label was
   *  just picked — spent directly as the parcel's own tracking code,
   *  rather than written onto the label separately — and hands the
   *  real code to "receive". */
  function bookAndContinue() {
    setBookError(null);
    startBookTransition(async () => {
      const res = await bookCounterTicket(ticket.id, {
        senderName, senderMsisdn, receiverName, receiverMsisdn,
        parcelType: itemType, weightKg: weightKg ? Number(weightKg) : undefined,
        destinationLabel: destination,
        senderDeclaredContents: itemDescription,
        labelCode: labelConfirmed ?? undefined,
      });
      if (!res.ok) {
        setBookError(res.error);
        return;
      }
      setReference(res.code);
      setStep("receive");
    });
  }

  function discardTicket() {
    setDiscardError(null);
    startDiscardTransition(async () => {
      const res = await cancelCounterTicket(ticket.id, discardReason);
      if (!res.ok) {
        setDiscardError(res.error);
        return;
      }
      announce(`Ticket ${ticket.serviceTicketNumber} discarded`, "polite");
      onDone();
    });
  }

  function receive() {
    const ref = reference.trim();
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

  /** The code-entry fallback once a push has gone unresolved too long —
   *  see dbx.ConfirmCounterSettlementByManualCode's own comment on why
   *  this is trusted rather than re-verified against Safaricom. */
  function submitManualCode() {
    if (!parcelCode) return;
    const value = manualCode.trim();
    if (!value) {
      setManualCodeError("Enter the M-Pesa code from the client's confirmation message");
      return;
    }
    setManualCodeError(null);
    startManualCodeTransition(async () => {
      const res = await confirmCounterSettlementManualCode(parcelCode, value);
      if (!res.ok) {
        setManualCodeError(res.error);
        return;
      }
      setMpesaReceipt(value);
      setMpesaPhase("idle");
      announce(`M-Pesa payment confirmed for ${parcelCode}`, "assertive");
      setStep("done");
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
        <div className="row" style={{ gap: 6 }}>
          {(step === "confirm" || step === "label") && (
            <button className="btn btn-o btn-sm" onClick={() => setDiscardOpen((v) => !v)}>
              Discard ticket
            </button>
          )}
          {step !== "done" && (
            <button className="btn btn-o btn-sm" onClick={onDone}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      {discardOpen && (step === "confirm" || step === "label") && (
        <div className="chain" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, padding: 10, border: "1.5px solid var(--red, #b42318)", borderRadius: 8 }}>
          <span className="sub" style={{ fontSize: ".82rem", fontWeight: 600 }}>
            Discard this ticket — the sender walked away before anything was booked.
          </span>
          <input
            className="mono"
            style={{ padding: "6px 8px", border: "1.5px solid var(--line)", borderRadius: 6 }}
            value={discardReason}
            onChange={(e) => setDiscardReason(e.target.value)}
            placeholder="Why? (optional)"
          />
          {discardError && (
            <p className="sub" style={{ color: "var(--red, #b42318)", margin: 0, fontSize: ".82rem" }}>{discardError}</p>
          )}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-o btn-sm" onClick={() => setDiscardOpen(false)} disabled={discardPending}>
              Never mind
            </button>
            <button className="btn btn-p btn-sm" onClick={discardTicket} disabled={discardPending}>
              {discardPending ? "Discarding…" : "Yes, discard it"}
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div style={{ display: "grid", gap: 8 }}>
          <span className="sub" style={{ fontSize: ".8rem", fontWeight: 600 }}>
            1. Confirm what the sender entered — fix anything that's wrong
          </span>
          <div className="pgrid">
            <label className="pfield"><span>Sender name</span>
              <input value={senderName} onChange={(e) => setSenderName(e.target.value)} />
            </label>
            <label className="pfield"><span>Sender phone</span>
              <input value={senderMsisdn} onChange={(e) => setSenderMsisdn(e.target.value)} />
            </label>
            <label className="pfield"><span>Receiver name</span>
              <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
            </label>
            <label className="pfield"><span>Receiver phone</span>
              <input value={receiverMsisdn} onChange={(e) => setReceiverMsisdn(e.target.value)} />
            </label>
            <label className="pfield"><span>Item type</span>
              <input value={itemType} onChange={(e) => setItemType(e.target.value)} />
            </label>
            <label className="pfield"><span>Weight (kg)</span>
              <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
            </label>
            <label className="pfield"><span>Going to</span>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} />
            </label>
            <label className="pfield"><span>What's inside</span>
              <input value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
            </label>
          </div>
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-p btn-sm" onClick={() => setStep("label")}>
              Next: attach label
            </button>
          </div>
        </div>
      )}

      {step === "label" && (
        <div style={{ display: "grid", gap: 8 }}>
          <span className="sub" style={{ fontSize: ".8rem", fontWeight: 600 }}>
            2. Attach a label
          </span>
          <LabelPicker
            title="Parcel label"
            hint="Type any characters from one of your own pre-printed codes, or scan it."
            tail={labelTail}
            onTail={(v) => { setLabelTail(v.toUpperCase()); setLabelPickerOpen(true); setLabelError(null); }}
            onFocus={() => setLabelPickerOpen(true)}
            results={labelResults}
            searching={labelSearching}
            pickerOpen={labelPickerOpen}
            selected={labelConfirmed ?? ""}
            onSelect={pickLabel}
            onScan={pickLabel}
            checking={labelPending}
            checkError={labelError}
            onClear={() => { setLabelConfirmed(null); setLabelTail(""); setLabelResults(null); setLabelError(null); }}
            onClose={() => setLabelPickerOpen(false)}
          />
          {bookError && (
            <p className="sub" style={{ color: "var(--red, #b42318)", margin: 0, fontSize: ".82rem" }}>{bookError}</p>
          )}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-o btn-sm" disabled={bookPending} onClick={bookAndContinue}>
              {bookPending && !labelConfirmed ? "Booking…" : "Skip (no label yet)"}
            </button>
            <button
              className="btn btn-p btn-sm"
              disabled={!labelConfirmed || bookPending}
              onClick={bookAndContinue}
            >
              {bookPending && labelConfirmed ? "Booking…" : "Next: receive"}
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
            3. Take the parcel into custody
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
            4. Collect payment for <span className="mono">{parcelCode}</span>
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
            <div style={{ display: "grid", gap: 6 }}>
              <p className="sub" style={{ color: "var(--amber, #9a6700)", margin: 0, fontSize: ".85rem" }}>
                Still no word from Safaricom. If the client already got the "money sent" message on
                their phone, enter the M-Pesa code from it below instead of pushing a second prompt.
              </p>
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="mono"
                  style={{ flex: 1, padding: "6px 8px", border: "1.5px solid var(--line)", borderRadius: 6 }}
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  placeholder="M-Pesa code, e.g. QFL7XYZ123"
                />
                <button className="btn btn-o btn-sm" disabled={manualCodePending} onClick={submitManualCode}>
                  {manualCodePending ? "Checking…" : "Use this code"}
                </button>
              </div>
              {manualCodeError && (
                <p className="sub" style={{ color: "var(--red, #b42318)", margin: 0, fontSize: ".82rem" }}>{manualCodeError}</p>
              )}
            </div>
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
