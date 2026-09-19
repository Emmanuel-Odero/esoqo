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
        padding: "28px",
        marginBottom: "28px",
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--sh-s)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "var(--r-md)",
            background: "var(--green-t)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="qr" size={24} style={{ color: "var(--green)" }} />
        </div>
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: "1.2rem",
              fontWeight: 700,
              color: "var(--navy)",
              fontFamily: "var(--font-display)",
            }}
          >
            Quick Scan
          </h3>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: ".9rem",
              color: "var(--tx-2)",
              lineHeight: 1.4,
            }}
          >
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
          alignItems: "stretch",
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
            padding: "16px 18px",
            fontSize: "1.05rem",
            border: "1.5px solid var(--line)",
            borderRadius: "var(--r-sm)",
            minWidth: "280px",
            outline: "none",
            background: "#fff",
            transition:
              "border-color var(--dur-fast), box-shadow var(--dur-fast)",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = "var(--green)";
            e.target.style.boxShadow = "0 0 0 3px rgba(31,161,99,.12)";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "var(--line)";
            e.target.style.boxShadow = "none";
          }}
        />
        <button
          className="btn btn-p"
          type="submit"
          disabled={busy || !text.trim()}
          style={{
            background: "var(--green)",
            color: "white",
            border: "none",
            padding: "16px 28px",
            borderRadius: "var(--r-sm)",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: text.trim() && !busy ? "pointer" : "not-allowed",
            opacity: text.trim() && !busy ? 1 : 0.5,
            transition: "all var(--dur-fast)",
            minHeight: "56px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {busy ? (
            <>
              <Icon name="loader" size={18} />
              Working…
            </>
          ) : (
            <>
              <Icon name="search" size={18} />
              Scan
            </>
          )}
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
              color: "var(--green)",
              border: "1.5px solid var(--line)",
              padding: "16px 22px",
              borderRadius: "var(--r-sm)",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all var(--dur-fast)",
              minHeight: "56px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--green)";
              e.currentTarget.style.background = "var(--green-t)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--line)";
              e.currentTarget.style.background = "#fff";
            }}
          >
            <Icon name="qr" size={18} /> Choose Label
          </button>
        )}
      </form>
      {pickerOpen && (
        <section
          id="empty-label-picker"
          className="label-picker-popover"
          aria-label="Choose an empty label"
          style={{
            marginTop: "20px",
            padding: "20px",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
            background: "var(--paper)",
            boxShadow: "var(--sh-s)",
          }}
        >
          <label
            className="sub"
            htmlFor="empty-label-search"
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: 600,
              fontSize: ".95rem",
              color: "var(--navy)",
            }}
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
              padding: "12px 14px",
              border: "1.5px solid var(--line)",
              borderRadius: "var(--r-sm)",
              fontSize: ".95rem",
              marginBottom: "16px",
            }}
          />
          <div
            className="label-picker-results"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
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
                  border: "1.5px solid var(--line)",
                  borderRadius: "var(--r-sm)",
                  background: "#fff",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all var(--dur-fast)",
                  boxShadow: "var(--sh-s)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--green)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "var(--sh-m)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--line)";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "var(--sh-s)";
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
              <p
                className="sub"
                style={{
                  margin: "20px 0",
                  color: "var(--tx-2)",
                  fontSize: ".9rem",
                }}
              >
                No empty label matches "{labelQuery}".
              </p>
            )}
          </div>
        </section>
      )}
      {status && (
        <p
          role={status.kind === "problem" ? "alert" : "status"}
          style={{
            margin: "16px 0 0",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: ".92rem",
            padding: "14px 16px",
            borderRadius: "var(--r-sm)",
            fontWeight: 500,
            background:
              status.kind === "problem"
                ? "var(--red-t)"
                : status.kind === "done"
                  ? "var(--green-t)"
                  : "var(--blue-t)",
            color:
              status.kind === "problem"
                ? "var(--red)"
                : status.kind === "done"
                  ? "var(--green)"
                  : "var(--blue)",
            border: `1px solid ${
              status.kind === "problem"
                ? "#F3D2CF"
                : status.kind === "done"
                  ? "#BFE0CE"
                  : "#C9DFEE"
            }`,
          }}
        >
          <Icon name={statusIcon[status.kind]} size={18} />
          {status.text}
        </p>
      )}
    </div>
  );
}
