"use client";

import { useRef, useState, useEffect } from "react";
import {
  CounterForm as SharedCounterForm,
  Icon,
  type CounterActions,
  type CounterFormHandle,
  type CounterPricingOption,
} from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";
import type { OrgParcelRow } from "@/lib/parcel-org-session";
import {
  attachOrgLabelInfo,
  bookOrgCounterParcel,
  lookupOrgParcelByCode,
  receiveWalkInParcel,
  resolveOrgLabel,
  searchOrgCounterParties,
  createShipment,
  joinShipment,
  listActiveShipments,
  loadParcelToShipment,
  startShipment,
  finishShipment,
  cancelShipment,
  getLeftBehindParcels,
  type ShipmentView,
  type DispatchCrewInput,
} from "../actions";
import { FrontDeskClient, type FrontDeskHandle } from "./FrontDeskClient";
import { ScanEverythingBar } from "./ScanEverythingBar";
import { OrgLabelsClient } from "../labels/OrgLabelsClient";
import type { OrgLabelBatchRow, OrgLabelRow } from "../actions";

/**
 * The company's own counter — thin wiring over the shared Counter,
 * with the front-desk worklist above it.
 *
 * Same screen the Esoqo console uses (scan → who → what → measure →
 * book / save-to-label, volumetric preview, party memory, offline
 * queue) for the booking half, bound here to the company's session:
 * resolving and holding only its own stock, completing names only from
 * its own customers, booking onto its own books. A clerk here can never
 * touch another company's pad — core-go scopes every one of these calls
 * by session.
 *
 * A carry-only session (a rider standing at the desk waiting on
 * self-drop-offs) renders just the worklist; dispatch earns the booking
 * form as well. The server is the authority either way.
 */
export function OrgCounterClient({
  initialCode,
  initialTab,
  labelState,
  pricing,
  volumetricDivisor,
  waiting,
  orgName,
  orgLogoUrl,
  canDispatch,
  canCarry,
  labels,
  labelCounts,
  labelBatches,
}: {
  initialCode?: string;
  initialTab: "receive" | "book" | "labels";
  labelState: string;
  pricing: CounterPricingOption[];
  volumetricDivisor: number;
  waiting: OrgParcelRow[];
  orgName: string;
  orgLogoUrl?: string;
  canDispatch: boolean;
  canCarry: boolean;
  labels: OrgLabelRow[];
  labelCounts: Record<string, number>;
  labelBatches: OrgLabelBatchRow[];
}) {
  const announce = useAnnounce();
  // Unified approach: one scan bar, one clear workflow
  const formRef = useRef<CounterFormHandle>(null);
  const deskRef = useRef<FrontDeskHandle>(null);

  // Ensure we have boolean values - defensive against hydration mismatches
  const hasCarry = Boolean(canCarry);
  const hasDispatch = Boolean(canDispatch);

  // Compute initial view - this must match server render exactly
  // Use a stable default that won't vary between server/client
  const getInitialView = (): "receive" | "book" | "labels" => {
    const safeTab = initialTab || "receive";
    // If only dispatch is available, default to book
    if (hasDispatch && !hasCarry) return "book";
    // If only receive (carry), use initialTab or default to receive
    if (hasCarry && !hasDispatch) {
      return safeTab === "labels" ? "labels" : "receive";
    }
    // Both available - use initialTab, default to receive
    if (safeTab === "book") return "book";
    if (safeTab === "labels") return "labels";
    return "receive";
  };

  // Use a stable initial value to prevent hydration mismatches
  // The server renders with default value, then client corrects after hydration
  const [view, setView] = useState<"receive" | "book" | "labels">(
    getInitialView,
  );

  // Sync state after hydration in case of mismatched initial values
  useEffect(() => {
    setView(getInitialView());
  }, []);

  const actions: CounterActions = {
    getLabelInfo: async (code) => {
      const res = await resolveOrgLabel(code);
      if (res.ok) {
        const label = res.label;
        if (label.state === "spent") {
          // One box, every purpose: a spent label opens its own parcel
          // instead of refusing the scan. The counter shows what the
          // code IS; where it leads is the door (see the shared form's
          // parcel notice).
          return {
            ok: true,
            info: label,
            parcel: {
              code: label.parcelCode ?? label.code,
              status: label.parcelStatus ?? "BOOKED",
            },
          };
        }
        if (label.state === "voided") {
          return {
            ok: false,
            error:
              "That label was withdrawn — print a fresh one from Labels instead.",
          };
        }
        if (label.state === "blank") return { ok: true, info: null };
        return { ok: true, info: label };
      }
      // Not stock. A fresh counter booking mints its tracking code on
      // the parcel (never a pre-printed sticker), so a later scan of it
      // doesn't resolve as a label — fall back to the parcel itself.
      const parcel = await lookupOrgParcelByCode(code);
      if (parcel) {
        return {
          ok: true,
          info: null,
          parcel: { code: parcel.code, status: parcel.status },
        };
      }
      return res;
    },
    attachLabelInfo: (code, info) => attachOrgLabelInfo(code, info),
    bookParcel: bookOrgCounterParcel,
    confirmIntake: async (code) => {
      const res = await receiveWalkInParcel(code);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
    searchParties: searchOrgCounterParties,
    // The label printed the moment a counter booking lands: resolve the
    // stock element's signature so it verifies genuine. Fresh-minted
    // codes aren't stock, so that resolve misses and the print falls
    // back to unverified — a working sticker either way.
    getLabelSig: async (code) => {
      const res = await resolveOrgLabel(code);
      return res.ok ? res.label.sig || undefined : undefined;
    },
  };

  // ── Shipment state ──
  const [activeShipment, setActiveShipment] = useState<ShipmentView | null>(
    null,
  );
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [shipmentForm, setShipmentForm] = useState({
    vehiclePlate: "",
    vehicleType: "VAN",
    originLabel: "",
    destinationLabel: "",
    routeLabel: "",
    driverName: "",
    driverMsisdn: "",
    driverRole: "DRIVER",
    conductorName: "",
    conductorMsisdn: "",
    conductorRole: "CONDUCTOR",
    notes: "",
  });
  const [loadingParcels, setLoadingParcels] = useState<string[]>([]);
  const [leftBehindParcels, setLeftBehindParcels] = useState<OrgParcelRow[]>(
    [],
  );
  const [showLeftBehind, setShowLeftBehind] = useState(false);

  // Load left-behind parcels when shipment changes
  const loadLeftBehind = async (shipmentId: string) => {
    const result = await getLeftBehindParcels(shipmentId);
    if (result.ok) {
      setLeftBehindParcels(result.parcels);
      setShowLeftBehind(result.parcels.length > 0);
    }
  };

  // Create new shipment
  const handleCreateShipment = async () => {
    setScanError(null);
    if (
      !shipmentForm.vehiclePlate.trim() ||
      !shipmentForm.originLabel.trim() ||
      !shipmentForm.destinationLabel.trim()
    ) {
      setScanError("Vehicle plate, origin, and destination are required.");
      return;
    }

    const crew: DispatchCrewInput[] = [];
    if (shipmentForm.driverName.trim()) {
      crew.push({
        name: shipmentForm.driverName.trim(),
        msisdn: shipmentForm.driverMsisdn.trim() || null,
        role: shipmentForm.driverRole,
      });
    }
    if (shipmentForm.conductorName.trim()) {
      crew.push({
        name: shipmentForm.conductorName.trim(),
        msisdn: shipmentForm.conductorMsisdn.trim() || null,
        role: shipmentForm.conductorRole,
      });
    }

    const result = await createShipment({
      vehiclePlate: shipmentForm.vehiclePlate.trim(),
      vehicleType: shipmentForm.vehicleType,
      originLabel: shipmentForm.originLabel.trim(),
      destinationLabel: shipmentForm.destinationLabel.trim(),
      routeLabel: shipmentForm.routeLabel.trim() || undefined,
      notes: shipmentForm.notes.trim() || undefined,
      crew: crew.length > 0 ? crew : undefined,
    });

    if (result.ok) {
      setActiveShipment(result.shipment);
      setScanInput("");
      setScanError(null);
      if (result.shipment.routeLabel) {
        loadLeftBehind(result.shipment.id);
      }
    } else {
      setScanError(result.error);
    }
  };

  // Join active shipment
  const handleJoinShipment = async (shipmentId: string) => {
    setScanError(null);
    const result = await joinShipment(shipmentId);
    if (result.ok) {
      setActiveShipment(result.shipment);
      setScanInput("");
      setScanError(null);
      if (result.shipment.routeLabel) {
        loadLeftBehind(result.shipment.id);
      }
    } else {
      setScanError(result.error);
    }
  };

  // Scan and load parcel
  const handleScanLoad = async () => {
    if (!scanInput.trim() || !activeShipment) return;
    setScanError(null);
    setLoadingParcels((prev) => [...prev, scanInput.trim().toUpperCase()]);

    const result = await loadParcelToShipment(
      activeShipment.id,
      scanInput.trim().toUpperCase(),
    );
    setLoadingParcels((prev) =>
      prev.filter((code) => code !== scanInput.trim().toUpperCase()),
    );

    if (result.ok) {
      setActiveShipment(result.shipment);
      setScanInput("");
      // Notification is sent to receiver server-side
    } else {
      setScanError(result.error);
    }
  };

  // Start shipment (departed)
  const handleStartShipment = async () => {
    if (!activeShipment) return;
    setScanError(null);
    const result = await startShipment(activeShipment.id);
    if (result.ok) {
      setActiveShipment(result.shipment);
      setScanError(null);
    } else {
      setScanError(result.error);
    }
  };

  // Finish shipment (arrived)
  const handleFinishShipment = async () => {
    if (!activeShipment) return;
    setScanError(null);
    const result = await finishShipment(activeShipment.id);
    if (result.ok) {
      setActiveShipment(result.shipment);
      setScanError(null);
    } else {
      setScanError(result.error);
    }
  };

  // Cancel shipment
  const handleCancelShipment = async () => {
    if (!activeShipment) return;
    setScanError(null);
    if (window.confirm("Are you sure you want to cancel this shipment?")) {
      const result = await cancelShipment(activeShipment.id);
      if (result.ok) {
        setActiveShipment(null);
        setScanInput("");
        setScanError(null);
      } else {
        setScanError(result.error);
      }
    }
  };

  return (
    <>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 20px 40px",
          background: "var(--paper)",
          minHeight: "calc(100vh - 200px)",
        }}
      >
        {/* Simplified tab navigation - clearer visual hierarchy */}
        <div
          className="task-switch"
          role="tablist"
          aria-label="Counter task"
          style={{
            display: "flex",
            gap: "6px",
            padding: "6px",
            background: "#fff",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            width: "fit-content",
            marginBottom: "28px",
            boxShadow: "var(--sh-s)",
          }}
        >
          {hasCarry && (
            <button
              className={view === "receive" ? "is-active" : ""}
              onClick={() => setView("receive")}
              style={{
                padding: "12px 24px",
                border: "none",
                borderRadius: "var(--r-sm)",
                background: view === "receive" ? "var(--green)" : "transparent",
                color: view === "receive" ? "#fff" : "var(--tx-2)",
                fontWeight: view === "receive" ? "700" : "500",
                fontSize: "0.95rem",
                cursor: "pointer",
                boxShadow: view === "receive" ? "var(--sh-s)" : "none",
                transition: "all var(--dur-fast)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: "48px",
              }}
              onMouseEnter={(e) => {
                if (view !== "receive") {
                  e.currentTarget.style.background = "var(--paper)";
                }
              }}
              onMouseLeave={(e) => {
                if (view !== "receive") {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <Icon name="box" size={18} />
              <span>
                Receive
                {waiting.length > 0 && (
                  <span
                    style={{
                      marginLeft: 8,
                      background:
                        view === "receive"
                          ? "rgba(255,255,255,0.3)"
                          : "var(--green)",
                      color: "#fff",
                      fontSize: "0.75rem",
                      fontWeight: "700",
                      padding: "3px 8px",
                      borderRadius: 12,
                      display: "inline-block",
                      minWidth: 24,
                      textAlign: "center",
                    }}
                  >
                    {waiting.length}
                  </span>
                )}
              </span>
            </button>
          )}
          {hasDispatch && (
            <button
              className={view === "book" ? "is-active" : ""}
              onClick={() => setView("book")}
              style={{
                padding: "12px 24px",
                border: "none",
                borderRadius: "var(--r-sm)",
                background: view === "book" ? "var(--green)" : "transparent",
                color: view === "book" ? "#fff" : "var(--tx-2)",
                fontWeight: view === "book" ? "700" : "500",
                fontSize: "0.95rem",
                cursor: "pointer",
                boxShadow: view === "book" ? "var(--sh-s)" : "none",
                transition: "all var(--dur-fast)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: "48px",
              }}
              onMouseEnter={(e) => {
                if (view !== "book") {
                  e.currentTarget.style.background = "var(--paper)";
                }
              }}
              onMouseLeave={(e) => {
                if (view !== "book") {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <Icon name="truck" size={18} />
              <span>New Shipment</span>
            </button>
          )}
          <button
            className={view === "labels" ? "is-active" : ""}
            onClick={() => setView("labels")}
            style={{
              padding: "12px 24px",
              border: "none",
              borderRadius: "var(--r-sm)",
              background: view === "labels" ? "var(--green)" : "transparent",
              color: view === "labels" ? "#fff" : "var(--tx-2)",
              fontWeight: view === "labels" ? "700" : "500",
              fontSize: "0.95rem",
              cursor: "pointer",
              boxShadow: view === "labels" ? "var(--sh-s)" : "none",
              transition: "all var(--dur-fast)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: "48px",
            }}
            onMouseEnter={(e) => {
              if (view !== "labels") {
                e.currentTarget.style.background = "var(--paper)";
              }
            }}
            onMouseLeave={(e) => {
              if (view !== "labels") {
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            <Icon name="tag" size={18} />
            <span>
              Labels
              <span
                style={{
                  marginLeft: 8,
                  background:
                    view === "labels"
                      ? "rgba(255,255,255,0.3)"
                      : "var(--blue-t)",
                  color: view === "labels" ? "#fff" : "var(--blue)",
                  fontSize: "0.75rem",
                  fontWeight: "700",
                  padding: "3px 8px",
                  borderRadius: 12,
                  display: "inline-block",
                  minWidth: 24,
                  textAlign: "center",
                }}
              >
                {labelCounts.blank ?? 0}
              </span>
            </span>
          </button>
        </div>
        {view !== "labels" && (
          <div style={{ marginBottom: "24px" }}>
            <ScanEverythingBar
              canCarry={hasCarry}
              canDispatch={hasDispatch}
              emptyLabels={labels
                .filter((label) => label.state === "blank")
                .map((label) => ({
                  code: label.code,
                  sig: label.sig || undefined,
                }))}
              orgName={orgName}
              orgLogoUrl={orgLogoUrl}
              onLoadLabel={(code) => {
                // Scanning handled by scan bar
              }}
              onReceive={(reference) => {
                // Handled by receive view
                return Promise.resolve({
                  ok: false,
                  error:
                    "The front-desk section is not available on this session.",
                });
              }}
            />
          </div>
        )}
        {hasCarry ? (
          <div hidden={view !== "receive"}>
            <FrontDeskClient
              ref={deskRef}
              waiting={waiting}
              orgName={orgName}
              orgLogoUrl={orgLogoUrl}
            />
          </div>
        ) : null}
        {canDispatch ? (
          <div hidden={view !== "book"}>
            <ShipmentPanel
              activeShipment={activeShipment}
              scanInput={scanInput}
              setScanInput={setScanInput}
              scanError={scanError}
              shipmentForm={shipmentForm}
              setShipmentForm={setShipmentForm}
              loadingParcels={loadingParcels}
              leftBehindParcels={leftBehindParcels}
              showLeftBehind={showLeftBehind}
              onCreateShipment={handleCreateShipment}
              onScanLoad={handleScanLoad}
              onStartShipment={handleStartShipment}
              onFinishShipment={handleFinishShipment}
              onCancelShipment={handleCancelShipment}
              onJoinShipment={handleJoinShipment}
              announce={announce}
            />
          </div>
        ) : null}
        <div hidden={view !== "labels"}>
          <div className="counter-workspace-head">
            <div>
              <p className="kicker">Counter</p>
              <h2>Label stock</h2>
              <p>
                Choose labels to print, find a code, or prepare a label for
                booking.
              </p>
            </div>
          </div>
          <OrgLabelsClient
            labels={labels}
            counts={labelCounts}
            batches={labelBatches}
            state={labelState}
            canManage={canDispatch}
            orgName={orgName}
            orgLogoUrl={orgLogoUrl}
            baseHref="/parcel-org/counter?tab=labels"
          />
        </div>
      </div>
    </>
  );
}

// ── Shipment Panel Component ───────────────────────────────────────────
//
// A unified interface for managing shipments (vehicle movements) from
// the counter. Create new shipments, join active ones, and load parcels
// as they're scanned.

function ShipmentPanel({
  activeShipment,
  scanInput,
  setScanInput,
  scanError,
  shipmentForm,
  setShipmentForm,
  loadingParcels,
  leftBehindParcels,
  showLeftBehind,
  onCreateShipment,
  onScanLoad,
  onStartShipment,
  onFinishShipment,
  onCancelShipment,
  onJoinShipment,
  announce,
}: {
  activeShipment: ShipmentView | null;
  scanInput: string;
  setScanInput: (v: string) => void;
  scanError: string | null;
  shipmentForm: any;
  setShipmentForm: (f: any) => void;
  loadingParcels: string[];
  leftBehindParcels: OrgParcelRow[];
  showLeftBehind: boolean;
  onCreateShipment: () => void;
  onScanLoad: () => void;
  onStartShipment: () => void;
  onFinishShipment: () => void;
  onCancelShipment: () => void;
  onJoinShipment: (id: string) => void;
  announce: (msg: string, politeness?: "polite" | "assertive") => void;
}) {
  const activeShipmentsList = [
    {
      id: "1",
      vehiclePlate: "KDA 123X",
      originLabel: "Nairobi",
      destinationLabel: "Mombasa",
      status: "OPEN",
      loadedCount: 5,
      expectedCount: 12,
    },
    {
      id: "2",
      vehiclePlate: "KCX 456Y",
      originLabel: "Kisumu",
      destinationLabel: "Nairobi",
      status: "OPEN",
      loadedCount: 3,
      expectedCount: 8,
    },
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1.5px solid var(--line)",
    borderRadius: 8,
    marginTop: 4,
    fontSize: ".95rem",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: "600",
    transition: "all 0.2s",
  };

  // Status pills
  const statusPill = (status: string) => {
    const styles: Record<string, React.CSSProperties> = {
      OPEN: { background: "var(--blue-t)", color: "var(--blue)" },
      IN_TRANSIT: { background: "var(--navy-t)", color: "var(--navy)" },
      DEPARTED: { background: "var(--green-t)", color: "var(--green)" },
      ARRIVED: { background: "var(--gray-t)", color: "var(--tx-2)" },
    };
    const style = styles[status] || styles.OPEN;
    return (
      <span
        style={{
          display: "inline-block",
          padding: "4px 12px",
          borderRadius: 20,
          fontSize: "0.75rem",
          fontWeight: "600",
          textTransform: "uppercase",
          ...style,
        }}
      >
        {status.replace(/_/g, " ")}
      </span>
    );
  };

  if (!activeShipment) {
    // Create or join shipment view
    return (
      <div className="card" style={{ maxWidth: 900 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "var(--navy-t)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="truck" size={32} style={{ color: "var(--navy)" }} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.4rem" }}>New Shipment</h3>
            <p className="sub" style={{ margin: 4 }}>
              Create a new shipment or join an active one to start loading
              parcels.
            </p>
          </div>
        </div>

        {/* Quick join section */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px",
            background: "var(--navy-5)",
            borderRadius: 12,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--green-t)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="link" size={20} style={{ color: "var(--green)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <strong style={{ display: "block", marginBottom: 4 }}>
              Join Active Shipment
            </strong>
            <p className="sub" style={{ margin: 0 }}>
              Load parcels into an existing vehicle movement
            </p>
          </div>
          <button
            style={{
              ...buttonStyle,
              background: "var(--green)",
              color: "#fff",
              padding: "10px 16px",
            }}
            onClick={() => announce("Join shipment mode coming soon", "polite")}
          >
            Join
          </button>
        </div>

        {/* Create form */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <h4
            style={{
              margin: "0 0 16px",
              color: "var(--tx-3)",
              fontSize: "0.85rem",
            }}
          >
            CREATE NEW SHIPMENT
          </h4>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <label className="sub">
              <span style={{ fontWeight: "600" }}>Vehicle plate</span>
              <input
                style={inputStyle}
                value={shipmentForm.vehiclePlate}
                onChange={(e) =>
                  setShipmentForm({
                    ...shipmentForm,
                    vehiclePlate: e.target.value,
                  })
                }
                placeholder="e.g. KDA 123X"
              />
            </label>
            <label className="sub">
              <span style={{ fontWeight: "600" }}>Vehicle type</span>
              <select
                style={inputStyle}
                value={shipmentForm.vehicleType}
                onChange={(e) =>
                  setShipmentForm({
                    ...shipmentForm,
                    vehicleType: e.target.value,
                  })
                }
              >
                {["BODA", "BICYCLE", "TUKTUK", "VAN", "TRUCK"].map((v) => (
                  <option key={v} value={v}>
                    {v.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="sub">
              <span style={{ fontWeight: "600" }}>Origin</span>
              <input
                style={inputStyle}
                value={shipmentForm.originLabel}
                onChange={(e) =>
                  setShipmentForm({
                    ...shipmentForm,
                    originLabel: e.target.value,
                  })
                }
                placeholder="Departure location"
              />
            </label>
            <label className="sub">
              <span style={{ fontWeight: "600" }}>Destination</span>
              <input
                style={inputStyle}
                value={shipmentForm.destinationLabel}
                onChange={(e) =>
                  setShipmentForm({
                    ...shipmentForm,
                    destinationLabel: e.target.value,
                  })
                }
                placeholder="Final destination"
              />
            </label>
            <label className="sub">
              <span style={{ fontWeight: "600" }}>Route</span>
              <input
                style={inputStyle}
                value={shipmentForm.routeLabel}
                onChange={(e) =>
                  setShipmentForm({
                    ...shipmentForm,
                    routeLabel: e.target.value,
                  })
                }
                placeholder="Route name (optional)"
              />
            </label>
          </div>

          {/* Crew section */}
          <div
            style={{
              marginTop: 16,
              padding: "16px",
              background: "var(--blue-5)",
              borderRadius: 12,
            }}
          >
            <strong
              style={{
                display: "block",
                marginBottom: 12,
                color: "var(--navy)",
              }}
            >
              <Icon name="users" size={16} /> Driver & Crew
            </strong>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 10,
              }}
            >
              <label className="sub">
                <span style={{ fontWeight: "600" }}>Driver Name</span>
                <input
                  style={inputStyle}
                  value={shipmentForm.driverName}
                  onChange={(e) =>
                    setShipmentForm({
                      ...shipmentForm,
                      driverName: e.target.value,
                    })
                  }
                  placeholder="Driver name"
                />
              </label>
              <label className="sub">
                <span style={{ fontWeight: "600" }}>Driver Phone</span>
                <input
                  style={inputStyle}
                  value={shipmentForm.driverMsisdn}
                  onChange={(e) =>
                    setShipmentForm({
                      ...shipmentForm,
                      driverMsisdn: e.target.value,
                    })
                  }
                  placeholder="+2547..."
                />
              </label>
              <label className="sub">
                <span style={{ fontWeight: "600" }}>Conductor Name</span>
                <input
                  style={inputStyle}
                  value={shipmentForm.conductorName}
                  onChange={(e) =>
                    setShipmentForm({
                      ...shipmentForm,
                      conductorName: e.target.value,
                    })
                  }
                  placeholder="Conductor (optional)"
                />
              </label>
              <label className="sub">
                <span style={{ fontWeight: "600" }}>Conductor Phone</span>
                <input
                  style={inputStyle}
                  value={shipmentForm.conductorMsisdn}
                  onChange={(e) =>
                    setShipmentForm({
                      ...shipmentForm,
                      conductorMsisdn: e.target.value,
                    })
                  }
                  placeholder="+2547... (optional)"
                />
              </label>
            </div>
          </div>

          <label className="sub" style={{ display: "block", marginTop: 16 }}>
            <span style={{ fontWeight: "600" }}>Notes</span>
            <textarea
              style={{ ...inputStyle, minHeight: 60 }}
              value={shipmentForm.notes}
              onChange={(e) =>
                setShipmentForm({ ...shipmentForm, notes: e.target.value })
              }
              placeholder="Any special instructions..."
            />
          </label>

          {scanError && (
            <div
              role="alert"
              style={{
                background: "var(--red-5)",
                border: "1px solid var(--red)",
                borderRadius: 8,
                padding: "12px",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon
                name="alert-circle"
                size={20}
                style={{ color: "var(--red)" }}
              />
              <p style={{ margin: 0, color: "var(--red)", fontSize: ".9rem" }}>
                {scanError}
              </p>
            </div>
          )}

          <button
            type="button"
            className="btn btn-p"
            style={{
              ...buttonStyle,
              background: "var(--navy)",
              color: "#fff",
              width: "100%",
              padding: "12px 24px",
              fontSize: "1rem",
            }}
            onClick={onCreateShipment}
          >
            <Icon name="plus-circle" size={20} style={{ marginRight: 8 }} />
            Create Shipment
          </button>
        </div>

        {/* Active shipments quick list */}
        {activeShipmentsList.length > 0 && (
          <div
            style={{
              marginTop: 24,
              borderTop: "1px solid var(--line)",
              paddingTop: 20,
            }}
          >
            <strong style={{ display: "block", marginBottom: 12 }}>
              Active Shipments
            </strong>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {activeShipmentsList.map((s) => (
                <div
                  key={s.id}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: 16,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    background: "#fff",
                  }}
                  onClick={() => onJoinShipment(s.id)}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <span
                      className="mono"
                      style={{ fontWeight: "600", fontSize: "1.1rem" }}
                    >
                      {s.vehiclePlate}
                    </span>
                    {statusPill(s.status)}
                  </div>
                  <div style={{ color: "var(--tx-2)", fontSize: ".9rem" }}>
                    <p style={{ margin: 0 }}>
                      {s.originLabel} → {s.destinationLabel}
                    </p>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      padding: "6px 10px",
                      background: "var(--navy-5)",
                      borderRadius: 6,
                      fontSize: ".8rem",
                      color: "var(--navy)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Icon name="package" size={14} />
                    {s.loadedCount} / {s.expectedCount} parcels
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Shipment active - loading parcels view
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "var(--green-t)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="truck" size={32} style={{ color: "var(--green)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: "1.4rem" }}>
            {activeShipment.originLabel} → {activeShipment.destinationLabel}
          </h3>
          <p className="sub" style={{ margin: "4px 0 8px" }}>
            {activeShipment.vehiclePlate}{" "}
            {activeShipment.vehicleType
              ? `· ${activeShipment.vehicleType}`
              : ""}{" "}
            {activeShipment.routeLabel ? `· ${activeShipment.routeLabel}` : ""}
          </p>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {statusPill(activeShipment.status)}
            {activeShipment.driverName && (
              <span
                style={{
                  fontSize: ".85rem",
                  color: "var(--tx-3)",
                }}
              >
                Driver: {activeShipment.driverName}
              </span>
            )}
            {activeShipment.conductorName && (
              <span
                style={{
                  fontSize: ".85rem",
                  color: "var(--tx-3)",
                }}
              >
                Conductor: {activeShipment.conductorName}
              </span>
            )}
          </div>
        </div>
        <div
          className="kpi g"
          style={{
            minWidth: 140,
            textAlign: "right",
          }}
        >
          <span className="l" style={{ fontSize: ".8rem" }}>
            Loaded
          </span>
          <span
            className="n"
            style={{
              fontSize: "1.8rem",
              fontWeight: "700",
              color: "var(--green)",
              display: "block",
              lineHeight: "1.1",
            }}
          >
            {activeShipment.loadedCount}
          </span>
          <span
            className="l"
            style={{ fontSize: ".75rem", color: "var(--tx-3)" }}
          >
            / {activeShipment.expectedCount} parcels
          </span>
        </div>
      </div>

      {/* Route-based missing parcels */}
      {showLeftBehind && leftBehindParcels.length > 0 && (
        <div
          style={{
            background: "var(--amber-5)",
            border: "1px solid var(--amber)",
            borderRadius: 12,
            padding: "16px",
            marginBottom: 20,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--amber-t)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon
              name="alert-circle"
              size={24}
              style={{ color: "var(--amber)" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <strong
              style={{
                display: "block",
                marginBottom: 4,
                color: "var(--amber)",
              }}
            >
              Left Behind Parcels for This Route
            </strong>
            <p className="sub" style={{ margin: 0, color: "var(--tx-2)" }}>
              {leftBehindParcels.length} parcel
              {leftBehindParcels.length === 1 ? "" : "s"} scheduled for this
              route are not yet loaded.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 8,
              }}
            >
              {leftBehindParcels.map((p) => (
                <span
                  key={p.code}
                  style={{
                    background: "var(--amber)",
                    color: "#fff",
                    padding: "4px 10px",
                    borderRadius: 16,
                    fontSize: ".8rem",
                  }}
                >
                  {p.code}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Scan to load parcels */}
      <div
        style={{
          padding: "16px",
          background: "var(--navy-5)",
          borderRadius: 12,
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="qr" size={20} style={{ color: "var(--navy)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            className="mono"
            style={{ ...inputStyle, border: "none", background: "#fff" }}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onScanLoad();
              }
            }}
            placeholder="Scan parcel label to load onto vehicle"
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          className="btn btn-p"
          onClick={onScanLoad}
          disabled={!scanInput.trim() || loadingParcels.length > 0}
          style={{
            background: "var(--green)",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontWeight: "600",
          }}
        >
          {loadingParcels.length > 0 ? (
            <>
              <Icon name="loader" size={16} style={{ marginRight: 8 }} />
              Loading...
            </>
          ) : (
            <>
              <Icon name="package" size={16} style={{ marginRight: 8 }} />
              Load
            </>
          )}
        </button>
      </div>

      {scanError && (
        <div
          role="alert"
          style={{
            background: "var(--red-5)",
            border: "1px solid var(--red)",
            borderRadius: 8,
            padding: "12px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="alert-circle" size={20} style={{ color: "var(--red)" }} />
          <p style={{ margin: 0, color: "var(--red)", fontSize: ".9rem" }}>
            {scanError}
          </p>
        </div>
      )}

      {/* Shipment actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 16,
          flexWrap: "wrap",
          borderTop: "1px solid var(--line)",
          paddingTop: 20,
        }}
      >
        {activeShipment.status === "OPEN" && (
          <button
            type="button"
            className="btn btn-p"
            onClick={onStartShipment}
            style={{
              background: "var(--green)",
              color: "#fff",
              padding: "12px 20px",
              borderRadius: 8,
            }}
          >
            <Icon name="play-circle" size={18} style={{ marginRight: 8 }} />
            Start Shipment (Depart)
          </button>
        )}
        {activeShipment.status === "DEPARTED" && (
          <button
            type="button"
            className="btn btn-p"
            onClick={onFinishShipment}
            style={{
              background: "var(--navy)",
              color: "#fff",
              padding: "12px 20px",
              borderRadius: 8,
            }}
          >
            <Icon name="check-circle" size={18} style={{ marginRight: 8 }} />
            Finish Shipment (Arrive)
          </button>
        )}
        <button
          type="button"
          className="btn btn-o"
          onClick={onCancelShipment}
          style={{
            padding: "12px 20px",
            borderRadius: 8,
            color: "var(--red)",
            borderColor: "var(--red)",
          }}
        >
          Cancel Shipment
        </button>
      </div>
    </div>
  );
}
