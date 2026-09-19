"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import { extractParcelCode } from "@esoqo/domain";
import { ScanButton } from "./ScanButton";
import { receiveWalkInParcel } from "./actions";

/**
 * A rider's dashboard scanner.
 *
 * This deliberately performs one custody action only. Booking labels and
 * walk-in tickets belong to Counter, where the sender, price and label can
 * be handled; from the working parcel list a rider needs the much simpler
 * promise that scanning a parcel means "I have it now".
 */
export function DashboardScanner() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const announce = useAnnounce();
  const router = useRouter();

  async function submit(raw: string) {
    const code = extractParcelCode(raw.trim()) || raw.trim().toUpperCase();
    if (!code) return;

    setBusy(true);
    setMessage(null);
    try {
      const result = await receiveWalkInParcel(code);
      if (!result.ok) {
        setMessage({ error: true, text: result.error });
        announce(result.error, "assertive");
        return;
      }
      const success = `${result.code} is now in your custody.`;
      setMessage({ error: false, text: success });
      announce(success, "assertive");
      setText("");
      // Keep the working list and its counts honest without making the
      // rider reload the dashboard after each handoff.
      router.refresh();
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <section
      className="card dashboard-scanner"
      aria-labelledby="dashboard-scanner-title"
    >
      <label
        htmlFor="dashboard-parcel-scan"
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          fontWeight: 700,
        }}
      >
        <span className="scan-title-icon">
          <Icon name="qr" size={18} />
        </span>
        <span id="dashboard-scanner-title">Scan a parcel</span>
      </label>
      <p className="sub" style={{ margin: "4px 0 10px" }}>
        Scan the QR or barcode to record that you have the parcel. A scanner gun
        works in this box too.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(text);
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <input
          id="dashboard-parcel-scan"
          ref={inputRef}
          className="mono"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="PKG-XXXXXX or tracking link"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          aria-label="Parcel code"
          style={{
            flex: 1,
            minWidth: 220,
            padding: "10px 12px",
            border: "1.5px solid var(--line)",
            borderRadius: 8,
          }}
        />
        <button
          type="submit"
          className="btn btn-p"
          disabled={busy || !text.trim()}
        >
          {busy ? "Recording…" : "Receive parcel"}
        </button>
        <ScanButton onScan={(code) => void submit(code)} />
      </form>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          style={{
            margin: "10px 0 0",
            color: message.error ? "var(--red)" : "var(--green)",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <Icon
            name={message.error ? "alert-circle" : "check-circle"}
            size={15}
          />
          {message.text}
        </p>
      )}
    </section>
  );
}
