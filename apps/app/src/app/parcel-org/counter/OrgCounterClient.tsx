"use client";

import { useRef, useState } from "react";
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
  // Default to booking unless only carry capability exists
  const [view, setView] = useState<"receive" | "book" | "labels">(
    initialTab === "receive" && !canCarry
      ? "book"
      : initialTab === "book"
        ? "book"
        : initialTab,
  );

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
  return (
    <>
      {/* Simplified tab navigation - clearer visual hierarchy */}
      <div
        className="task-switch"
        role="tablist"
        aria-label="Counter task"
        style={{
          display: "flex",
          gap: "4px",
          padding: "8px",
          background: "#fff",
          border: "1px solid var(--line)",
          borderRadius: "12px",
          width: "fit-content",
          marginBottom: "24px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        }}
      >
        {canCarry && (
          <button
            className={view === "receive" ? "is-active" : ""}
            onClick={() => setView("receive")}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: "8px",
              background: view === "receive" ? "#fff" : "transparent",
              color: view === "receive" ? "var(--navy)" : "var(--tx-2)",
              fontWeight: view === "receive" ? "700" : "400",
              fontSize: "0.9rem",
              cursor: "pointer",
              boxShadow: view === "receive" ? "var(--sh-s)" : "none",
              transition: "all 0.2s",
            }}
          >
            <Icon name="box" size={16} />
            <span>
              Receive
              {waiting.length > 0 && (
                <span
                  style={{
                    marginLeft: "6px",
                    background: "var(--green)",
                    color: "white",
                    fontSize: "0.7rem",
                    padding: "2px 6px",
                    borderRadius: "10px",
                  }}
                >
                  {waiting.length}
                </span>
              )}
            </span>
          </button>
        )}
        {canDispatch && (
          <button
            className={view === "book" ? "is-active" : ""}
            onClick={() => setView("book")}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: "8px",
              background: view === "book" ? "#fff" : "transparent",
              color: view === "book" ? "var(--navy)" : "var(--tx-2)",
              fontWeight: view === "book" ? "700" : "400",
              fontSize: "0.9rem",
              cursor: "pointer",
              boxShadow: view === "book" ? "var(--sh-s)" : "none",
              transition: "all 0.2s",
            }}
          >
            <Icon name="plus" size={16} />
            <span>New Shipment</span>
          </button>
        )}
        <button
          className={view === "labels" ? "is-active" : ""}
          onClick={() => setView("labels")}
          style={{
            padding: "10px 20px",
            border: "none",
            borderRadius: "8px",
            background: view === "labels" ? "#fff" : "transparent",
            color: view === "labels" ? "var(--navy)" : "var(--tx-2)",
            fontWeight: view === "labels" ? "700" : "400",
            fontSize: "0.9rem",
            cursor: "pointer",
            boxShadow: view === "labels" ? "var(--sh-s)" : "none",
            transition: "all 0.2s",
          }}
        >
          <Icon name="tag" size={16} />
          <span>
            Labels
            <span
              style={{
                marginLeft: "6px",
                background: "var(--blue-t)",
                color: "var(--blue)",
                fontSize: "0.7rem",
                padding: "2px 6px",
                borderRadius: "10px",
              }}
            >
              {labelCounts.blank ?? 0}
            </span>
          </span>
        </button>
      </div>
      {view !== "labels" && (
        <ScanEverythingBar
          canCarry={canCarry}
          canDispatch={canDispatch}
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
      )}
      {canCarry ? (
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
          <SharedCounterForm
            ref={formRef}
            initialCode={initialCode}
            pricing={pricing}
            volumetricDivisor={volumetricDivisor}
            actions={actions}
            orgName={orgName}
            orgLogoUrl={orgLogoUrl}
            links={{
              nextHref: "/parcel-org/counter",
              parcelHref: (code) => `/parcel-org?q=${encodeURIComponent(code)}`,
              labelsHref: "/parcel-org/counter?tab=labels",
            }}
            announce={announce}
            scanbox={false}
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
    </>
  );
}
