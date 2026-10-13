"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useId, useState, useTransition } from "react";
import { Icon, ParcelCapabilityPicker, RIDER_BASELINE, type IconName } from "@esoqo/ui";
import {
  actionCreateParcelOrg,
  actionUpdateParcelOrg,
  actionSearchEnterprises,
  actionCreateEnterprise,
  actionUploadParcelOrgLogo,
  actionListParcelOrgStaff,
  actionCreateParcelOrgManager,
  actionIssueParcelOrgStaffId,
  actionSearchParcelPeople,
  actionListBanks,
  actionValidateBankAccount,
  type ParcelOrg,
  type ParcelOrgInput,
  type ParcelOrgPayoutMethod,
  type EnterpriseLite,
  type ParcelOrgStaffRow,
  type OrgMemberInput,
  type CollectorLite,
  type Bank,
} from "../actions";
import { RoleField } from "../teams/RoleField";

/** The roles a courier company gets out of the box. A preset resolves to
 *  a fixed capability bundle; anything else is a custom title, and the
 *  permissions picker below is where its access is actually chosen. */
const PARCEL_STAFF_ROLES = ["MANAGER", "DISPATCHER", "RIDER"];
const isCustomRole = (role: string) => !PARCEL_STAFF_ROLES.includes(role);

/**
 * Panels shared by the courier-company register and a company's own page.
 *
 * They live here rather than inside CompaniesManager so the individual
 * company page can render the same team manager and profile form without
 * importing them out of a component named for the list.
 */

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

export const STATUSES: [value: string, label: string, hint: string][] = [
  ["DRAFT", "Draft", "Sign-in link is dead, no parcels route here"],
  ["ACTIVE", "Active", "Staff can sign in and carry parcels"],
  ["SUSPENDED", "Suspended", "No new work; parcels in flight continue"],
];

export const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1.5px solid var(--line)",
  borderRadius: 6,
  width: "100%",
};

export function kes(value?: string | null): string {
  if (value == null) return "KES 0";
  const n = Number(value);
  if (Number.isNaN(n)) return `KES ${value}`;
  return `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

export function statusPill(status: string) {
  return `pill ${status === "ACTIVE" ? "p-ok" : status === "DRAFT" ? "p-warn" : "p-bad"}`;
}

export function statusLabel(status: string): string {
  return STATUSES.find(([v]) => v === status)?.[1] ?? status;
}

/** A one-line summary of where a company's cut of a parcel is actually
 *  paid, automatically, at settlement — the single source of truth for
 *  "what M-Pesa/bank number is this company on", replacing the old
 *  separate (and never-synced) "Settlement M-Pesa" field. */
export function payoutSummary(org: ParcelOrg): string {
  switch (org.payoutMethod) {
    case "PHONE":
      return org.payoutMsisdn ? `M-Pesa — ${org.payoutMsisdn}` : "Not set";
    case "TILL":
      return org.payoutTillNumber
        ? `M-Pesa till — ${org.payoutTillNumber}`
        : "Not set";
    case "PAYBILL":
      return org.payoutPaybillNumber
        ? `M-Pesa paybill — ${org.payoutPaybillNumber}${
            org.payoutPaybillAccount ? ` / ${org.payoutPaybillAccount}` : ""
          }`
        : "Not set";
    case "BANK":
      return org.payoutBankAccountNumber
        ? `Bank — ${org.payoutBankAccountNumber}${
            org.payoutBankAccountName ? ` (${org.payoutBankAccountName})` : ""
          }`
        : "Not set";
    default:
      return "Not set (manual)";
  }
}

export function orgToInput(
  org: ParcelOrg,
  overrides: Partial<ParcelOrgInput> = {},
): ParcelOrgInput {
  return {
    name: org.name,
    slug: org.slug,
    status: org.status,
    contactPerson: org.contactPerson,
    contactPhone: org.contactPhone,
    contactEmail: org.contactEmail,
    settlementPhone: org.settlementPhone,
    commissionPct: org.commissionPct,
    acceptsWalkIn: org.acceptsWalkIn,
    acceptsCash: org.acceptsCash,
    offersTransport: org.offersTransport,
    lat: org.lat,
    lng: org.lng,
    locationHint: org.locationHint,
    openingHours: org.openingHours,
    logoStorageKey: org.logoStorageKey ?? null,
    logoUrl: org.logoUrl ?? null,
    brandAccent: org.brandAccent ?? null,
    payoutMethod: org.payoutMethod ?? null,
    payoutMsisdn: org.payoutMsisdn ?? null,
    payoutTillNumber: org.payoutTillNumber ?? null,
    payoutPaybillNumber: org.payoutPaybillNumber ?? null,
    payoutPaybillAccount: org.payoutPaybillAccount ?? null,
    payoutBankCode: org.payoutBankCode ?? null,
    payoutBankAccountNumber: org.payoutBankAccountNumber ?? null,
    payoutBankAccountName: org.payoutBankAccountName ?? null,
    ...overrides,
  };
}

const ACTIVITY_LABELS: Record<string, string> = {
  "parcel_org.created": "Company created",
  "parcel_org.updated": "Company profile updated",
  "parcel_org.staff_changed": "Team member changed",
  "parcel_org.staff_id_issued": "Esoqo ID issued",
  "parcel_org.pricing_changed": "Pricing changed",
};

export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action.replace(/[._]/g, " ");
}

export function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid var(--line)",
        borderRadius: 9,
        background: "#fff",
      }}
    >
      <span className="sub" style={{ display: "block", fontSize: ".72rem" }}>
        {label}
      </span>
      <span className="mono" style={{ fontSize: "1.1rem" }}>
        {value}
      </span>
    </div>
  );
}

/**
 * A summary card for one category of a company's data — a few numbers
 * and one way in, not the data itself.
 *
 * The company page used to render each category's full table inline
 * (every batch, every recent parcel, the whole team form) the moment
 * the page loaded — everything a company has, all at once, whether or
 * not that's what the admin came to look at. This is the "look before
 * you leap" step that was missing: see the shape of what's there,
 * then choose to go in.
 */
export function SummaryCard({
  icon, title, stats, href, cta,
}: {
  icon: IconName;
  title: string;
  stats: { label: string; value: string }[];
  href: Route;
  cta: string;
}) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name={icon} size={16} />{title}
      </strong>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {stats.map((s) => (
          <div key={s.label}>
            <span className="mono" style={{ fontSize: "1.3rem", display: "block" }}>{s.value}</span>
            <span className="sub" style={{ fontSize: ".72rem" }}>{s.label}</span>
          </div>
        ))}
      </div>
      <Link href={href} className="btn btn-o btn-sm" style={{ alignSelf: "flex-start", marginTop: "auto" }}>
        {cta} <Icon name="arrow-right" size={13} />
      </Link>
    </div>
  );
}

/**
 * A company's team, with the whole lifecycle in one place: add, edit the
 * role, suspend or restore, reset a PIN, and mint the Esoqo ID each
 * person signs in with. Used inline from the register (quick add) and on
 * the company's own page (full management).
 */
export function TeamManager({
  org,
  initialStaff,
  canEdit = true,
}: {
  org: ParcelOrg;
  initialStaff?: ParcelOrgStaffRow[];
  canEdit?: boolean;
}) {
  const [staff, setStaff] = useState<ParcelOrgStaffRow[] | null>(
    initialStaff ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [role, setRole] = useState("MANAGER");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [isContact, setIsContact] = useState(false);
  // Existing-person picker — a typeahead over anyone already on the
  // platform. Picking one links their Party instead of minting a new one;
  // adding someone not in the results goes through the phone field below.
  const [personQuery, setPersonQuery] = useState("");
  const [personResults, setPersonResults] = useState<CollectorLite[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<CollectorLite | null>(
    null,
  );
  const [personSearching, setPersonSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [issuing, setIssuing] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const ids = {
    name: useId(),
    pin: useId(),
    msisdn: useId(),
    role: useId(),
    person: useId(),
  };

  if (staff === null && !loading) {
    setLoading(true);
    void actionListParcelOrgStaff(org.id).then((rows) => {
      setStaff(rows);
      setLoading(false);
    });
  }

  // Debounced typeahead: search from 2 characters, ignore a response whose
  // query has already changed, and stop once someone's been picked.
  useEffect(() => {
    const term = personQuery.trim();
    if (selectedPerson || term.length < 2) {
      setPersonResults([]);
      setPersonSearching(false);
      return;
    }
    let cancelled = false;
    setPersonSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await actionSearchParcelPeople(term);
        if (!cancelled) setPersonResults(rows);
      } finally {
        if (!cancelled) setPersonSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [personQuery, selectedPerson]);

  function pickPerson(p: CollectorLite) {
    setSelectedPerson(p);
    setName(p.Name);
    setPersonQuery(p.Name);
    setPersonResults([]);
  }
  function pickRole(next: string) {
    setRole(next);
    // A fresh custom role starts from the RIDER floor rather than
    // nothing, so an owner can only add access on top, never accidentally
    // hand out less than the safe default.
    if (isCustomRole(next))
      setCapabilities((c) => (c.length ? c : [...RIDER_BASELINE]));
  }

  function clearPerson() {
    setSelectedPerson(null);
    setPersonQuery("");
  }

  async function refresh() {
    setStaff(await actionListParcelOrgStaff(org.id));
  }

  async function issue(s: ParcelOrgStaffRow) {
    setError(null);
    setIssuing(s.id);
    const result = await actionIssueParcelOrgStaffId(org.id, s.id);
    setIssuing(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
  }

  function toggleActive(s: ParcelOrgStaffRow) {
    setError(null);
    startTransition(async () => {
      const result = await actionCreateParcelOrgManager(org.id, {
        id: s.id,
        name: s.name,
        role: s.role,
        active: !s.active,
        isContact: s.isContact,
        partyId: s.partyId,
        stationId: s.stationId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    });
  }

  function add() {
    setError(null);
    if (isCustomRole(role) && !role.trim()) {
      setError("Type the custom role name");
      return;
    }
    const phone = msisdn.trim();
    if (!selectedPerson && !phone && pin.length < 4) {
      setError("Pick an existing person, set a PIN, or enter a phone number");
      return;
    }
    startTransition(async () => {
      const result = await actionCreateParcelOrgManager(org.id, {
        name: name.trim(),
        role,
        pin: pin || undefined,
        // A picked person already has an identity — link their Party and
        // never re-invite by phone. A new person goes through the phone
        // path, which creates them and mints their Esoqo ID.
        partyId: selectedPerson?.PartyID ?? null,
        msisdn: selectedPerson ? undefined : phone || undefined,
        isContact,
        // Preset role -> [] so a role change clears any stale custom set;
        // custom -> the picked permissions. Omitted entirely on paths that
        // don't touch roles so the backend leaves them alone.
        capabilities: isCustomRole(role) ? capabilities : [],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setPin("");
      setMsisdn("");
      setIsContact(false);
      clearPerson();
      setCapabilities([]);
      await refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <p className="sub" style={{ margin: "0 0 8px", fontSize: ".82rem" }}>
          They sign in at <span className="mono">/parcel-co/{org.slug}</span>
        </p>
        {staff === null ? (
          <p className="sub">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="sub">
            Nobody yet. Add a manager below and they can build out the rest of
            the team themselves.
          </p>
        ) : (
          <table className="tbl" style={{ fontSize: ".85rem" }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Sign-in ID / phone</th>
                <th>Status</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) =>
                editingId === s.id ? (
                  <tr key={s.id}>
                    <td
                      colSpan={5}
                      style={{ padding: 16, background: "var(--paper)" }}
                    >
                      <StaffEditForm
                        org={org}
                        member={s}
                        onSaved={() => {
                          setEditingId(null);
                          void refresh();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      {s.isContact && (
                        <span
                          className="pill p-ok"
                          style={{ marginLeft: 8, fontSize: ".68rem" }}
                        >
                          Contact
                        </span>
                      )}
                    </td>
                    <td className="sub">{s.role.toLowerCase()}</td>
                    <td>
                      {s.esoqoId ? (
                        <>
                          <span className="mono" style={{ display: "block" }}>
                            {s.esoqoId}
                          </span>
                          {s.msisdn && (
                            <span
                              className="mono sub"
                              style={{ display: "block" }}
                            >
                              {s.msisdn}
                            </span>
                          )}
                        </>
                      ) : s.msisdn ? (
                        <>
                          <span
                            className="sub"
                            style={{ display: "block", fontSize: ".78rem" }}
                          >
                            No Esoqo ID yet
                          </span>
                          <span
                            className="mono sub"
                            style={{ display: "block" }}
                          >
                            {s.msisdn}
                          </span>
                        </>
                      ) : s.partyId ? (
                        <span className="mono sub">
                          {s.partyId}
                          <br />
                          No phone on file
                        </span>
                      ) : (
                        <span className="sub">PIN only — no linked person</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${s.active ? "p-ok" : "p-warn"}`}>
                        {s.active ? "Can sign in" : "Suspended"}
                      </span>
                    </td>
                    {canEdit && (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {!s.esoqoId && s.msisdn && (
                          <button
                            className="btn btn-o btn-sm"
                            disabled={issuing === s.id}
                            onClick={() => void issue(s)}
                          >
                            {issuing === s.id ? "Issuing…" : "Issue ID"}
                          </button>
                        )}{" "}
                        <button
                          className="btn btn-o btn-sm"
                          onClick={() => setEditingId(s.id)}
                        >
                          Edit
                        </button>{" "}
                        <button
                          className="btn btn-o btn-sm"
                          disabled={pending}
                          onClick={() => toggleActive(s)}
                        >
                          {s.active ? "Suspend" : "Restore"}
                        </button>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <>
          <div style={{ display: "grid", gap: 6 }}>
            <label
              className="sub"
              htmlFor={ids.person}
              style={{ display: "block" }}
            >
              Add an existing person — search by name or phone
            </label>
            {selectedPerson ? (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "6px 8px",
                  border: "1.5px solid var(--line)",
                  borderRadius: 6,
                }}
              >
                <Icon name="user" size={14} />
                <span>
                  Linked to <strong>{selectedPerson.Name}</strong>
                  {selectedPerson.Msisdn ? (
                    <span className="mono sub"> · {selectedPerson.Msisdn}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="btn btn-o btn-sm"
                  style={{ marginLeft: "auto" }}
                  onClick={clearPerson}
                >
                  Change
                </button>
              </div>
            ) : (
              <input
                id={ids.person}
                style={inputStyle}
                value={personQuery}
                autoComplete="off"
                placeholder="Start typing a name or phone number"
                onChange={(e) => setPersonQuery(e.target.value)}
              />
            )}
            {!selectedPerson && personSearching && (
              <span className="sub" style={{ fontSize: ".78rem" }}>
                Searching…
              </span>
            )}
            {!selectedPerson && personResults.length > 0 && (
              <div style={{ display: "grid", gap: 4 }}>
                {personResults.map((p) => (
                  <button
                    type="button"
                    key={p.PartyID}
                    className="btn btn-o btn-sm"
                    style={{ justifyContent: "flex-start" }}
                    onClick={() => pickPerson(p)}
                  >
                    {p.Name}
                    {p.Msisdn ? ` — ${p.Msisdn}` : ""}
                  </button>
                ))}
              </div>
            )}
            {!selectedPerson &&
              personQuery.trim().length >= 2 &&
              !personSearching &&
              personResults.length === 0 && (
                <span className="sub" style={{ fontSize: ".78rem" }}>
                  Nobody matches. Enter their name and phone below to add them
                  as new — Esoqo will issue their ID.
                </span>
              )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <label
                className="sub"
                htmlFor={ids.name}
                style={{ display: "block", marginBottom: 4 }}
              >
                Name
              </label>
              <input
                id={ids.name}
                style={inputStyle}
                value={name}
                placeholder="e.g. Wanjiku"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <RoleField
              value={role}
              onChange={pickRole}
              presets={PARCEL_STAFF_ROLES}
            />
            <div>
              <label
                className="sub"
                htmlFor={ids.pin}
                style={{ display: "block", marginBottom: 4 }}
              >
                PIN
              </label>
              <input
                id={ids.pin}
                className="mono"
                style={inputStyle}
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            {!selectedPerson && (
              <div>
                <label
                  className="sub"
                  htmlFor={ids.msisdn}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  Phone (new person)
                </label>
                <input
                  id={ids.msisdn}
                  className="mono"
                  style={inputStyle}
                  placeholder="07XX XXX XXX"
                  value={msisdn}
                  onChange={(e) => setMsisdn(e.target.value)}
                />
              </div>
            )}
            <label
              className="sub"
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                paddingBottom: 8,
              }}
            >
              <input
                type="checkbox"
                checked={isContact}
                onChange={(e) => setIsContact(e.target.checked)}
              />
              Contact person
            </label>
            <button
              className="btn btn-p btn-sm"
              disabled={
                pending || !name.trim() || (isCustomRole(role) && !role.trim())
              }
              onClick={add}
            >
              {pending
                ? "Adding…"
                : selectedPerson
                  ? "Add to team"
                  : msisdn.trim()
                    ? "Send invite"
                    : "Add"}
            </button>
          </div>
          {isCustomRole(role) && (
            <ParcelCapabilityPicker
              value={capabilities}
              onChange={setCapabilities}
              disabled={pending}
            />
          )}
          <span className="sub" style={{ fontSize: ".78rem" }}>
            Pick someone already on Esoqo to link their existing identity, or
            type a new person&apos;s name and phone and Esoqo issues their ID on
            the spot. A phone number with a PIN gives them a full Esoqo account
            — they can sign in at /signin and at /parcel-co/{org.slug}. A PIN
            alone is a company-portal login only. Inviting by phone texts them a
            first PIN — typed above, or a temporary one when left blank — which
            they use to sign in and then reset. Tick &quot;Contact person&quot;
            on anyone senders should reach — several is fine. A custom role
            picks its own permissions above.
          </span>
        </>
      )}
      {error && (
        <p
          role="alert"
          style={{
            color: "var(--red)",
            fontSize: ".85rem",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <Icon name="alert-circle" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}

function StaffEditForm({
  org,
  member,
  onSaved,
  onCancel,
}: {
  org: ParcelOrg;
  member: ParcelOrgStaffRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [capabilities, setCapabilities] = useState<string[]>(
    member.capabilities ?? [],
  );
  const [active, setActive] = useState(member.active);
  const [isContact, setIsContact] = useState(member.isContact);
  const [pin, setPin] = useState("");
  const [msisdn, setMsisdn] = useState(member.msisdn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = {
    name: useId(),
    role: useId(),
    pin: useId(),
    msisdn: useId(),
    active: useId(),
    contact: useId(),
  };

  function pickRole(next: string) {
    setRole(next);
    if (isCustomRole(next))
      setCapabilities((c) => (c.length ? c : [...RIDER_BASELINE]));
  }

  function save() {
    setError(null);
    if (!name.trim()) {
      setError("Give this person a name");
      return;
    }
    if (isCustomRole(role) && !role.trim()) {
      setError("Type the custom role name");
      return;
    }
    startTransition(async () => {
      const result = await actionCreateParcelOrgManager(org.id, {
        id: member.id,
        name: name.trim(),
        role,
        active,
        isContact,
        partyId: member.partyId,
        stationId: member.stationId,
        pin: pin || undefined,
        msisdn: msisdn.trim() || undefined,
        // Always sent here, so switching a custom role back to a preset
        // clears its old permissions rather than leaving them behind.
        capabilities: isCustomRole(role) ? capabilities : [],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <label
            className="sub"
            htmlFor={ids.name}
            style={{ display: "block", marginBottom: 4 }}
          >
            Name
          </label>
          <input
            id={ids.name}
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <RoleField
          value={role}
          onChange={pickRole}
          presets={PARCEL_STAFF_ROLES}
        />
        <div>
          <label
            className="sub"
            htmlFor={ids.pin}
            style={{ display: "block", marginBottom: 4 }}
          >
            New PIN (leave blank to keep)
          </label>
          <input
            id={ids.pin}
            className="mono"
            style={inputStyle}
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div>
          <label
            className="sub"
            htmlFor={ids.msisdn}
            style={{ display: "block", marginBottom: 4 }}
          >
            Phone (for a /signin account)
          </label>
          <input
            id={ids.msisdn}
            className="mono"
            style={inputStyle}
            placeholder="07XX XXX XXX"
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
          />
        </div>
      </div>
      {isCustomRole(role) && (
        <ParcelCapabilityPicker
          value={capabilities}
          onChange={setCapabilities}
          disabled={pending}
        />
      )}
      <label
        className="sub"
        style={{ display: "flex", gap: 8, alignItems: "center" }}
      >
        <input
          id={ids.active}
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Can sign in
      </label>
      <label
        className="sub"
        style={{ display: "flex", gap: 8, alignItems: "center" }}
      >
        <input
          id={ids.contact}
          type="checkbox"
          checked={isContact}
          onChange={(e) => setIsContact(e.target.checked)}
        />
        Contact person
      </label>
      {error && (
        <p
          role="alert"
          style={{
            color: "var(--red)",
            fontSize: ".85rem",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <Icon name="alert-circle" size={14} />
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-p btn-sm"
          disabled={pending || !name.trim()}
          onClick={save}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          className="btn btn-o btn-sm"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function OrgForm({
  initial,
  submitLabel,
  onDone,
  onCancel,
}: {
  initial?: ParcelOrg;
  submitLabel: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [status, setStatus] = useState(initial?.status ?? "DRAFT");
  const [commissionPct, setCommissionPct] = useState(
    String(initial?.commissionPct ?? 15),
  );
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  // Where this company's cut of a parcel is actually paid, automatically,
  // the moment it's settled. "" (no method) leaves new payouts MANUAL, for
  // finance to clear by hand on the manual-payouts page. settlementPhone
  // (the legacy, display-only "Settlement M-Pesa" column) is no longer
  // separately editable — it's kept in sync with payoutMsisdn below so a
  // company's M-Pesa number only has to be entered once.
  const [payoutMethod, setPayoutMethod] = useState(
    initial?.payoutMethod ?? "",
  );
  const [payoutMsisdn, setPayoutMsisdn] = useState(
    initial?.payoutMsisdn ?? "",
  );
  const [payoutTillNumber, setPayoutTillNumber] = useState(
    initial?.payoutTillNumber ?? "",
  );
  const [payoutPaybillNumber, setPayoutPaybillNumber] = useState(
    initial?.payoutPaybillNumber ?? "",
  );
  const [payoutPaybillAccount, setPayoutPaybillAccount] = useState(
    initial?.payoutPaybillAccount ?? "",
  );
  const [payoutBankCode, setPayoutBankCode] = useState(
    initial?.payoutBankCode ?? "",
  );
  const [payoutBankAccountNumber, setPayoutBankAccountNumber] = useState(
    initial?.payoutBankAccountNumber ?? "",
  );
  const [payoutBankAccountName, setPayoutBankAccountName] = useState(
    initial?.payoutBankAccountName ?? "",
  );
  // The PesaLink participant list the bank dropdown below is built from,
  // and the state of validating the bank/account-number pair currently
  // entered — see validateBankAccount. A bank account can only be saved
  // once it's been validated for the exact code+number pair on screen;
  // changing either after a successful validation un-validates it, same
  // "don't trust a stale check" rule save()'s own guard follows.
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankValidating, setBankValidating] = useState(false);
  const [bankValidationError, setBankValidationError] = useState<
    string | null
  >(null);
  const [validatedBankKey, setValidatedBankKey] = useState(
    initial?.payoutMethod === "BANK" && initial?.payoutBankAccountName
      ? `${initial.payoutBankCode ?? ""}:${initial.payoutBankAccountNumber ?? ""}`
      : "",
  );
  const isBankAccountValidated =
    !!payoutBankCode &&
    !!payoutBankAccountNumber.trim() &&
    validatedBankKey === `${payoutBankCode}:${payoutBankAccountNumber.trim()}`;
  useEffect(() => {
    void actionListBanks().then(setBanks);
  }, []);
  function validateBankAccount() {
    setBankValidationError(null);
    if (!payoutBankCode || !payoutBankAccountNumber.trim()) {
      setBankValidationError("Pick a bank and enter the account number first.");
      return;
    }
    setBankValidating(true);
    void actionValidateBankAccount(payoutBankCode, payoutBankAccountNumber.trim())
      .then((result) => {
        if (result.ok) {
          setPayoutBankAccountName(result.accountName);
          setValidatedBankKey(`${payoutBankCode}:${payoutBankAccountNumber.trim()}`);
        } else {
          setPayoutBankAccountName("");
          setBankValidationError(result.error);
        }
      })
      .finally(() => setBankValidating(false));
  }
  const [enterpriseId, setEnterpriseId] = useState(initial?.enterpriseId ?? "");
  const [entQuery, setEntQuery] = useState("");
  const [entResults, setEntResults] = useState<EnterpriseLite[]>([]);
  const [entSearched, setEntSearched] = useState(false);
  const [entName, setEntName] = useState("");
  const [creatingEnt, setCreatingEnt] = useState(false);
  const [newEntName, setNewEntName] = useState("");
  const [entError, setEntError] = useState<string | null>(null);
  const [entPending, startEntTransition] = useTransition();
  const [acceptsWalkIn, setAcceptsWalkIn] = useState(
    initial?.acceptsWalkIn ?? false,
  );
  // Cash defaults on: a company that predates the switch keeps taking
  // cash, matching the DB default.
  const [acceptsCash, setAcceptsCash] = useState(initial?.acceptsCash ?? true);
  const [offersTransport, setOffersTransport] = useState(
    initial?.offersTransport ?? false,
  );
  const [locationHint, setLocationHint] = useState(initial?.locationHint ?? "");
  const [openingHours, setOpeningHours] = useState(initial?.openingHours ?? "");
  const [lat, setLat] = useState(
    initial?.lat != null ? String(initial.lat) : "",
  );
  const [lng, setLng] = useState(
    initial?.lng != null ? String(initial.lng) : "",
  );
  // Co-branded label assets. logoUrl prints centered in the label
  // header; empty = Esoqo branding alone (the fallback every label
  // prints with when a company hasn't entered branding).
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [logoStorageKey, setLogoStorageKey] = useState(
    initial?.logoStorageKey ?? "",
  );
  const [brandAccent, setBrandAccent] = useState(initial?.brandAccent ?? "");
  const [logoPending, startLogoTransition] = useTransition();
  const [logoError, setLogoError] = useState<string | null>(null);
  // Roster entered while onboarding. Create-only: an existing company's
  // team is edited through TeamManager, where each row has an id to
  // update in place.
  const [members, setMembers] = useState<OrgMemberInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = {
    name: useId(),
    slug: useId(),
    status: useId(),
    commission: useId(),
    phone: useId(),
    ent: useId(),
    newEnt: useId(),
    walkIn: useId(),
    transport: useId(),
    location: useId(),
    hours: useId(),
    brand: useId(),
    payoutMethod: useId(),
    payoutMsisdn: useId(),
    payoutTill: useId(),
    payoutPaybillNumber: useId(),
    payoutPaybillAccount: useId(),
    payoutBankCode: useId(),
    payoutBankAccountNumber: useId(),
    payoutBankAccountName: useId(),
  };

  function addMember() {
    setMembers((prev) => [
      ...prev,
      { name: "", role: "RIDER", pin: "", msisdn: "", isContact: false },
    ]);
  }
  function updateMember(i: number, patch: Partial<OrgMemberInput>) {
    setMembers((prev) =>
      prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    );
  }
  function removeMember(i: number) {
    setMembers((prev) => prev.filter((_, idx) => idx !== i));
  }

  function searchEnterprises(q: string) {
    setEntQuery(q);
    setEntSearched(false);
    if (!q.trim()) {
      setEntResults([]);
      return;
    }
    void actionSearchEnterprises(q).then((results) => {
      setEntResults(results);
      setEntSearched(true);
    });
  }

  function createBusiness() {
    setEntError(null);
    startEntTransition(async () => {
      const result = await actionCreateEnterprise(newEntName);
      if (!result.ok) {
        setEntError(result.error);
        return;
      }
      setEnterpriseId(result.id);
      setEntName(result.name);
      setCreatingEnt(false);
      setNewEntName("");
      setEntResults([]);
    });
  }

  function save() {
    setError(null);
    if (!initial) {
      for (const m of members) {
        if (!m.name.trim()) continue;
        const hasCredential =
          (m.pin ?? "").length >= 4 ||
          !!m.msisdn?.trim() ||
          !!m.esokoId?.trim();
        if (!hasCredential) {
          setError(
            `${m.name.trim()} needs a PIN of 4+ digits, a phone number, or an Esoqo ID.`,
          );
          return;
        }
      }
    }
    const accent = brandAccent.trim();
    if (accent && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent)) {
      setError(
        "Brand accent must be a hex colour like #1a73e8 — or leave it empty.",
      );
      return;
    }
    if (payoutMethod === "PHONE" && !payoutMsisdn.trim()) {
      setError("Give the M-Pesa number payouts should go to.");
      return;
    }
    if (payoutMethod === "TILL" && !payoutTillNumber.trim()) {
      setError("Give the till number payouts should go to.");
      return;
    }
    if (payoutMethod === "PAYBILL" && !payoutPaybillNumber.trim()) {
      setError("Give the paybill number payouts should go to.");
      return;
    }
    if (payoutMethod === "BANK" && !payoutBankCode.trim()) {
      setError("Pick the bank payouts should go to.");
      return;
    }
    if (payoutMethod === "BANK" && !payoutBankAccountNumber.trim()) {
      setError("Give the bank account number payouts should go to.");
      return;
    }
    if (payoutMethod === "BANK" && !isBankAccountValidated) {
      setError(
        "Validate the bank account (it passes Co-op's PesaLink check) before saving.",
      );
      return;
    }
    const input: ParcelOrgInput = {
      // Only sent on create — an update never moves a company to a
      // different owning business, which would silently transfer every
      // parcel it has ever carried.
      ...(initial ? {} : { enterpriseId }),
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      status,
      commissionPct: Number(commissionPct),
      // The contact *person* is managed on Team, not here: a person can
      // leave and the company must carry on unchanged. What's left is the
      // company's own phone line.
      contactPhone: contactPhone.trim() || null,
      // Kept in sync with the payout M-Pesa number rather than entered
      // separately, so the (legacy, display-only) "Settlement M-Pesa"
      // field on the company's profile never drifts from where payouts
      // actually go.
      settlementPhone: payoutMethod === "PHONE" ? payoutMsisdn.trim() || null : null,
      acceptsWalkIn,
      acceptsCash,
      offersTransport,
      locationHint: acceptsWalkIn ? locationHint.trim() || null : null,
      openingHours: acceptsWalkIn ? openingHours.trim() || null : null,
      lat: acceptsWalkIn && lat.trim() ? Number(lat) : null,
      lng: acceptsWalkIn && lng.trim() ? Number(lng) : null,
      logoStorageKey: logoStorageKey.trim() || null,
      logoUrl: logoUrl.trim() || null,
      brandAccent: accent || null,
      payoutMethod: (payoutMethod as ParcelOrgPayoutMethod) || null,
      payoutMsisdn: payoutMethod === "PHONE" ? payoutMsisdn.trim() || null : null,
      payoutTillNumber:
        payoutMethod === "TILL" ? payoutTillNumber.trim() || null : null,
      payoutPaybillNumber:
        payoutMethod === "PAYBILL" ? payoutPaybillNumber.trim() || null : null,
      payoutPaybillAccount:
        payoutMethod === "PAYBILL" ? payoutPaybillAccount.trim() || null : null,
      payoutBankCode:
        payoutMethod === "BANK" ? payoutBankCode.trim() || null : null,
      payoutBankAccountNumber:
        payoutMethod === "BANK" ? payoutBankAccountNumber.trim() || null : null,
      payoutBankAccountName:
        payoutMethod === "BANK" ? payoutBankAccountName.trim() || null : null,
    };
    startTransition(async () => {
      const result = initial
        ? await actionUpdateParcelOrg(initial.id, input)
        : await actionCreateParcelOrg(input, members);
      if (result.ok) onDone();
      else setError(result.error);
    });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!initial && (
        <div>
          <label
            className="sub"
            htmlFor={ids.ent}
            style={{ display: "block", marginBottom: 4 }}
          >
            Which business runs it?
          </label>
          <input
            id={ids.ent}
            style={inputStyle}
            value={entName || entQuery}
            placeholder="Search registered businesses"
            disabled={!!enterpriseId}
            onChange={(e) => {
              setEntName("");
              setEnterpriseId("");
              searchEnterprises(e.target.value);
            }}
          />
          {enterpriseId && (
            <button
              type="button"
              className="btn btn-o btn-sm"
              style={{ marginTop: 6 }}
              onClick={() => {
                setEnterpriseId("");
                setEntName("");
                setEntQuery("");
                setEntResults([]);
                setEntSearched(false);
              }}
            >
              Change
            </button>
          )}
          {!enterpriseId && entResults.length > 0 && (
            <ul
              style={{
                listStyle: "none",
                margin: "6px 0 0",
                padding: 0,
                border: "1px solid var(--line)",
                borderRadius: 6,
              }}
            >
              {entResults.map((ent) => (
                <li key={ent.id}>
                  <button
                    type="button"
                    className="btn btn-o btn-sm"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      borderRadius: 0,
                    }}
                    onClick={() => {
                      setEnterpriseId(ent.id);
                      setEntName(ent.name);
                      setEntResults([]);
                    }}
                  >
                    {ent.name}
                    {ent.msisdn ? ` · ${ent.msisdn}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* The common case: this business has never registered
              anywhere else on the platform, so the search above comes
              back empty. Rather than dead-ending here (which is the
              whole reason this form was "the hardest of them all" —
              the only other way an Enterprise gets created is the
              public /join flow, OTP and all), staff can register it
              on the spot. */}
          {!enterpriseId &&
            entSearched &&
            entResults.length === 0 &&
            entQuery.trim() &&
            !creatingEnt && (
              <button
                type="button"
                className="btn btn-o btn-sm"
                style={{ marginTop: 6 }}
                onClick={() => {
                  setCreatingEnt(true);
                  setNewEntName(entQuery.trim());
                }}
              >
                <Icon name="plus" size={13} />
                No match — register &quot;{entQuery.trim()}&quot; as a new
                business
              </button>
            )}
          {creatingEnt && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                border: "1px solid var(--line)",
                borderRadius: 6,
                display: "grid",
                gap: 8,
              }}
            >
              <label
                className="sub"
                htmlFor={ids.newEnt}
                style={{ display: "block" }}
              >
                Business&apos;s registered name
              </label>
              <input
                id={ids.newEnt}
                style={inputStyle}
                value={newEntName}
                onChange={(e) => setNewEntName(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-p btn-sm"
                  disabled={entPending || !newEntName.trim()}
                  onClick={createBusiness}
                >
                  {entPending ? "Registering…" : "Register business"}
                </button>
                <button
                  type="button"
                  className="btn btn-o btn-sm"
                  disabled={entPending}
                  onClick={() => {
                    setCreatingEnt(false);
                    setEntError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              {entError && (
                <p
                  role="alert"
                  style={{ color: "var(--red)", fontSize: ".85rem", margin: 0 }}
                >
                  {entError}
                </p>
              )}
            </div>
          )}
          <span className="sub" style={{ fontSize: ".78rem" }}>
            A courier company hangs off a business record on the platform, the
            same way a shop and a ticket organiser do — search for one
            that&apos;s already registered, or register it now.
          </span>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <label
            className="sub"
            htmlFor={ids.name}
            style={{ display: "block", marginBottom: 4 }}
          >
            Trading name
          </label>
          <input
            id={ids.name}
            style={inputStyle}
            value={name}
            placeholder="e.g. Swift Riders Ltd"
            onChange={(e) => {
              setName(e.target.value);
              // Suggest a slug from the name on create only — changing a
              // live company's slug breaks the link its staff have saved.
              if (!initial) {
                setSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, ""),
                );
              }
            }}
          />
        </div>
        <div>
          <label
            className="sub"
            htmlFor={ids.slug}
            style={{ display: "block", marginBottom: 4 }}
          >
            Sign-in link
          </label>
          <input
            id={ids.slug}
            className="mono"
            style={inputStyle}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <span className="sub" style={{ fontSize: ".78rem" }}>
            /parcel-co/{slug || "…"}
          </span>
        </div>
        <div>
          <label
            className="sub"
            htmlFor={ids.commission}
            style={{ display: "block", marginBottom: 4 }}
          >
            Esoqo commission
          </label>
          <input
            id={ids.commission}
            className="mono"
            style={inputStyle}
            value={commissionPct}
            onChange={(e) => setCommissionPct(e.target.value)}
          />
          <span className="sub" style={{ fontSize: ".78rem" }}>
            % of each parcel. Frozen onto a parcel when it&apos;s paid for.
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <label
            className="sub"
            htmlFor={ids.phone}
            style={{ display: "block", marginBottom: 4 }}
          >
            Company phone
          </label>
          <input
            id={ids.phone}
            style={inputStyle}
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          <span className="sub" style={{ fontSize: ".78rem" }}>
            The company&apos;s own line. People — including its contact — live
            on Team.
          </span>
        </div>
        <div>
          <label
            className="sub"
            htmlFor={ids.status}
            style={{ display: "block", marginBottom: 4 }}
          >
            Status
          </label>
          <select
            id={ids.status}
            style={inputStyle}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span className="sub" style={{ fontSize: ".78rem" }}>
            {STATUSES.find(([v]) => v === status)?.[2]}
          </span>
        </div>
      </div>

      <div>
        <label
          className="sub"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <input
            type="checkbox"
            checked={acceptsWalkIn}
            onChange={(e) => setAcceptsWalkIn(e.target.checked)}
          />
          Takes walk-in drop-offs
        </label>
        <span className="sub" style={{ fontSize: ".78rem" }}>
          Lets a sender pick this company&apos;s own desk in the booking form
          and hand a parcel over in person, instead of only a scheduled pickup.
        </span>
      </div>

      <div>
        <label
          className="sub"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <input
            type="checkbox"
            checked={acceptsCash}
            onChange={(e) => setAcceptsCash(e.target.checked)}
          />
          Takes cash payments
        </label>
        <span className="sub" style={{ fontSize: ".78rem" }}>
          Off hides every cash option for this company — the counter&apos;s
          &quot;Record cash payment&quot;, counting a clerk&apos;s counter cash
          in, and counter bus-seat sales — leaving M-Pesa only.
        </span>
      </div>

      {acceptsWalkIn && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <label
              className="sub"
              htmlFor={ids.location}
              style={{ display: "block", marginBottom: 4 }}
            >
              Desk location
            </label>
            <input
              id={ids.location}
              style={inputStyle}
              value={locationHint}
              placeholder="e.g. Ground floor, Kenyatta Ave, next to the post office"
              onChange={(e) => setLocationHint(e.target.value)}
            />
          </div>
          <div>
            <label
              className="sub"
              htmlFor={ids.hours}
              style={{ display: "block", marginBottom: 4 }}
            >
              Opening hours
            </label>
            <input
              id={ids.hours}
              style={inputStyle}
              value={openingHours}
              placeholder="e.g. Mon-Sat 8am-6pm"
              onChange={(e) => setOpeningHours(e.target.value)}
            />
          </div>
          <div>
            <span className="sub" style={{ display: "block", marginBottom: 4 }}>
              Coordinates (optional)
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="mono"
                style={inputStyle}
                value={lat}
                placeholder="lat"
                onChange={(e) => setLat(e.target.value)}
              />
              <input
                className="mono"
                style={inputStyle}
                value={lng}
                placeholder="lng"
                onChange={(e) => setLng(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <label
          className="sub"
          htmlFor={ids.transport}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <input
            id={ids.transport}
            type="checkbox"
            checked={offersTransport}
            onChange={(e) => setOffersTransport(e.target.checked)}
          />
          Also runs passenger buses
        </label>
        <span className="sub" style={{ fontSize: ".78rem" }}>
          Turns on the Transport section (buses, routes, schedules and bus
          bookings) in this company&apos;s own console and counter, and lists
          it on the public bus-ticket booking page.
        </span>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div>
          <span className="sub" style={{ display: "block", fontWeight: 600 }}>
            Payout destination
          </span>
          <span className="sub" style={{ fontSize: ".78rem" }}>
            Where this company&apos;s cut of a parcel is sent, automatically,
            the moment it&apos;s settled — M-Pesa (phone, till or paybill) or
            a bank account over PesaLink. Leave as &quot;Not set&quot; and
            payouts land on the manual payouts page for finance to clear by
            hand instead.
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <label
              className="sub"
              htmlFor={ids.payoutMethod}
              style={{ display: "block", marginBottom: 4 }}
            >
              Payout method
            </label>
            <select
              id={ids.payoutMethod}
              style={inputStyle}
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value)}
            >
              <option value="">Not set (manual)</option>
              <option value="PHONE">M-Pesa (phone number)</option>
              <option value="TILL">M-Pesa till number</option>
              <option value="PAYBILL">M-Pesa paybill</option>
              <option value="BANK">Bank account (PesaLink)</option>
            </select>
          </div>
          {payoutMethod === "PHONE" && (
            <div>
              <label
                className="sub"
                htmlFor={ids.payoutMsisdn}
                style={{ display: "block", marginBottom: 4 }}
              >
                Payout M-Pesa number
              </label>
              <input
                id={ids.payoutMsisdn}
                style={inputStyle}
                placeholder="07XXXXXXXX or +2547XXXXXXXX"
                value={payoutMsisdn}
                onChange={(e) => setPayoutMsisdn(e.target.value)}
              />
            </div>
          )}
          {payoutMethod === "TILL" && (
            <div>
              <label
                className="sub"
                htmlFor={ids.payoutTill}
                style={{ display: "block", marginBottom: 4 }}
              >
                Till number
              </label>
              <input
                id={ids.payoutTill}
                className="mono"
                style={inputStyle}
                value={payoutTillNumber}
                onChange={(e) => setPayoutTillNumber(e.target.value)}
              />
            </div>
          )}
          {payoutMethod === "PAYBILL" && (
            <>
              <div>
                <label
                  className="sub"
                  htmlFor={ids.payoutPaybillNumber}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  Paybill number
                </label>
                <input
                  id={ids.payoutPaybillNumber}
                  className="mono"
                  style={inputStyle}
                  value={payoutPaybillNumber}
                  onChange={(e) => setPayoutPaybillNumber(e.target.value)}
                />
              </div>
              <div>
                <label
                  className="sub"
                  htmlFor={ids.payoutPaybillAccount}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  Account reference
                </label>
                <input
                  id={ids.payoutPaybillAccount}
                  style={inputStyle}
                  value={payoutPaybillAccount}
                  onChange={(e) => setPayoutPaybillAccount(e.target.value)}
                />
              </div>
            </>
          )}
          {payoutMethod === "BANK" && (
            <>
              <div>
                <label
                  className="sub"
                  htmlFor={ids.payoutBankCode}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  Bank
                </label>
                <select
                  id={ids.payoutBankCode}
                  style={inputStyle}
                  value={payoutBankCode}
                  onChange={(e) => {
                    setPayoutBankCode(e.target.value);
                    setPayoutBankAccountName("");
                    setBankValidationError(null);
                  }}
                >
                  <option value="">
                    {banks.length ? "Select a bank" : "Loading banks…"}
                  </option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="sub"
                  htmlFor={ids.payoutBankAccountNumber}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  Account number
                </label>
                <input
                  id={ids.payoutBankAccountNumber}
                  className="mono"
                  style={inputStyle}
                  value={payoutBankAccountNumber}
                  onChange={(e) => {
                    setPayoutBankAccountNumber(e.target.value);
                    setPayoutBankAccountName("");
                    setBankValidationError(null);
                  }}
                />
              </div>
              <div>
                <label
                  className="sub"
                  htmlFor={ids.payoutBankAccountName}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  Account name
                </label>
                <input
                  id={ids.payoutBankAccountName}
                  style={inputStyle}
                  value={payoutBankAccountName}
                  readOnly
                  placeholder="Validated name appears here"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  className="btn btn-o btn-sm"
                  disabled={
                    bankValidating ||
                    !payoutBankCode ||
                    !payoutBankAccountNumber.trim()
                  }
                  onClick={validateBankAccount}
                >
                  {bankValidating
                    ? "Validating…"
                    : isBankAccountValidated
                      ? "Validated ✓"
                      : "Validate with Co-op"}
                </button>
              </div>
              {bankValidationError && (
                <p
                  role="alert"
                  style={{
                    gridColumn: "1 / -1",
                    color: "var(--red)",
                    fontSize: ".85rem",
                    margin: 0,
                  }}
                >
                  {bankValidationError}
                </p>
              )}
              {isBankAccountValidated && !bankValidationError && (
                <p
                  className="sub"
                  style={{
                    gridColumn: "1 / -1",
                    fontSize: ".78rem",
                    margin: 0,
                  }}
                >
                  PesaLink confirmed this account is held by &quot;
                  {payoutBankAccountName}&quot;.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div>
          <span className="sub" style={{ display: "block", fontWeight: 600 }}>
            Label branding
          </span>
          <span className="sub" style={{ fontSize: ".78rem" }}>
            Prints centered in every label header for this company&apos;s pads —
            beside Esoqo&apos;s own mark, never over the QR or barcode. No logo
            = Esoqo branding alone.
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${name || "Company"} logo preview`}
              style={{
                height: 60,
                maxWidth: 200,
                objectFit: "contain",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: 4,
                background: "#fff",
              }}
            />
          ) : (
            <span className="sub" style={{ fontSize: ".82rem" }}>
              No logo — labels print with Esoqo branding.
            </span>
          )}
          <label className="btn btn-o btn-sm" style={{ cursor: "pointer" }}>
            {logoPending
              ? "Uploading…"
              : logoUrl
                ? "Replace logo"
                : "Upload logo"}
            <input
              type="file"
              accept="image/png,image/jpeg"
              hidden
              disabled={logoPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setLogoError(null);
                const fd = new FormData();
                fd.append("file", file);
                startLogoTransition(async () => {
                  const res = await actionUploadParcelOrgLogo(fd);
                  if (!res.ok) {
                    setLogoError(res.error);
                    return;
                  }
                  setLogoStorageKey(res.storageKey);
                  setLogoUrl(res.url);
                });
              }}
            />
          </label>
          {logoUrl && (
            <button
              type="button"
              className="btn btn-o btn-sm"
              disabled={logoPending}
              onClick={() => {
                setLogoUrl("");
                setLogoStorageKey("");
              }}
            >
              Remove
            </button>
          )}
        </div>
        {logoError && (
          <p
            role="alert"
            style={{ color: "var(--red)", fontSize: ".85rem", margin: 0 }}
          >
            {logoError}
          </p>
        )}
        <div style={{ maxWidth: 220 }}>
          <label
            className="sub"
            htmlFor={ids.brand}
            style={{ display: "block", marginBottom: 4 }}
          >
            Brand accent (optional hex)
          </label>
          <input
            id={ids.brand}
            className="mono"
            style={inputStyle}
            value={brandAccent}
            placeholder="#1a73e8"
            onChange={(e) => setBrandAccent(e.target.value)}
          />
        </div>
      </div>

      {!initial && (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            paddingTop: 12,
            display: "grid",
            gap: 10,
          }}
        >
          <div>
            <span className="sub" style={{ display: "block", fontWeight: 600 }}>
              Team
            </span>
            <span className="sub" style={{ fontSize: ".78rem" }}>
              Add the people who run this company and pick each one&apos;s role.
              Tick &quot;Contact&quot; on anyone senders should reach — you can
              tick several. A member with a phone and a PIN also gets a full
              Esoqo account they can sign in with at /signin; the rest sign in
              at /parcel-co/{slug || "…"}. Each member invited by phone is
              texted a first PIN — typed, or a temporary one when left blank —
              to sign in with and then reset.
            </span>
          </div>
          {members.map((m, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: 10,
                alignItems: "end",
                padding: 10,
                border: "1px solid var(--line)",
                borderRadius: 8,
              }}
            >
              <div>
                <label
                  className="sub"
                  htmlFor={`member-name-${i}`}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  Name
                </label>
                <input
                  id={`member-name-${i}`}
                  style={inputStyle}
                  value={m.name}
                  placeholder="e.g. Wanjiku"
                  onChange={(e) => updateMember(i, { name: e.target.value })}
                />
              </div>
              <RoleField
                value={m.role}
                onChange={(r) => updateMember(i, { role: r })}
                presets={PARCEL_STAFF_ROLES}
              />
              <div>
                <label
                  className="sub"
                  htmlFor={`member-pin-${i}`}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  PIN
                </label>
                <input
                  id={`member-pin-${i}`}
                  className="mono"
                  style={inputStyle}
                  type="password"
                  inputMode="numeric"
                  value={m.pin ?? ""}
                  onChange={(e) =>
                    updateMember(i, { pin: e.target.value.replace(/\D/g, "") })
                  }
                />
              </div>
              <div>
                <label
                  className="sub"
                  htmlFor={`member-phone-${i}`}
                  style={{ display: "block", marginBottom: 4 }}
                >
                  Or phone
                </label>
                <input
                  id={`member-phone-${i}`}
                  className="mono"
                  style={inputStyle}
                  placeholder="07XX XXX XXX"
                  value={m.msisdn ?? ""}
                  onChange={(e) => updateMember(i, { msisdn: e.target.value })}
                />
              </div>
              <label
                className="sub"
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  paddingBottom: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!m.isContact}
                  onChange={(e) =>
                    updateMember(i, { isContact: e.target.checked })
                  }
                />
                Contact
              </label>
              <button
                type="button"
                className="btn btn-o btn-sm"
                onClick={() => removeMember(i)}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-o btn-sm"
            style={{ justifySelf: "start" }}
            onClick={addMember}
          >
            <Icon name="plus" size={13} />
            Add member
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          style={{
            color: "var(--red)",
            fontSize: ".85rem",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <Icon name="alert-circle" size={14} />
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-p btn-sm"
          disabled={
            pending ||
            !name.trim() ||
            !slug.trim() ||
            (!initial && !enterpriseId) ||
            (acceptsWalkIn && !locationHint.trim())
          }
          onClick={save}
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <button
          className="btn btn-o btn-sm"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
