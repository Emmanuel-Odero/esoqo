"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@esoqo/ui";
import {
  actionBookParcel,
  actionListOrgStations,
  type ParcelPricingView,
  type PublicOrgStationView,
  type WalkInStationView,
} from "../actions";
import { actionSaveCounterTicketDraft } from "../counter-ticket-actions";

/**
 * The one and only "send a parcel" form on the site — one question per
 * screen, gated: you cannot reach "what's inside" without first naming
 * the office, the sender and the receiver. A sender is standing at the
 * counter filling this in, often handing the phone back and forth with
 * the clerk, which is served far better by one question at a time than
 * a long page to scroll and re-find a place in.
 *
 * Every booking from here is SELF_DROPOFF, PAY_AT_COUNTER — the sender
 * is standing at the courier's own counter as they fill this in, so
 * there is no pickup to schedule and nothing to pay online.
 */

const PARCEL_TYPES = [
  ["ENVELOPE_DOCUMENT", "Envelope / Document"],
  ["SMALL", "Small parcel"],
  ["MEDIUM", "Medium parcel"],
  ["LARGE", "Large parcel"],
  ["HEAVY_OVERSIZE", "Heavy / Oversize"],
] as const;

const TERMS_VERSION = "2026-09-01";

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  fontSize: ".95rem",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: ".85rem",
};

type StepKey =
  | "office"
  | "sender"
  | "receiver"
  | "parcel"
  | "destination"
  | "declare"
  | "terms";

const ALL_STEPS: { key: StepKey; label: string }[] = [
  { key: "office", label: "Office" },
  { key: "sender", label: "You" },
  { key: "receiver", label: "Receiver" },
  { key: "parcel", label: "Item" },
  { key: "destination", label: "Going to" },
  { key: "declare", label: "Declare" },
  { key: "terms", label: "Confirm" },
];

interface PartyFields {
  firstName: string;
  lastName: string;
  phone: string;
  phone2: string;
  email: string;
}

/** The shape autosaved into a counter ticket's draftDetails while a
 *  walk-in waits (see counter-ticket-actions.actionSaveCounterTicketDraft)
 *  and read back both here, resuming the form, and by the clerk's own
 *  claim screen (CounterQueueClient, which just shows it as readable
 *  JSON — no parsed dependency on this shape elsewhere). */
interface OfficeDraft {
  senderFirstName: string; senderLastName: string; senderPhone: string; senderPhone2: string; senderEmail: string;
  receiverFirstName: string; receiverLastName: string; receiverPhone: string; receiverPhone2: string; receiverEmail: string;
  parcelType: string; weightKg: string; fragile: boolean;
  destinationId: string; destinationLabel: string;
  declaredContents: string; declaredValue: string;
}

export function AtOfficeSendForm({
  stations,
  pricing,
  ticketId,
  initialDraft,
  lockedStationId,
}: {
  stations: WalkInStationView[];
  pricing: ParcelPricingView[];
  /** Set when this form was opened from a counter ticket's "fill in
   *  details while you wait" link. In this mode the form never books
   *  anything itself — a clerk does that at the counter once the
   *  ticket is claimed — it only autosaves into the ticket's own
   *  draftDetails and hands the sender back to their ticket screen.
   *  The office step is skipped too: the ticket's own org IS the
   *  office the sender already checked in at. */
  ticketId?: string;
  initialDraft?: Record<string, unknown> | null;
  lockedStationId?: string;
}) {
  const router = useRouter();
  const draft = initialDraft as Partial<OfficeDraft> | null | undefined;

  const steps = useMemo(
    () => (ticketId ? ALL_STEPS.filter((s) => s.key !== "office") : ALL_STEPS),
    [ticketId],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex]!.key;

  // ── Which office the sender is standing in ──────────────────────────
  // Locked to the ticket's own org in ticket mode (the office step is
  // skipped entirely — see `steps` above); otherwise picked on the
  // "office" step below.
  const [officeId, setOfficeId] = useState(() => lockedStationId ?? "");
  const chosenStationId = ticketId ? (lockedStationId ?? "") : officeId;
  const chosenStation = useMemo(
    () => stations.find((s) => s.id === chosenStationId) ?? null,
    [stations, chosenStationId],
  );

  // ── Who ───────────────────────────────────────────────────────────────
  const [sender, setSender] = useState<PartyFields>({
    firstName: draft?.senderFirstName ?? "",
    lastName: draft?.senderLastName ?? "",
    phone: draft?.senderPhone ?? "",
    phone2: draft?.senderPhone2 ?? "",
    email: draft?.senderEmail ?? "",
  });
  const [receiver, setReceiver] = useState<PartyFields>({
    firstName: draft?.receiverFirstName ?? "",
    lastName: draft?.receiverLastName ?? "",
    phone: draft?.receiverPhone ?? "",
    phone2: draft?.receiverPhone2 ?? "",
    email: draft?.receiverEmail ?? "",
  });

  // ── What's being sent ────────────────────────────────────────────────
  const [parcelType, setParcelType] = useState<string>(draft?.parcelType || PARCEL_TYPES[0][0]);
  const [weightKg, setWeightKg] = useState(draft?.weightKg ?? "");
  const [fragile, setFragile] = useState(draft?.fragile ?? false);

  useEffect(() => {
    const w = Number(weightKg);
    if (!weightKg || Number.isNaN(w)) return;
    const match = pricing.find((p) => w >= p.minWeightKg && w <= p.maxWeightKg);
    if (match) setParcelType(match.parcelType);
  }, [weightKg, pricing]);

  // ── Where it's going — searched from THIS company's own branches ───
  const [destStations, setDestStations] = useState<PublicOrgStationView[]>([]);
  const [destLoading, setDestLoading] = useState(false);
  const [destQuery, setDestQuery] = useState("");
  const [destinationId, setDestinationId] = useState(draft?.destinationId ?? "");
  const destination = useMemo(
    () => destStations.find((s) => s.id === destinationId) ?? null,
    [destStations, destinationId],
  );
  useEffect(() => {
    if (!chosenStationId) return;
    setDestLoading(true);
    actionListOrgStations(chosenStationId)
      .then((list) => setDestStations(list.filter((s) => s.id !== chosenStationId)))
      .finally(() => setDestLoading(false));
  }, [chosenStationId]);
  const destMatches = useMemo(() => {
    const q = destQuery.trim().toLowerCase();
    if (!q) return destStations;
    return destStations.filter(
      (s) => s.name.toLowerCase().includes(q) || s.locationHint.toLowerCase().includes(q),
    );
  }, [destStations, destQuery]);

  // ── What's inside, and what it's worth ───────────────────────────────
  const [declaredContents, setDeclaredContents] = useState(draft?.declaredContents ?? "");
  const [declaredValue, setDeclaredValue] = useState(draft?.declaredValue ?? "");

  // ── The declaration ──────────────────────────────────────────────────
  const [lawfulAttested, setLawfulAttested] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Only the case number is ever shown here — see dbx.
  // ReduceParcelStatusForUnintaken's own comment: the real tracking code
  // and the receiver's delivery code both stay withheld, by SMS, until
  // the clerk has the physical box in hand and scans it in. Showing
  // either one on this screen would hand out a credential for a parcel
  // nobody has actually taken custody of yet.
  const [caseNumber, setCaseNumber] = useState<string | null>(null);

  function buildDraft(): OfficeDraft {
    return {
      senderFirstName: sender.firstName, senderLastName: sender.lastName,
      senderPhone: sender.phone, senderPhone2: sender.phone2, senderEmail: sender.email,
      receiverFirstName: receiver.firstName, receiverLastName: receiver.lastName,
      receiverPhone: receiver.phone, receiverPhone2: receiver.phone2, receiverEmail: receiver.email,
      parcelType, weightKg, fragile,
      destinationId,
      destinationLabel: destination ? `${destination.name} — ${destination.locationHint}` : "",
      declaredContents, declaredValue,
    };
  }

  // ── Autosave into the counter ticket, while one is waiting ──────────
  // Debounced: a save on every keystroke would be a request per
  // character. 900ms is long enough to not fire mid-word, short enough
  // that walking up to the counter mid-type still lands the last few
  // changes.
  const savingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ticketId) return;
    if (savingRef.current) clearTimeout(savingRef.current);
    savingRef.current = setTimeout(() => {
      void actionSaveCounterTicketDraft(ticketId, buildDraft());
    }, 900);
    return () => {
      if (savingRef.current) clearTimeout(savingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ticketId, sender, receiver, parcelType, weightKg, fragile,
    destinationId, destination, declaredContents, declaredValue,
  ]);

  function validStep(key: StepKey): string | null {
    switch (key) {
      case "office":
        return officeId ? null : "Choose which office you're standing in";
      case "sender":
        if (!sender.firstName.trim() || !sender.lastName.trim()) return "We need your first and last name";
        if (!sender.phone.trim()) return "We need your phone number";
        return null;
      case "receiver":
        if (!receiver.firstName.trim() || !receiver.lastName.trim()) return "We need the receiver's first and last name";
        if (!receiver.phone.trim()) return "We need the receiver's phone number";
        return null;
      case "parcel":
        return null;
      case "destination":
        return destinationId ? null : "Search for and pick where it's going";
      case "declare":
        if (!declaredContents.trim()) return "Say what is inside";
        if (!declaredValue.trim()) return "Roughly what is it worth?";
        return null;
      case "terms":
        if (!lawfulAttested) return "Please confirm the contents are legal to send";
        if (!termsAccepted) return "Please accept the terms to check in";
        return null;
    }
  }

  function goNext() {
    const err = validStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    if (stepIndex === steps.length - 1) {
      submit();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function goBack() {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  function submit() {
    // Reached from a counter ticket: nothing here books anything — a
    // clerk does that at the counter once they claim the ticket, using
    // exactly what was just validated (already autosaved as it was
    // typed; this is a final flush before leaving the page). Booking
    // it again here would create a second, competing parcel for the
    // same walk-in.
    if (ticketId) {
      start(async () => {
        await actionSaveCounterTicketDraft(ticketId, buildDraft());
        router.push(`/parcels/counter-ticket/${ticketId}`);
      });
      return;
    }

    start(async () => {
      const notesLines: string[] = [];
      if (sender.phone2.trim()) notesLines.push(`Sender alt phone: ${sender.phone2.trim()}`);
      if (sender.email.trim()) notesLines.push(`Sender email: ${sender.email.trim()}`);
      if (receiver.phone2.trim()) notesLines.push(`Receiver alt phone: ${receiver.phone2.trim()}`);
      if (receiver.email.trim()) notesLines.push(`Receiver email: ${receiver.email.trim()}`);

      const booked = await actionBookParcel({
        senderName: `${sender.firstName.trim()} ${sender.lastName.trim()}`.trim(),
        senderMsisdn: sender.phone.trim(),
        receiverName: `${receiver.firstName.trim()} ${receiver.lastName.trim()}`.trim(),
        receiverMsisdn: receiver.phone.trim(),
        originLabel: chosenStation ? `${chosenStation.name} — ${chosenStation.locationHint}` : "",
        destinationLabel: destination ? `${destination.name} — ${destination.locationHint}` : "",
        parcelType,
        weightKg: weightKg ? Number(weightKg) : undefined,
        fragile,
        notes: notesLines.join("\n") || undefined,
        destinationAgentId: destinationId || undefined,
        originMethod: "SELF_DROPOFF",
        parcelOrgId: chosenStationId,
        senderDeclaredContents: declaredContents.trim(),
        declaredValueKes: Number(declaredValue),
        lawfulContentsAttested: lawfulAttested,
        termsAccepted,
        termsVersion: TERMS_VERSION,
        payAtCounter: true,
      });
      if (!booked.ok) {
        setError(booked.error);
        return;
      }
      setCaseNumber(booked.serviceTicketNumber);
    });
  }

  // ── Terminal stage ──────────────────────────────────────────────────
  if (caseNumber) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <span className="icbox icbox-g" style={{ margin: "0 auto 14px" }}>
          <Icon name="check-circle" size={22} />
        </span>
        <h3 style={{ marginBottom: 6 }}>You&apos;re checked in</h3>
        <p className="sub" style={{ margin: "0 0 14px" }}>
          {`We've told ${chosenStation?.name ?? "the office"} to expect you.`}
        </p>
        <div
          style={{
            textAlign: "left",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <p className="sub" style={{ margin: "0 0 4px", fontSize: ".8rem" }}>
            Your case number
          </p>
          <p className="mono" style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, letterSpacing: ".04em" }}>
            {caseNumber}
          </p>
          <p className="sub" style={{ margin: "8px 0 0", fontSize: ".82rem" }}>
            Show this to the clerk at the counter — they&apos;ll call it out when it&apos;s your turn.
          </p>
        </div>
        <div style={{ textAlign: "left", border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
          <p className="sub" style={{ margin: 0, fontSize: ".85rem" }}>
            {`Nothing to pay online — settle the fee with the clerk when they call you forward. We'll text you your real tracking link, and ${receiver.firstName || "your receiver"} their delivery code, the moment the clerk confirms they have your parcel in hand.`}
          </p>
        </div>
      </div>
    );
  }

  // ── The wizard ────────────────────────────────────────────────────────
  return (
    <div className="card">
      <div className="pf-rail" role="status" aria-label="Form progress">
        {steps.map((s, i) => (
          <div key={s.key} className={i < stepIndex ? "pf-rail-step done" : "pf-rail-step"}>
            <span className="pf-rail-dot" aria-hidden />
            {s.label}
          </div>
        ))}
      </div>

      <p className="sub" style={{ margin: "0 0 4px", fontSize: ".72rem", letterSpacing: ".12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
        Step {stepIndex + 1} of {steps.length}
        {ticketId && chosenStation ? ` · Checking in at ${chosenStation.name}` : ""}
      </p>

      {step === "office" && (
        <>
          <h3 style={{ margin: "0 0 4px" }}>Which office are you at?</h3>
          <p className="sub" style={{ margin: "0 0 16px", fontSize: ".85rem" }}>
            Pick the courier company whose counter you&apos;re standing at right now.
          </p>
          <div style={{ display: "grid", gap: 8, maxHeight: 360, overflowY: "auto" }}>
            {stations.length === 0 && (
              <p className="sub" style={{ fontSize: ".85rem" }}>No companies are currently taking walk-ins.</p>
            )}
            {stations.map((s) => (
              <StationCard
                key={s.id}
                selected={officeId === s.id}
                title={s.name}
                subtitle={s.locationHint}
                hint={s.openingHours ? `Open ${s.openingHours}` : undefined}
                onClick={() => {
                  setOfficeId(s.id);
                  setDestinationId("");
                }}
              />
            ))}
          </div>
        </>
      )}

      {step === "sender" && (
        <>
          <h3 style={{ margin: "0 0 4px" }}>Your details</h3>
          <p className="sub" style={{ margin: "0 0 16px", fontSize: ".85rem" }}>
            So the clerk knows whose parcel this is.
          </p>
          <PartyFieldset value={sender} onChange={setSender} idPrefix="sd" />
        </>
      )}

      {step === "receiver" && (
        <>
          <h3 style={{ margin: "0 0 4px" }}>Receiver&apos;s details</h3>
          <p className="sub" style={{ margin: "0 0 16px", fontSize: ".85rem" }}>
            We text the receiver their delivery code and a tracking link.
          </p>
          <PartyFieldset value={receiver} onChange={setReceiver} idPrefix="rc" />
        </>
      )}

      {step === "parcel" && (
        <>
          <h3 style={{ margin: "0 0 4px" }}>What are you sending?</h3>
          <p className="sub" style={{ margin: "0 0 16px", fontSize: ".85rem" }}>
            A rough type and weight is enough — the clerk confirms it at the counter.
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle} htmlFor="ptype">Type</label>
            <select id="ptype" style={fieldStyle} value={parcelType} onChange={(e) => setParcelType(e.target.value)}>
              {PARCEL_TYPES.map(([id, label]) => {
                const band = pricing.find((p) => p.parcelType === id);
                return (
                  <option key={id} value={id}>
                    {label}{band ? ` — ${band.weightLabel}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle} htmlFor="weight">Weight in kg (optional)</label>
            <input
              id="weight"
              style={fieldStyle}
              value={weightKg}
              placeholder="e.g. 2.5"
              onChange={(e) => setWeightKg(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </div>
          <label className="sub" htmlFor="fragile" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input id="fragile" type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
            Fragile — handle with care
          </label>
        </>
      )}

      {step === "destination" && (
        <>
          <h3 style={{ margin: "0 0 4px" }}>Where is it going?</h3>
          <p className="sub" style={{ margin: "0 0 16px", fontSize: ".85rem" }}>
            Search {chosenStation?.name ?? "this company"}&apos;s own branches for where it&apos;s headed.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Icon name="search" size={16} />
            <input
              style={{ ...fieldStyle, flex: 1 }}
              value={destQuery}
              onChange={(e) => setDestQuery(e.target.value)}
              placeholder={destLoading ? "Loading branches…" : "Type a branch or town name…"}
              disabled={destLoading}
            />
          </div>
          <div style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {!destLoading && destMatches.length === 0 && (
              <p className="sub" style={{ fontSize: ".85rem" }}>
                No matching branch — try a different search, or ask the clerk which branch to pick.
              </p>
            )}
            {destMatches.map((s) => (
              <StationCard
                key={s.id}
                selected={destinationId === s.id}
                title={s.name}
                subtitle={s.locationHint}
                hint={s.openingHours ? `Open ${s.openingHours}` : undefined}
                onClick={() => setDestinationId(s.id)}
              />
            ))}
          </div>
        </>
      )}

      {step === "declare" && (
        <>
          <h3 style={{ margin: "0 0 4px" }}>What&apos;s inside?</h3>
          <p className="sub" style={{ margin: "0 0 16px", fontSize: ".85rem" }}>
            A courier is answerable for what it carries — be specific.
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle} htmlFor="contents">Describe the contents</label>
            <input
              id="contents"
              style={fieldStyle}
              value={declaredContents}
              onChange={(e) => setDeclaredContents(e.target.value)}
              placeholder="e.g. 2 pairs of shoes and a phone charger"
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="declared-value">Roughly what is it worth? (KES)</label>
            <input
              id="declared-value"
              style={{ ...fieldStyle, maxWidth: 220 }}
              value={declaredValue}
              inputMode="numeric"
              onChange={(e) => setDeclaredValue(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="e.g. 4500"
            />
            <p className="sub" style={{ margin: "6px 0 0", fontSize: ".78rem" }}>
              Used if anything goes wrong. Be honest — a figure nobody believes helps nobody.
            </p>
          </div>
        </>
      )}

      {step === "terms" && (
        <>
          <h3 style={{ margin: "0 0 4px" }}>Last thing</h3>
          <p className="sub" style={{ margin: "0 0 16px", fontSize: ".85rem" }}>
            Confirm this and you&apos;re checked in.
          </p>
          <label className="sub" htmlFor="lawful" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 14 }}>
            <input id="lawful" type="checkbox" checked={lawfulAttested} style={{ marginTop: 3 }} onChange={(e) => setLawfulAttested(e.target.checked)} />
            <span>
              I confirm the contents are legal to send and contain no prohibited items — no cash,
              weapons, drugs, explosives, or live animals. I understand Esoqo and {chosenStation?.name ?? "the carrying company"} are
              not liable for contents I have not accurately declared.
            </span>
          </label>
          <label className="sub" htmlFor="terms" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input id="terms" type="checkbox" checked={termsAccepted} style={{ marginTop: 3 }} onChange={(e) => setTermsAccepted(e.target.checked)} />
            <span>
              I accept Esoqo&apos;s{" "}
              <a href="/help" target="_blank" rel="noreferrer">terms of service</a>{" "}
              and the shipping terms of {chosenStation?.name ?? "the company that carries this parcel"}.
            </span>
          </label>
        </>
      )}

      {error && <ErrorLine message={error} />}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        {stepIndex > 0 && (
          <button type="button" className="btn btn-o" onClick={goBack} disabled={pending}>
            <Icon name="arrow-left" size={15} /> Back
          </button>
        )}
        <button type="button" className="btn btn-p" style={{ flex: 1 }} onClick={goNext} disabled={pending}>
          {pending
            ? (ticketId ? "Saving…" : "Checking in…")
            : stepIndex === steps.length - 1
              ? (ticketId ? "Save & return to my ticket" : "Check in")
              : "Next"}
          {!pending && stepIndex < steps.length - 1 && <Icon name="arrow-right" size={15} />}
        </button>
      </div>
      <p className="sub" style={{ margin: "10px 0 0", fontSize: ".78rem", textAlign: "center" }}>
        {ticketId
          ? "This is saved automatically as you type — your clerk picks up from here once they call your ticket."
          : "Nothing to pay online — settle the fee with the clerk when they call you forward."}
      </p>
    </div>
  );
}

function PartyFieldset({
  value,
  onChange,
  idPrefix,
}: {
  value: PartyFields;
  onChange: (v: PartyFields) => void;
  idPrefix: string;
}) {
  function set<K extends keyof PartyFields>(key: K, v: string) {
    onChange({ ...value, [key]: v });
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle} htmlFor={`${idPrefix}-first`}>First name</label>
          <input id={`${idPrefix}-first`} style={fieldStyle} value={value.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle} htmlFor={`${idPrefix}-last`}>Last name</label>
          <input id={`${idPrefix}-last`} style={fieldStyle} value={value.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </div>
      </div>
      <div>
        <label style={labelStyle} htmlFor={`${idPrefix}-phone`}>Phone number</label>
        <input id={`${idPrefix}-phone`} style={fieldStyle} value={value.phone} placeholder="07XX XXX XXX" onChange={(e) => set("phone", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle} htmlFor={`${idPrefix}-phone2`}>Second phone number (optional)</label>
        <input id={`${idPrefix}-phone2`} style={fieldStyle} value={value.phone2} placeholder="07XX XXX XXX" onChange={(e) => set("phone2", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle} htmlFor={`${idPrefix}-email`}>Email (optional)</label>
        <input id={`${idPrefix}-email`} type="email" style={fieldStyle} value={value.email} placeholder="name@example.com" onChange={(e) => set("email", e.target.value)} />
      </div>
    </div>
  );
}

function StationCard({
  title,
  subtitle,
  hint,
  selected,
  onClick,
}: {
  title: string;
  subtitle: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: 12,
        borderRadius: 10,
        cursor: "pointer",
        border: selected ? "1.5px solid var(--brand)" : "1px solid var(--line)",
        background: selected ? "var(--brand-t, rgba(0,0,0,.03))" : "var(--bg-1, transparent)",
      }}
    >
      {selected ? <Icon name="check-circle" size={18} /> : <Icon name="building" size={18} />}
      <span style={{ flex: 1 }}>
        <strong style={{ display: "block", fontSize: ".92rem" }}>{title}</strong>
        <span className="sub" style={{ fontSize: ".78rem" }}>{subtitle}</span>
        {hint && <span className="sub" style={{ display: "block", fontSize: ".76rem", marginTop: 2 }}>{hint}</span>}
      </span>
    </button>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" style={{ color: "var(--red, #b42318)", display: "flex", alignItems: "center", gap: 6, margin: "14px 0 0", fontSize: ".85rem" }}>
      <Icon name="alert-circle" size={15} />
      {message}
    </p>
  );
}
