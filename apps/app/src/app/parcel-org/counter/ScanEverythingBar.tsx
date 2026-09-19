"use client";

import { useMemo, useRef, useState } from "react";
import { Icon, PrintableLabel, type IconName } from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import { extractParcelCode } from "@esoqo/domain";
import { ScanButton } from "../ScanButton";

export type ScanEverythingResult =
  { ok: true; code: string } | { ok: false; error: string };

/** The one-line verdict shown under the scan box after a scan. */
type Status =
  | { kind: "done"; text: string }
  | { kind: "problem"; text: string }
  | { kind: "note"; text: string };

/**
 * The counter's ONE scan box — "one box, every purpose".
 *
 * Before this, the page had two scanners with two vocabularies: the
 * booking form read PKG- labels and the front-desk card read TCK-
 * tickets. A clerk scanning a gun across the room had to know which box
 * it belonged in, and a wrong guess produced a dead end.
 *
 * This bar classes the code itself and routes it:
 *  - TCK-… a service ticket number → the desk takes the walk-in in hand
 *    (receive, needs parcelorg.carry);
 *  - PKG-… a stock label OR an existing parcel (both are PKG-) → the
 *    booking form's own load path resolves the difference and books,
 *    resumes, or opens the parcel (needs parcelorg.dispatch);
 *  - anything else → a best-effort receive, so a code someone typed
 *    bare can still take in a waiting box.
 *
 * The input never loses focus across scans — scanner guns are just
 * keyboards that type fast and hit Enter — so a clerk can run the whole
 * row off a gun: scan ticket → receipt card and label below → scan the
 * next one.
 */
export function ScanEverythingBar({
  canCarry,
  canDispatch,
  onLoadLabel,
  onReceive,
  emptyLabels,
  orgName,
  orgLogoUrl,
}: {
  canCarry: boolean;
  canDispatch: boolean;
  onLoadLabel: (code: string) => void;
  onReceive: (reference: string) => Promise<ScanEverythingResult>;
  /** A small, immediately usable slice of this counter's blank stock. */
  emptyLabels: { code: string; sig?: string }[];
  orgName: string;
  orgLogoUrl?: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [labelQuery, setLabelQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const say = useAnnounce();
  const matchingLabels = useMemo(() => {
    const needle = labelQuery.trim().toUpperCase();
    return (
      needle
        ? emptyLabels.filter((label) => label.code.includes(needle))
        : emptyLabels
    ).slice(0, 6);
  }, [emptyLabels, labelQuery]);

  function chooseLabel(label: { code: string; sig?: string }) {
    onLoadLabel(label.code);
    setStatus({
      kind: "note",
      text: `${label.code} selected for this booking.`,
    });
    setLabelQuery("");
    setPickerOpen(false);
  }

  /** One entry, every job. Surfaces a short human line under the box
   *  about what JUST happened; the action itself lands where it belongs
   *  (receipt card below, or the booking form's load). */
  async function submit(raw: string) {
    const target = (extractParcelCode(raw.trim()) || raw.trim()).toUpperCase();
    if (!target) return;
    const label = target.startsWith("PKG-");
    const ticket = target.startsWith("TCK-");
    if (!label && !ticket && !/^[A-Z0-9]{6,}$/.test(target)) {
      setStatus({
        kind: "problem",
        text: `“${raw.trim()}” doesn't look like an Esoqo code.`,
      });
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      if (label) {
        if (canDispatch) {
          // The booking form's scan() does the rest — blank label books
          // from here, filled label resumes, spent label / existing
          // parcel opens itself (that verdict shows in the form below,
          // and it announces it itself, so no double reading here).
          onLoadLabel(target);
          setStatus({ kind: "note", text: `${target} — loaded for booking.` });
        } else if (canCarry) {
          await runReceive(target);
        } else {
          setStatus({
            kind: "problem",
            text: "This account can't create bookings.",
          });
        }
        return;
      }
      if (ticket) {
        if (!canCarry) {
          setStatus({
            kind: "problem",
            text: "This account can't receive parcels.",
          });
          return;
        }
        await runReceive(target);
        return;
      }
      if (canCarry) {
        await runReceive(target);
      } else {
        setStatus({
          kind: "problem",
          text: `“${target}” isn't a code this counter recognises.`,
        });
      }
    } finally {
      setBusy(false);
      setText("");
      // Back on the gun, ready for the next customer in the same motion.
      inputRef.current?.focus();
    }
  }

  async function runReceive(target: string) {
    const res = await onReceive(target);
    if (res.ok) {
      setStatus({ kind: "done", text: `${res.code} received.` });
      say(`${res.code} received`, "assertive");
    } else {
      setStatus({ kind: "problem", text: res.error });
      say(res.error, "assertive");
    }
  }

  const statusIcon: Record<Status["kind"], IconName> = {
    done: "check-circle",
    problem: "alert-circle",
    note: "info",
  };

  return (
    <div
      className="card counter-scanner"
      style={{
        padding: "20px",
        marginBottom: "24px",
        background: "#fff",
        border: "1px solid #BFE0CE",
        borderRadius: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            background: "#E8F5E9",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name="qr" size={20} style={{ color: "#1F9F63" }} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
            Quick Scan
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: ".85rem", color: "#666" }}>
            Scan a code to get started
          </p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
        style={{
          display: "flex",
          gap: "12px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          id="scan-everything"
          ref={inputRef}
          className="mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Scan code here..."
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          aria-label="Scan or type a code"
          style={{
            flex: 1,
            padding: "14px 16px",
            fontSize: "1rem",
            border: "1.5px solid #E0E0E0",
            borderRadius: "10px",
            minWidth: "250px",
            outline: "none",
          }}
        />
        <button
          className="btn btn-p"
          type="submit"
          disabled={busy || !text.trim()}
          style={{
            background: "#1F9F63",
            color: "white",
            border: "none",
            padding: "14px 24px",
            borderRadius: "10px",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: text.trim() ? "pointer" : "not-allowed",
            opacity: text.trim() ? 1 : 0.6,
            transition: "all 0.2s",
          }}
        >
          {busy ? "Working…" : "Scan"}
        </button>
        <ScanButton onScan={(code) => void submit(code)} />
        {canDispatch && emptyLabels.length > 0 && (
          <button
            type="button"
            className="btn btn-o"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            aria-controls="empty-label-picker"
            style={{
              background: "#fff",
              color: "#1F9F63",
              border: "1px solid #BFE0CE",
              padding: "12px 18px",
              borderRadius: "10px",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Icon name="qr" size={16} /> Choose Label
          </button>
        )}
      </form>
      {pickerOpen && (
        <section
          id="empty-label-picker"
          className="label-picker-popover"
          aria-label="Choose an empty label"
          style={{
            marginTop: "12px",
            padding: "12px",
            border: "1px solid #BFE0CE",
            borderRadius: "10px",
            background: "#fff",
            boxShadow: "var(--sh-s)",
          }}
        >
          <label
            className="sub"
            htmlFor="empty-label-search"
            style={{ display: "block", marginBottom: "5px", fontWeight: 600 }}
          >
            Find an empty label
          </label>
          <input
            id="empty-label-search"
            className="mono"
            autoFocus
            value={labelQuery}
            onChange={(e) => setLabelQuery(e.target.value.toUpperCase())}
            placeholder="Type any part of the PKG code"
            autoComplete="off"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "9px 10px",
              border: "1.5px solid var(--line)",
              borderRadius: "7px",
            }}
          />
          <div className="label-picker-results">
            {matchingLabels.map((label) => (
              <button
                key={label.code}
                type="button"
                className="empty-label"
                onClick={() => chooseLabel(label)}
                style={{
                  width: "41mm",
                  height: "23.5mm",
                  flex: "0 0 41mm",
                  overflow: "hidden",
                  padding: "0",
                  border: "1px solid var(--line)",
                  borderRadius: "7px",
                  background: "#fff",
                  cursor: "pointer",
                  textAlign: "left",
                  transition:
                    "border-color var(--dur-fast),box-shadow var(--dur-fast)",
                }}
              >
                <span className="empty-label-preview">
                  <PrintableLabel
                    code={label.code}
                    sig={label.sig}
                    orgName={orgName}
                    orgLogoUrl={orgLogoUrl}
                  />
                </span>
              </button>
            ))}
            {matchingLabels.length === 0 && (
              <p className="sub">No empty label matches "{labelQuery}".</p>
            )}
          </div>
        </section>
      )}
      {status && (
        <p
          role={status.kind === "problem" ? "alert" : "status"}
          style={{
            margin: "10px 0 0",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: ".85rem",
            color:
              status.kind === "problem"
                ? "var(--red)"
                : status.kind === "done"
                  ? "var(--green)"
                  : "var(--tx-2)",
          }}
        >
          <Icon name={statusIcon[status.kind]} size={14} />
          {status.text}
        </p>
      )}
    </div>
  );
}
