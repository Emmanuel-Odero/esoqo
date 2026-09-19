"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  useTransition,
} from "react";
import { Icon, PrintableLabel, PrintStyles } from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import { extractParcelCode } from "@esoqo/domain";
import type { OrgParcelRow } from "@/lib/parcel-org-session";
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
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
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
      const res = await receiveWalkInParcel(clean);
      setReceiving(false);
      if (!res.ok) return res;
      setJustReceived(res.code);
      setJustReceivedSig(undefined);
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
    [announce],
  );

  useImperativeHandle(ref, () => ({ receive }), [receive]);

  const visibleWaiting = worklist.filter((p) => !received.has(p.code));

  return (
    <>
      {justReceived && (
        <div
          className="card"
          style={{
            padding: "24px",
            marginBottom: "24px",
            background: "var(--green-t)",
            border: "1px solid #BFE0CE",
            borderRadius: "var(--r-lg)",
            boxShadow: "var(--sh-s)",
          }}
        >
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
                width: 40,
                height: 40,
                borderRadius: "var(--r-sm)",
                background: "var(--green)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="check-circle" size={22} style={{ color: "#fff" }} />
            </div>
            <strong
              style={{
                display: "block",
                fontSize: "1.05rem",
                color: "var(--green)",
                fontWeight: 700,
              }}
            >
              {justReceived} received — the sender and receiver have been
              texted.
            </strong>
          </div>
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
              orgName={orgName}
              orgLogoUrl={orgLogoUrl}
            />
          </div>

          {/* Pay-at-counter fare. Nothing priced this box online — the
              sender chose to settle here — so if it isn't recorded at
              this desk it is never recorded anywhere. */}
          <div
            style={{
              borderTop: "1px solid #BFE0CE",
              marginTop: 16,
              paddingTop: 16,
            }}
          >
            {settled ? (
              <p
                className="sub"
                style={{
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--green)",
                  fontWeight: 600,
                }}
              >
                <Icon name="check-circle" size={16} /> Payment recorded.
              </p>
            ) : (
              <>
                <label
                  className="sub"
                  htmlFor="fare"
                  style={{
                    display: "block",
                    marginBottom: 8,
                    fontWeight: 600,
                    fontSize: ".95rem",
                    color: "var(--navy)",
                  }}
                >
                  Amount the sender paid (KES)
                </label>
                <div className="row" style={{ gap: 10 }}>
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
                      padding: "12px 14px",
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
                    style={{
                      padding: "12px 20px",
                      minHeight: 48,
                    }}
                  >
                    {pending ? "Recording…" : "Record payment"}
                  </button>
                </div>
                {fareError && (
                  <p
                    role="alert"
                    style={{
                      color: "var(--red)",
                      margin: "12px 0 0",
                      fontSize: ".9rem",
                      fontWeight: 500,
                    }}
                  >
                    {fareError}
                  </p>
                )}
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              className="btn btn-o btn-sm"
              onClick={() => window.print()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 18px",
              }}
            >
              <Icon name="print" size={16} />
              Print label
            </button>
            <button
              className="btn btn-o btn-sm"
              onClick={() => setJustReceived(null)}
              style={{ padding: "10px 18px" }}
            >
              Next parcel
            </button>
          </div>
          <PrintStyles />
        </div>
      )}

      <div
        className="card"
        style={{
          padding: "24px",
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
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div>
            <strong
              style={{
                display: "block",
                fontSize: "1.2rem",
                color: "var(--navy)",
                fontWeight: 700,
                fontFamily: "var(--font-display)",
              }}
            >
              Waiting at your desk
            </strong>
            <p
              style={{
                margin: "6px 0 0",
                color: "var(--tx-2)",
                fontSize: ".9rem",
              }}
            >
              Self-drop-off bookings ready for receipt
            </p>
          </div>
          <div
            style={{
              background: "var(--blue-t)",
              color: "var(--blue)",
              padding: "8px 16px",
              borderRadius: "var(--r-pill)",
              fontSize: ".9rem",
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
            }}
          >
            {visibleWaiting.length}
          </div>
        </div>
        {visibleWaiting.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px 20px",
              color: "var(--tx-2)",
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: "var(--r-lg)",
                background: "var(--paper)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <Icon name="inbox" size={28} style={{ color: "var(--tx-3)" }} />
            </div>
            <p className="sub" style={{ margin: 0, fontSize: ".95rem" }}>
              Nothing waiting right now.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              className="tbl"
              style={{
                width: "100%",
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--line)",
                    textAlign: "left",
                  }}
                >
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: 600,
                      fontSize: ".9rem",
                      color: "var(--tx-3)",
                    }}
                  >
                    Code
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: 600,
                      fontSize: ".9rem",
                      color: "var(--tx-3)",
                    }}
                  >
                    Receiver
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: 600,
                      fontSize: ".9rem",
                      color: "var(--tx-3)",
                    }}
                  >
                    Destination
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  ></th>
                </tr>
              </thead>
              <tbody>
                {visibleWaiting.map((p) => (
                  <tr
                    key={p.code}
                    style={{
                      borderBottom: "1px solid var(--line)",
                      transition: "background var(--dur-fast)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--paper)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td
                      className="mono"
                      style={{
                        padding: "16px",
                        fontWeight: 600,
                        fontSize: ".9rem",
                      }}
                    >
                      {p.code}
                    </td>
                    <td
                      style={{
                        padding: "16px",
                        fontSize: ".9rem",
                      }}
                    >
                      {p.receiverName}
                    </td>
                    <td
                      style={{
                        padding: "16px",
                        fontSize: ".9rem",
                        color: "var(--tx-2)",
                      }}
                    >
                      {p.destinationLabel}
                    </td>
                    <td
                      style={{
                        padding: "16px",
                        textAlign: "right",
                      }}
                    >
                      <button
                        className="btn btn-p btn-sm"
                        disabled={receiving}
                        onClick={() =>
                          void receive(p.code).then((r) => {
                            if (!r.ok) setError(r.error);
                          })
                        }
                        style={{
                          padding: "10px 18px",
                          fontSize: ".9rem",
                        }}
                      >
                        Confirm receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </>
  );
});
