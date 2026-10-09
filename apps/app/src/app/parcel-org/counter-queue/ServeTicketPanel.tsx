"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon } from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import {
  receiveWalkInParcel,
  resolveOrgLabel,
  searchOrgLabels,
  settleCounterParcel,
  settleCounterParcelStk,
} from "../actions";
import type { OrgLabelSearchRow } from "@/lib/parcel-org-session";
import { LabelPicker } from "../LabelPicker";
import { MpesaPromptWatch } from "../MpesaPromptWatch";
import {
  bookCounterTicket,
  cancelCounterTicket,
  releaseCounterTicket,
  type CounterTicketRow,
} from "./actions";

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


type Step = "confirm" | "label" | "receive" | "settle" | "done";

/** Where a resumed case picks up — derived from what the server knows
 *  about the ticket, never from where this component's state happened
 *  to be before the refresh:
 *
 *  - no parcel yet → back at "1. Confirm", draft prefilled, exactly as
 *    a fresh claim would open;
 *  - parcel booked but not received → "3. Receive", with the real
 *    tracking code already in the reference field;
 *  - parcel received (or further along) → "4. Settle"; if an M-Pesa
 *    push for it is still in flight the panel resumes watching it.
 *
 *  "done" is deliberately unreachable here: a settled ticket leaves
 *  the board's in-service list entirely and belongs to the register. */
function startStepFor(ticket: CounterTicketRow): Step {
  if (!ticket.parcelCode) return "confirm";
  if (ticket.parcelStatus === "BOOKED") return "receive";
  return "settle";
}

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
 *
 * Resumable: every step's entry state is derived from the ticket row
 * itself (see startStepFor), so a page refresh mid-service — the event
 * that used to close this panel and lose the case from every screen —
 * reopens it at the same step with the same codes, including an
 * in-flight M-Pesa prompt it keeps polling.
 */
export function ServeTicketPanel({
  ticket,
  onDismiss,
  onDone,
  onReleased,
}: {
  ticket: CounterTicketRow;
  /** The panel's ✕ — dismiss without finishing; the case stays in
   *  service and the board won't auto-reopen it on the next refresh. */
  onDismiss: () => void;
  /** Terminal close — discarded or settled; the case is no longer
   *  in service. */
  onDone: () => void;
  /** Hand-back succeeded — the case is WAITING again. */
  onReleased: (ticket: CounterTicketRow) => void;
}) {
  const announce = useAnnounce();
  const [step, setStep] = useState<Step>(() => startStepFor(ticket));
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

  // ── Receive ── reference starts as the real tracking code when this
  // panel resumed a case whose booking already happened (a ticket's own
  // TCK-… number was never a parcel ScanHandoff could find — see
  // bookAndContinue), empty when the booking is still ahead of us.
  const [reference, setReference] = useState(ticket.parcelCode ?? "");
  const [parcelCode, setParcelCode] = useState<string | null>(ticket.parcelCode ?? null);
  // Set the moment this panel's own booking succeeds. Guards that must
  // hold past a real parcel (don't re-book, don't offer discard or
  // hand-back) read this rather than ticket.parcelCode: the row the
  // parent handed in was fetched before the booking and doesn't learn
  // about it, so the prop would still claim there's no parcel.
  const [booked, setBooked] = useState<string | null>(ticket.parcelCode ?? null);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [receivePending, startReceiveTransition] = useTransition();

  // ── Settle ── prefilled from the parcel's own price when a resumed
  // case already carries one (SettleCounterParcelStk writes priceKes
  // before the prompt goes out, so a refresh mid-M-Pesa comes back
  // showing the amount actually being chased).
  const [method, setMethod] = useState<"CASH" | "MPESA">(ticket.paymentPending ? "MPESA" : "CASH");
  const [amount, setAmount] = useState(ticket.parcelPriceKes ? String(ticket.parcelPriceKes) : "");
  const [msisdn, setMsisdn] = useState(ticket.msisdn);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settlePending, startSettleTransition] = useTransition();
  // A payment already in flight when the panel (re)opened: start
  // watching it (MpesaPromptWatch) rather than inviting a second prompt.
  const [mpesaPhase, setMpesaPhase] = useState<"idle" | "waiting">(
    ticket.paymentPending ? "waiting" : "idle",
  );
  const [mpesaReceipt, setMpesaReceipt] = useState<string | null>(null);

  // ── Hand back to the queue ── the case was claimed by mistake, or
  //    the sender needs somebody else. Pre-booking only; the server
  //    refuses anything past a real parcel (see dbx.ReleaseCounterTicket).
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releasePending, startReleaseTransition] = useTransition();

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
      // A resumed case may travel back to this step from "receive" —
      // its parcel already exists, so re-booking would only earn an
      // ALREADY_BOOKED error. Advance instead.
      if (booked) {
        setStep("receive");
        return;
      }
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
      setBooked(res.code);
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

  /** Hand the case back to the queue instead of keeping it CLAIMED —
   *  the server clears the claim and the board puts the row straight
   *  back into "Waiting". */
  function handBackToQueue() {
    setReleaseError(null);
    startReleaseTransition(async () => {
      const res = await releaseCounterTicket(ticket.id);
      if (!res.ok) {
        setReleaseError(res.error);
        return;
      }
      announce(`Ticket ${ticket.serviceTicketNumber} handed back to the queue`, "polite");
      onReleased(res.ticket);
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
      setMpesaPhase("waiting");
    });
  }


  return (
    <div className="chain ok" style={{ marginBottom: 12, flexDirection: "column", alignItems: "stretch", gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <Icon name="check-circle" size={16} /> Now serving{" "}
          <strong className="mono">{ticket.serviceTicketNumber}</strong> — {ticket.msisdn}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {(step === "confirm" || step === "label") && !booked && ticket.mine && (
            <button
              className="btn btn-o btn-sm"
              disabled={releasePending}
              onClick={handBackToQueue}
              title="Put this case back in the queue for anyone to pick up"
            >
              {releasePending ? "Handing back…" : "Hand back to queue"}
            </button>
          )}
          {(step === "confirm" || step === "label") && !booked && (
            <button className="btn btn-o btn-sm" onClick={() => setDiscardOpen((v) => !v)}>
              Discard ticket
            </button>
          )}
          {step !== "done" && (
            <button
              className="btn btn-o btn-sm"
              onClick={onDismiss}
              title="Close — the case stays in service and comes back on refresh"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      {releaseError && (
        <p className="sub" style={{ color: "var(--red, #b42318)", margin: 0, fontSize: ".82rem" }}>{releaseError}</p>
      )}

      {discardOpen && !booked && (step === "confirm" || step === "label") && (
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
          {mpesaPhase === "waiting" && parcelCode && (
            <MpesaPromptWatch
              code={parcelCode}
              onSettled={(receipt) => {
                setMpesaReceipt(receipt);
                setMpesaPhase("idle");
                announce(`M-Pesa payment confirmed for ${parcelCode}`, "assertive");
                setStep("done");
              }}
              onReleased={(message) => {
                setMpesaPhase("idle");
                setSettleError(message);
                announce(`M-Pesa prompt for ${parcelCode} is no longer active`, "assertive");
              }}
            />
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
