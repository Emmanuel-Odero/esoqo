# Esoqo Unified Crew Identity — retiring account-less AGENT sessions

**Status:** proposed · 2026-09-09

## Context

Every SUBJECT (a person's own Esoqo account) already carries one flat,
capability-based profile spanning every domain they've opened with
`:own` qualifiers — store ownership, group treasury, ticketing-org
ownership, fleet ownership, and so on (`RolePresets[RoleSubject]`,
`services/core-go/internal/authsvc/capabilities.go`). Log in once, see
everything you're entitled to as an owner.

Hired org staff (`TicketOrgStaff`/fleet crew: SCANNER, MANAGER, ADMIN,
CREW) don't go through that model at all. They authenticate as an
**AGENT** — org slug + free-text name + PIN, no Party, capabilities
frozen at sign-in (`TicketingStaffCapabilities`,
`services/core-go/internal/authsvc/capabilities.go:172-199`). AGENT and
SUBJECT are mutually exclusive on one device: `token_store.dart` holds
a single session slot, and writing one kind clears the other. The
router locks an AGENT session to `/crew-shift` — "a scoped session sees
only its scope" — with no way to also be signed in as yourself.

This was a reasonable tradeoff when AGENT existed to let account-less
casual staff (a tout picking up a single day's shift) work without
setting up a personal profile. It no longer fits company strategy:
**every crew member is expected to hold and have used their own Esoqo
account** — partly so they can actually support clients on the product
they're operating for, partly because an account-less, PIN-only
identity is also a weaker security boundary than we want for something
that gates real operational actions (fare verification, ticket
check-in, order fulfillment).

Two problems follow from collapsing AGENT into SUBJECT naively:

1. **Stolen/unlocked-phone risk.** If org-staff capabilities just sat
   on the flat `EsoqoProfile.capabilities` list like `:own` grants do,
   anyone who gets past the lock screen inherits crew powers with zero
   extra friction.
2. **No kill switch.** An org owner/manager has no way to immediately
   revoke a crew member's access mid-shift, short of revoking the
   underlying account capability grant asynchronously and hoping the
   next request re-checks it.

## Decision

Retire AGENT as a credential type. Org-staff capabilities become
**org-scoped grants on the SUBJECT capability model**, but — unlike
`:own` grants — they are **dormant by default** and must be explicitly
**activated per session via OTP**, with an org-side ability to
immediately kill a live activation.

### Domain model (core-go)

```
org_staff_grants
  id, org_id, party_id, role (SCANNER|MANAGER|ADMIN|CREW),
  status (active|suspended),
  granted_by, suspended_by, suspended_at, created_at

org_context_activations
  id, party_id, org_id, activated_at, expires_at
```

`org_staff_grants` replaces `TicketingStaffCapabilities`-as-AGENT-bundle
as the source of "this Party is eligible to act as staff for this
org." `org_context_activations` is the separate, short-lived record of
"this Party is *currently switched in* as that staff role" — this is
what `requireCapability()` checks for org-scoped actions, never the
grant table directly. Owner/`:own` capabilities are unaffected and stay
always-live on the profile, exactly as today.

### Auth flows

**Activation** — `POST /v1/org-context/activate {org_id}`

- Always requires OTP verification (to the phone/email on file for
  that Party) — never satisfied by PIN alone, and never implicitly
  granted by an already-valid app session. Being unlocked and signed in
  as yourself is not sufficient to also act as crew.
- On success: checks `org_staff_grants.status == active` for
  (party_id, org_id), then creates an `org_context_activations` row
  with a TTL. Revised from the original shift-length proposal (8–12h)
  to 30–90 days (`ORG_CONTEXT_ACTIVATION_DAYS`, default 60) — a long
  TTL is acceptable specifically because a stolen/compromised phone is
  mitigated by an org admin's suspend (kills the activation
  immediately, independent of TTL length — see Suspension below), not
  by forcing everyone through a short expiry by default.
- Re-required on **every** lapse of that TTL, not only after a
  suspension — OTP every time an activation expires, no PIN-only fast
  path. This was an explicit call: consistency over convenience, so
  crew build one muscle memory for "getting back into work mode"
  regardless of why the last activation ended.

**Enforcement** — every org-scoped action checks for a live, unexpired
`org_context_activations` row for (party_id, org_id), consistent with
ADR-0003's deny-by-default DAL enforcement. This is what makes a
suspension bite immediately mid-shift rather than only blocking the
next login.

**Suspension** — `POST /v1/orgs/:id/staff/:partyId/suspend`
(owner/manager capability only)

- Deletes/invalidates any live `org_context_activations` row for that
  party+org immediately.
- Flips `org_staff_grants.status → suspended`.
- Reinstatement is a deliberate two-step, not automatic:
  1. Owner/manager explicitly flips `status → active` again. Time
     passing, or the crew member re-authenticating, does not
     self-clear a suspension — an owner decides when the incident is
     resolved.
  2. Only once reinstated can the crew member attempt activation again
     — which, per the rule above, is always OTP anyway.

### Mobile app

- `token_store.dart`: drop the SUBJECT-xor-AGENT single slot. One
  SUBJECT session; org-context activations are a lightweight
  overlay state (active org_id + expiry), not a competing session
  kind.
- `router.dart`: remove the AGENT-lockout branch entirely. A signed-in
  SUBJECT can always reach `/home`; an active org context additionally
  unlocks that org's scoped screens (e.g. `/crew-shift`,
  scanner/fare-verify flows) without replacing the home tree.
- New **context switcher** (off the profile screen or a persistent
  affordance near the home hub): lists "You" plus each
  `org_staff_grants` the Party holds. Picking an inactive one opens the
  existing OTP flow (`otp_sign_in_screen.dart`'s mechanism, reused, not
  duplicated) scoped to `org-context/activate` rather than full
  sign-in. Picking an already-active one just switches screens.
- Suspended-state messaging: "Your access to Acme Tours has been
  suspended — contact your manager." No OTP entry point shown while
  `status == suspended`.
- `sign_in_screen.dart`'s existing "Sign in as crew" link is retired —
  crew are SUBJECT accounts now; the entry point becomes "Add a staff
  role"/context switcher post-login instead of a separate pre-login
  credential path.
- New **manager-facing staff screen** (`features/fleet` or new
  `features/org_staff`): list crew for an org, suspend/reinstate
  control, audit trail (who suspended, when, who reinstated).
  `home_hub_screen.dart`'s existing dynamic-tile ordering
  (`_order()`) gains one more signal — an active org-staff
  activation — weighed the same way `canVerifyFare`/`myOrgsProvider`/
  `myGroupsProvider` already are.

### Migration

- Any existing AGENT/`TicketOrgStaff` accounts in production need a
  real Party before cutover: either backfill by requiring affected
  crew to complete normal SUBJECT sign-up and re-link their org role as
  a grant, or (if numbers are small/pre-launch) hard-cutover and have
  them re-onboard properly.
- Once migrated, delete the AGENT session kind, the crew-PIN sign-in
  endpoint, and `TicketingStaffCapabilities`-as-frozen-bundle from
  core-go.

## Consequences

- Matches existing platform philosophy (ADR-0003: capabilities, not
  roles; deny-by-default, checked live) rather than adding a
  parallel model.
- Crew genuinely use their own consumer account day-to-day, which was
  the strategic point — they experience the product they support.
- Slight new friction: OTP on every context-activation lapse, by
  design — with a 30–90 day TTL this lands as "rarely," not
  "constantly."
- Removes a structural security soft spot (PIN-only, frozen-at-login,
  no live suspension) in favor of a live-checked, ownable kill switch.

## Open items

- ~~Exact activation TTL~~ — settled: 30–90 days
  (`ORG_CONTEXT_ACTIVATION_DAYS`, default 60), configurable per
  environment.
- Whether `org_context_activations` needs per-device binding (so
  suspending one device's context doesn't affect another device
  legitimately signed in as the same Party), or whether one Party is
  assumed single-device for crew purposes today.
- Migration plan specifics for existing AGENT accounts (count and
  cutover method) — needs a look at current production data before
  scheduling this as a phase.
