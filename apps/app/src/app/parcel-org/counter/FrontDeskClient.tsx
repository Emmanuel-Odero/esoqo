"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  useTransition,
} from "react";
import {
  dropPointFor,
  flushCustody,
  Icon,
  pendingCustodyCount,
  PrintableLabel,
  PrintStyles,
  queueCustody,
} from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import { extractParcelCode } from "@esoqo/domain";
import type { OrgParcelRow } from "@/lib/parcel-org-session";
import { ParcelDrawer } from "../ParcelDrawer";
import {
  listOrgWaitingParcels,
  receiveWalkInParcel,
  resolveOrgLabel,
  settleCounterParcel,
} from "../actions";

/** How often the desk refreshes its own worklist. A front desk sits on
 *  a tablet all day with nobody hitting reload, so a walk-in booking
 *  made online three minutes ago must appear on its own — 30s is the
 *  same interval the dashboard's DropoffPoll already lives at. */
const POLL_MS = 30000;

/** A work queue sorts by dwell, not recency — the person who booked
 *  first has been waiting longest, so they come first. */
function oldestFirst(a: OrgParcelRow, b: OrgParcelRow): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

/** What the unified scan bar (or a worklist row's Confirm receipt) can
 *  ask the desk to do: take this reference in hand. `reference` is
 *  whatever the sender walked in with — the TCK- ticket from the
 *  unified scanner, or a worklist row's tracking code — and the server
 *  resolves either, handing back the REAL code the label must print.*/
export type FrontDeskHandle = {
  receive: (
    reference: string,
  ) => Promise<{ ok: true; code: string } | { ok: false; error: string }>;
};

/**
 * The front desk's own section of the counter: a worklist of
 * self-drop-off bookings waiting for the box itself to walk in, plus
 * the receipt card for the box that was just taken in (label, print,
 * pay-at-counter fare).
 *
 * Scanning no longer happens here — the unified scanner at the top of
 * the page owns every code entry (ticket, label, parcel) and calls
 * this desk's receive() when the code was a TCK- ticket or the session
 * can take custody. Rendered above the booking form (see
 * OrgCounterClient) for anyone who can take custody (parcelorg.carry).
 */
export const FrontDeskClient = forwardRef<
  FrontDeskHandle,
  {
    waiting: OrgParcelRow[];
    orgName: string;
    orgLogoUrl?: string;
  }
>(function FrontDeskClient({ waiting, orgName, orgLogoUrl }, ref) {
  const [justReceived, setJustReceived] = useState<string | null>(null);
  // QR signature for the just-received label, so its reprint stays
  // genuine. Resolved after receipt; absent = still printable, just
  // unverified until re-resolved.
  const [justReceivedSig, setJustReceivedSig] = useState<string | undefined>(
    undefined,
  );
  // The destination of the box just received, for the label's drop-point
  // band — see where this is set in `receive`.
  const [justReceivedTo, setJustReceivedTo] = useState<string | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  // The waiting parcel whose record is open. Receiving is a custody
  // transfer, so it happens inside the record rather than from the row.
  const [viewing, setViewing] = useState<OrgParcelRow | null>(null);
  // Custody moves taken in while the network was down, still waiting to
  // reach the server. Surfaced rather than hidden: a clerk who cannot
  // see that eleven receipts are still on the device has no way to know
  // the day's work has not left it.
  const [queuedCount, setQueuedCount] = useState(0);
  const [stuck, setStuck] = useState<
    { key: string; code: string; error: string }[]
  >([]);
  const announce = useAnnounce();

  // The worklist lives here, not in the server props it arrived with:
  // it refreshes itself on its own clock (see the poll effect) so a
  // sender's online booking appears without anyone touching the reload
  // button. The codes already received this session are filtered out
  // below — confirming one drops the row immediately, and a later poll
  // finding the same row already PICKED_UP agrees instead of undoing it.
  const [worklist, setWorklist] = useState<OrgParcelRow[]>(() =>
    [...waiting].sort(oldestFirst),
  );
  const [received, setReceived] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // A hidden tab has nobody looking at it — skip the round trip.
      if (document.visibilityState === "hidden") return;
      const rows = await listOrgWaitingParcels().catch(() => null);
      if (alive && rows) setWorklist([...rows].sort(oldestFirst));
    };
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /**
   * Push anything held offline back to the server.
   *
   * Runs on mount, whenever the browser says the network came back, and
   * on the worklist's own poll — three triggers because none alone is
   * reliable: `online` fires on a captive portal that still cannot
   * reach us, and a tablet left open all day may never fire it at all.
   * The flush is idempotent, so running it more often than necessary
   * costs a request and nothing else.
   */
  const flush = useCallback(async () => {
    const res = await flushCustody<{ reference: string }>(async (entry) => {
      try {
        const r = await receiveWalkInParcel(entry.input.reference);
        return r.ok
          ? { ok: true as const }
          : { ok: false as const, error: r.error, errorCode: r.errorCode };
      } catch {
        // Still offline — rethrow so the queue leaves it alone rather
        // than marking it failed for a reason that is not its fault.
        throw new Error("offline");
      }
    });
    setStuck(res.stuck.filter((s) => s.error !== ""));
    const left = await pendingCustodyCount();
    setQueuedCount(left);
    if (res.synced.length > 0) {
      announce(
        `${res.synced.length} offline receipt${res.synced.length > 1 ? "s" : ""} synced`,
        "polite",
      );
      const rows = await listOrgWaitingParcels().catch(() => null);
      if (rows) setWorklist([...rows].sort(oldestFirst));
    }
  }, [announce]);

  useEffect(() => {
    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const id = setInterval(() => void flush(), POLL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(id);
    };
  }, [flush]);

  // The fare for the box that was just received. Separate state from the
  // receipt itself because they're separate facts on the server too (see
  // settleCounterParcel): custody is recorded the moment the box is in
  // hand, payment when the notes are actually counted.
  const [fare, setFare] = useState("");
  const [settled, setSettled] = useState(false);
  const [fareError, setFareError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function settle(code: string) {
    const amount = Number(fare);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFareError("Enter the amount the sender paid");
      return;
    }
    setFareError(null);
    startTransition(async () => {
      const res = await settleCounterParcel(code, amount);
      if (!res.ok) {
        setFareError(res.error);
        return;
      }
      setSettled(true);
      announce(
        `Payment of ${amount} shillings recorded for ${code}`,
        "assertive",
      );
    });
  }

  /** Take a box in hand. Returns the outcome so the caller (the unified
   *  scanner above, or a worklist row button) can surface the error where
   *  it happened; the real code lands here in the receipt card either
   *  way. */
  const receive = useCallback(
    async (reference: string) => {
      setError(null);
      setReceiving(true);
      // Camera QRs decode to the tracking URL, guns to the bare code —
      // accept either; the server resolves both.
      const clean = extractParcelCode(reference.trim()) || reference.trim();
      let res: Awaited<ReturnType<typeof receiveWalkInParcel>>;
      try {
        res = await receiveWalkInParcel(clean);
      } catch {
        // The network went, not the server. Take the box in hand anyway
        // and record the intent — a desk that refuses custody because a
        // mast is down sends the customer away with their parcel, which
        // is the one outcome worse than a delayed record.
        //
        // dbx.ScanHandoff already treats a replayed scan by the current
        // holder as a no-op success, so flushing this later is safe
        // however many times it runs (see packages/ui custodyQueue).
        setReceiving(false);
        try {
          await queueCustody("parcel.receive", clean, { reference: clean });
          setQueuedCount((n) => n + 1);
          announce(
            `${clean} held offline — it will sync when the network returns`,
            "assertive",
          );
          // Deliberately no label print: the real tracking code is
          // resolved server-side (a walk-in often presents a TCK- ticket,
          // not the PKG- code), so printing now would put a reference on
          // a box that no later scan resolves. The clerk is told why.
          return {
            ok: false as const,
            error: `Held offline — ${clean} will sync when the network returns. Print the label once it has.`,
          };
        } catch {
          return {
            ok: false as const,
            error: "No network, and this device cannot hold work offline.",
          };
        }
      }
      setReceiving(false);
      if (!res.ok) return res;
      setJustReceived(res.code);
      setJustReceivedSig(undefined);
      // Where this box is going, for the drop-point band on the label
      // printed two lines from here. Read off the worklist row we already
      // have rather than fetched: this desk was just looking at that row.
      // Captured now instead of derived at render time because the next
      // poll legitimately drops the row, and a label that loses its
      // destination a few seconds after printing would be worse than one
      // that never had it. No matching row (a box that was never on this
      // worklist) prints the blank write-on rule, which is honest.
      setJustReceivedTo(
        worklist.find((p) => p.code === res.code)?.destinationLabel,
      );
      // Drop the row off the worklist right now — a confirm-receipt
      // that leaves the row standing until the next poll reads as the
      // system ignoring what just happened.
      setReceived((prev) => new Set(prev).add(res.code));
      setFare("");
      setSettled(false);
      setFareError(null);
      announce(`${res.code} received`, "assertive");
      // Resolve the signature in the background so the reprint below is
      // genuine with company branding (or Esoqo alone when no logo).
      void resolveOrgLabel(res.code).then((r) => {
        if (r.ok && r.label.sig) setJustReceivedSig(r.label.sig);
      });
      return res;
    },
    // worklist, because the destination lookup above reads it — a stale
    // closure here would miss every row the 30s poll has brought in
    // since mount, which is most of them by mid-morning.
    [announce, worklist],
  );

  useImperativeHandle(ref, () => ({ receive }), [receive]);

  const visibleWaiting = worklist.filter((p) => !received.has(p.code));

  return (
    <>
      {/* Offline queue banner - compact, clear */}
      {(queuedCount > 0 || stuck.length > 0) && (
        <div
          className="card"
          role="status"
          style={{
            padding: "12px 16px",
            marginBottom: 16,
            background: stuck.length > 0 ? "var(--red-t)" : "var(--amber-t)",
            border: `1px solid ${stuck.length > 0 ? "var(--red)" : "var(--amber)"}`,
            borderRadius: "var(--r-md)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Icon
            name={stuck.length > 0 ? "alert-triangle" : "wifi-off"}
            size={18}
          />
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: ".9rem" }}>
              {queuedCount > 0
                ? `${queuedCount} receipt${queuedCount > 1 ? "s" : ""} held offline`
                : "Some receipts need attention"}
            </strong>
            {queuedCount > 0 && stuck.length === 0 && (
              <p
                className="sub"
                style={{ margin: "2px 0 0", fontSize: ".8rem" }}
              >
                Will sync automatically when network returns
              </p>
            )}
          </div>
        </div>
      )}
      {justReceived && (
        <div
          className="card"
          style={{
            padding: "20px",
            marginBottom: "20px",
            background: "var(--green-t)",
            border: "1px solid var(--green)",
            borderRadius: "var(--r-lg)",
            boxShadow: "var(--sh-s)",
          }}
        >
          {/* Success header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--r-sm)",
                background: "var(--green)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon name="check" size={20} style={{ color: "#fff" }} />
            </div>
            <div>
              <strong
                style={{
                  display: "block",
                  fontSize: "1rem",
                  color: "var(--green)",
                  fontWeight: 700,
                }}
              >
                {justReceived} received
              </strong>
              <p className="sub" style={{ margin: 0, fontSize: ".85rem" }}>
                Sender and receiver have been notified
              </p>
            </div>
          </div>

          {/* Label print section */}
          <div
            className="print-modal-escape"
            style={{
              background: "#fff",
              padding: 16,
              borderRadius: "var(--r-sm)",
              marginBottom: 16,
            }}
          >
            <PrintableLabel
              code={justReceived}
              sig={justReceivedSig}
              route={dropPointFor(justReceivedTo)}
              orgName={orgName}
              orgLogoUrl={orgLogoUrl}
            />
          </div>

          {/* Payment section */}
          {settled ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--green)",
                fontWeight: 600,
              }}
            >
              <Icon name="check-circle" size={16} />
              Payment recorded
            </div>
          ) : (
            <div
              style={{ borderTop: "1px solid var(--green)", paddingTop: 16 }}
            >
              <label
                className="sub"
                htmlFor="fare"
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontWeight: 600,
                  fontSize: ".9rem",
                  color: "var(--navy)",
                }}
              >
                Pay-at-counter (KES)
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  id="fare"
                  className="mono"
                  value={fare}
                  inputMode="numeric"
                  placeholder="0"
                  onChange={(e) =>
                    setFare(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  onKeyDown={(e) => e.key === "Enter" && settle(justReceived)}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    padding: "10px 12px",
                    border: "1.5px solid var(--line)",
                    borderRadius: "var(--r-sm)",
                    fontSize: ".95rem",
                    background: "#fff",
                  }}
                />
                <button
                  className="btn btn-p btn-sm"
                  disabled={pending || !fare.trim()}
                  onClick={() => settle(justReceived)}
                  style={{ padding: "10px 16px" }}
                >
                  {pending ? "Recording…" : "Record payment"}
                </button>
              </div>
              {fareError && (
                <p
                  role="alert"
                  style={{
                    color: "var(--red)",
                    margin: "10px 0 0",
                    fontSize: ".85rem",
                    fontWeight: 500,
                  }}
                >
                  {fareError}
                </p>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              className="btn btn-o btn-sm"
              onClick={() => window.print()}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <Icon name="print" size={16} />
              Print label
            </button>
            <button
              className="btn btn-o btn-sm"
              onClick={() => setJustReceived(null)}
            >
              Next parcel
            </button>
          </div>
          <PrintStyles />
        </div>
      )}

      {/* Worklist card - clean header with icon */}
      <div
        className="card"
        style={{
          padding: "20px",
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
            justifyContent: "space-between",
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: "1px solid var(--line)",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "var(--r-sm)",
                background: "var(--blue-t)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon name="inbox" size={20} style={{ color: "var(--blue)" }} />
            </div>
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  color: "var(--navy)",
                }}
              >
                Waiting at your desk
              </h3>
              <p
                style={{
                  margin: "4px 0 0",
                  color: "var(--tx-2)",
                  fontSize: ".85rem",
                }}
              >
                Self-drop-off bookings ready for receipt
              </p>
            </div>
          </div>
          {visibleWaiting.length > 0 && (
            <div
              style={{
                background: "var(--blue)",
                color: "#fff",
                padding: "6px 14px",
                borderRadius: "var(--r-pill)",
                fontSize: ".85rem",
                fontWeight: 700,
              }}
            >
              {visibleWaiting.length}
            </div>
          )}
        </div>

        {visibleWaiting.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "32px 20px",
              color: "var(--tx-2)",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "var(--r-md)",
                background: "var(--paper)",
                display: "grid",
                placeItems: "center",
                margin: "0 auto 12px",
              }}
            >
              <Icon
                name="check-circle"
                size={24}
                style={{ color: "var(--green)" }}
              />
            </div>
            <p className="sub" style={{ margin: 0, fontSize: ".9rem" }}>
              All caught up — nothing waiting.
            </p>
          </div>
        ) : (
          <ul className="plist">
            {visibleWaiting.map((p) => (
              <li key={p.code}>
                <div className="plist-main">
                  {/* Opens the record. Confirming receipt takes legal
                      custody of somebody else's property, and this row
                      used to offer that against a receiver's name and a
                      destination — see ParcelDrawer.tsx. */}
                  <button
                    type="button"
                    className="pdrawer-open mono"
                    onClick={() => setViewing(p)}
                  >
                    {p.code}
                  </button>
                  <span className="plist-sub">
                    {p.receiverName}
                    {p.destinationLabel && <> · {p.destinationLabel}</>}
                  </span>
                </div>
                <div className="plist-actions">
                  <button
                    className="btn btn-o btn-sm"
                    onClick={() => setViewing(p)}
                  >
                    View &amp; receive
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p
            role="alert"
            style={{
              color: "var(--red)",
              margin: "16px 0 0",
              padding: "14px 16px",
              background: "var(--red-t)",
              border: "1px solid #F3D2CF",
              borderRadius: "var(--r-sm)",
              fontSize: ".9rem",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon name="alert-circle" size={16} />
            {error}
          </p>
        )}
      </div>

      {/* Receiving lives inside the record, under the facts a clerk
          checks the box against. */}
      {viewing && (
        <ParcelDrawer
          parcel={viewing}
          onClose={() => setViewing(null)}
          actions={
            <>
              <p className="sub">
                Check the box matches what is written above, then take it in. The
                sender gets a receipt by text the moment you do.
              </p>
              <div className="ptoolbar">
                <button
                  className="btn btn-p"
                  disabled={receiving}
                  onClick={() => {
                    const code = viewing.code;
                    setViewing(null);
                    void receive(code).then((r) => {
                      if (!r.ok) setError(r.error);
                    });
                  }}
                >
                  <Icon name="check" size={16} />
                  {receiving ? "Receiving…" : "Received — take it in"}
                </button>
              </div>
            </>
          }
        />
      )}
    </>
  );
});
