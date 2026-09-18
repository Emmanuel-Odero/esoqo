# Esoqo — Know-Your-Customer (KYC) Programme

**Version:** 1.0 · **Status:** Working draft — reflects codebase as at `main`
**Owner:** Legal & Compliance (DPO contact: `dpo@esoqo.co.ke`)
**Review cadence:** annually, or on any material change to the platform

This is the full Know-Your-Customer framework for Esoqo, covering every use
case and user type on the platform. It is written against the actual data
model — every identity primitive, claim, capability and threshold cited below
exists in `packages/db/prisma/schema.prisma`, `packages/db/src/{capabilities,dal}`,
the core services and the four apps (`web`, `app`, `admin`, `store`).

> Where this document says **"exists"**, the mechanism is in the codebase
> today. Where it says **"required"** / **"recommended"**, it is a compliance
> obligation or control Esoqo must stand up. This document does not
> constitute legal advice; obtain sign-off from Kenyan counsel before relying
> on it.

---

## 1. Purpose and scope

The purpose of KYC at Esoqo is to:

1. **Know who each Party is**, at a level proportionate to the risk their use
   case carries. The informality-first design means the burden must rise with
   the money, not with the person.
2. **Issue and maintain verified claims** (credentials) with an auditable
   evidence trail, replacing paper trust with a consented, revocable record.
3. **Detect, report and deter financial crime** on the platform —
   money-laundering, terrorist financing, fraud, fake sellers, shell chamas,
   and the sale of stolen goods.
4. **Meet Esoqo's data-protection and audit obligations** under Kenyan law
   without excluding the people the platform exists to serve.

Scope covers: individual subjects, groups/chamas, merchants and their
cashiers, storefront buyers, transport operators and crew, parcel senders,
receivers and couriers, donors, bill co-payers, employers (voucher batches),
institution/issuer partners, lender/SACCO consumers, and Esoqo's own staff and
field agents.

## 2. Regulatory context — what Esoqo is and is not

Esoqo's stated legal position, evidenced in the repo:

- **Data controller** under the Kenya **Data Protection Act, 2019**, enforced
  by the Office of the Data Protection Commissioner (ODPC). ODPC registration
  is still outstanding (`README.md:250-252`; footer placeholder
  `ODPC/REG/[number]` at `apps/web/src/components/Chrome.tsx:168`).
- **Not a mobile-money or e-money issuer.** Stored value is closed-loop
  (vouchers load and spend inside Esoqo only), there is no cash-out and no
  peer-to-peer transfer. The boundary is asserted in code
  (`services/core-go/internal/httpapi/closed_loop_test.go:22-23`), because
  holding customer funds is what draws in the **Central Bank of Kenya's**
  remit under the **National Payment Systems Act, 2011 (NPSA)**.
- M-Pesa (Daraja STK) and Pesapal are **gateway rails** — money flows to and
  from third-party PSPs that hold float and carry their own KYC/AML duties.
- Money complaints route to the provider and the **CBK**
  (`apps/web/src/app/trust/page.tsx:151`).

### Regulators with a direct interest in Esoqo use cases

| Regulator / law | Trigger | Relevant use cases |
|---|---|---|
| **ODPC — Data Protection Act 2019** | Collecting names, phones, IDs, documents | All parties, all consents |
| **CBK — NPSA 2011** | Any payment facilitation / stored value | Payments, vouchers, group withdrawals, COD |
| **FRC — POCAMLA 2009 / POTA 2012** | CDD, KYC, suspicious-transaction reporting, sanctions (reporting institutions and their designated non-financial business partners) | Any money movement |
| **KRA — Tax Procedures Act, eTIMS** | KRA PIN attestations, fiscal receipts | Merchants, stores, `KRA_PIN` / `ETIMS_ACTIVE` claims |
| **SASRA — SASRA Act 2008** | Partner SACCOs as loan underwriters | `LOAN_UNDERWRITING`, `GroupCreditInsightSnapshot` |
| **CA of Kenya — Courier-Hailing Service Provider licence** | Parcel delivery at scale (licence fee + universal service levy) | Parcel couriers |
| **Business Registration Service** | `BUSINESS_REGISTERED` claims | Groups, businesses, stores |
| **Ministry of Labour / Judiciary (via CECF)** | `GROUP_REGISTERED`, `MEDIATION_TRAINED` | Groups, mediation |
| **County governments** | `SINGLE_BUSINESS_PERMIT`, `SECTOR_LICENCE` | Traders, merchants |

Esoqo's operational risk is that its ecosystem partners (SACCOs, couriers,
merchants) are themselves reporting institutions — and Esoqo is the party
their book's identity depend on. This document therefore treats Esoqo's KYC as
**shared KYC infrastructure for the ecosystem**, not just its own compliance.

## 3. The identity foundation

Everything on the platform hangs off one abstraction:

- **Party** (`schema.prisma:74`) — the universal identity, `PERSON | ORGANISATION`,
  always county-scoped, soft-deletable for DPA erasure (`deletedAt`).
  - **Person** (`:134`) — `officialName` (name as written on the national ID;
    used only when a credential is issued), `knownAs`, `msisdn` (E.164 — the
    login/USSD identifier), `nationalIdHash` (**SHA-256 of the ID number; the
    raw number is never stored**), `email`, `gender`, `yearOfBirth`,
    `msisdnVerifiedAt`, `emailVerifiedAt`.
  - **Organisation** (`:173`) — `registrationNo` (verified via Attestation,
    never trusted raw), `businessType`, `intendsToRegister`.
  - **Enterprise** (`:268`) — the economic unit behind stores/ticket-orgs/
    parcel-orgs.
  - **Membership** (`:244`) — person↔org link with role
    (`CHAIRPERSON | TREASURER | SECRETARY | MEMBER | OTHER`) and
    `PENDING | ACTIVE` status.

**Trust layer — the KYC catalogue itself:**

- **ClaimType** (`:426`) — the credential vocabulary: `MSISDN_VERIFIED`,
  `EMAIL_VERIFIED`, `NATIONAL_ID_CONFIRMED`, `GROUP_REGISTERED`,
  `BUSINESS_REGISTERED`, `KRA_PIN`, `ETIMS_ACTIVE`, `MEDIATION_TRAINED`,
  `SINGLE_BUSINESS_PERMIT`, `FOOD_HANDLER`, `HEALTH_CLEARANCE`, `SECTOR_LICENCE`,
  `FIELD_VISIT`, `DELIVERY_CONFIRMED`, `TRADING_RECORD`, `ORG_PAGE_VERIFIED`.
- **Attestation** (`:457`) — one signed, hash-chained row per claim:
  `method` (`MANUAL | API | DOCUMENT | FIELD_VISIT | SELF_DECLARED`),
  `evidenceRefs`, `confidence`, `issuedAt / expiresAt / revokedAt / revocationReason`,
  `signature / prevHash / hash` (populated by `services/credential`).
- **Issuer** (`:490`) — a body with authority to assert claims
  (`MINISTRY | COUNTY | AGENCY | JUDICIARY | BANK | INSURER | BUYER | NGO`),
  each with a fixed `allowedClaims` list. Adding an issuer never requires a
  migration.
- **Document** (`:1836`) — uploaded evidence: `kind`, `storageKey` (opaque),
  `mimeType`, `sizeBytes`, `sha256`, `status` (`PENDING_REVIEW | ACCEPTED |
  REJECTED | SUPERSEDED`), `reviewedById / reviewedAt`, `extracted` +
  `ocrConfidence`. The twelve accepted kinds include `NATIONAL_ID`, `PASSPORT`,
  `GROUP_CONSTITUTION`, `MEMBER_LIST`, `MINUTES`, `REGISTRATION_CERT`,
  `BUSINESS_CERT`, `KRA_PIN`, `PERMIT`, `PAYMENT_RECEIPT`, `PHOTO`, `OTHER`.
- **ConsentGrant / ConsentAccess** (`:520`, `:548`) — the DPA-required,
  purpose-scoped, revocable record and its "every look, logged" access trail.

### The five subject-facing credentials

The subject app's standing ring (`apps/app/src/app/me/page.tsx:21-27`):

| Credential | Issuer in the seeded system | Gate it unlocks |
|---|---|---|
| `MSISDN_VERIFIED` | Esoqo (via OTP) | Payment IDs, account usability |
| `NATIONAL_ID_CONFIRMED` | Esoqo — "needed for credit above KES 50,000" | Higher-value lending |
| `GROUP_REGISTERED` | Ministry of Labour | Group standing |
| `BUSINESS_REGISTERED` | Business Registration Service | Store / enterprise standing |
| `KRA_PIN` | KRA | Larger facilities, eTIMS |

The product already encodes a **tiered trust model**; this programme
formalises it.

## 4. User and use-case inventory

| # | Use case | Persona / Party shape | Money feature | KYC tier |
|---|---|---|---|---|
| U1 | Individual subject (trader, member, buyer) | Person | Register, buy, pay fares, receive vouchers, join groups | 1–2 |
| U2 | Group / chama member | Person → Membership(org) | Contributions, savings | 1–2 |
| U3 | Group officer (chair/treasurer/secretary) | Role on Membership | Confirm contributions, raise withdrawals, run meetings | 2 |
| U4 | Group — the organisation itself | Organisation | Treasury account, join fees | 2 |
| U5 | Merchant / store owner | Party → Enterprise → Store | Checkout revenue, COD, PoS | 2–3 |
| U6 | Store cashier | Store-scoped cashier row (PIN) | PoS sales, shift cash | 2 |
| U7 | Storefront buyer | Party or guest (bearer) | STK checkout, COD, pickup code | 0–1–2 |
| U8 | Transport operator | Enterprise → TicketOrg | Bookings, installments, fares | 2–3 |
| U9 | Crew (driver/conductor) | Party + OrgStaffGrant (SCANNER/MANAGER/ADMIN/CREW) | Collect fares, declare cash | 2 |
| U10 | Parcel sender / receiver | Party or guest | Book, track, COD | 0–1 |
| U11 | Parcel courier | Party + ParcelCourier | COD remittance, payout | 3 |
| U12 | Donor / campaign contributor | Party or guest | STK donation | 0–1 |
| U13 | Bill owner / co-payer | Party or guest | Bill target funding | 0–1–2 |
| U14 | Employer (voucher batch) | Party → VoucherBatch | One payment → N vouchers | 2–3 |
| U15 | Voucher recipient | Party | Spend closed-loop value | 1 |
| U16 | Institution (bank/insurer/buyer/county/govt) | Issuer | Reads consent-gated records | 3 |
| U17 | Partner lender / SACCO | Issuer + DPA | `LOAN_UNDERWRITING`, credit insight | 3 |
| U18 | Field agent / agent-assisted joiner | AGENT actor | Walk-in joins, PIN resets | 2 |
| U19 | Esoqo staff (ops/registrar/finance) | StaffUser (capability-based) | Reviews, approvals, attestations, erasures | 3 |
| U20 | Public certificate verifier | Anonymous `/verify` | Reads attestations, no account | 0 |

## 5. Risk-based KYC tiers

The separating rule is **the size and reversibility of the money**, not the
device or channel. Everything below works on USSD.

| Tier | Name | Identity bar | Evidence | Applies to |
|---|---|---|---|---|
| 0 | Bearer / public | None — a verifiable tracking/order/pickup code is a *credential*, not identity | Code + HMAC signature | Buyers (STK identifies the payer), parcel sender/receiver, donors, bill co-payers, `/verify` |
| 1 | Verified contact | One Party, phone verified | OTP at onboarding; `MSISDN_VERIFIED` attestation | Individual subjects, voucher recipients, group members, most buyers |
| 2 | Verified + attested | Tier 1 + documental attestations | Documents (`PENDING_REVIEW → ACCEPTED`), `NATIONAL_ID_CONFIRMED`, `GROUP_REGISTERED`, `BUSINESS_REGISTERED`, `KRA_PIN`; field visit for groups/orgs | Group officers, merchants, crew, ticket-org owners, employer accounts, agents |
| 3 | Enhanced / financial | Tier 2 + ongoing monitoring, periodic re-KYC, AML screening | CDD file, screening record, source of funds where applicable | Parcel couriers, privileged staff, partner lenders/SACCOs, any settlement counterparty holding or moving others' money |

**Tier assignments are not static.** A Party rises from Tier 1 to Tier 2 the
moment they hold a store, sit on a chama treasury, or crew a transport org —
the capability presets already express this (`FOOD_HANDLER` / `SECTOR_LICENCE`
are merchant-grade claims).

## 6. KYC requirements by use case

### 6.1 U1 — Individual subject (the baseline)

- **Onboarding identity captured** (`Registration` at `schema.prisma:748`;
  join flow in `apps/app/src/app/join/`): official name, known-as, msisdn
  (E.164), email (optional), county/ward/sub-county, work + segment (the
  92-segment dictionary), language, device breadcrumbs.
- **Verification required:**
  - SMS OTP on the declared msisdn → `msisdnVerifiedAt`,
    `RegistrationStatus.VERIFIED` (exists — `OtpChallenge`, `packages/auth`).
  - The subject reaches **Tier 1** the moment `MSISDN_VERIFIED` is attested.
- **Optional strengthened evidence** (all optional in the "More about you"
  step): `NATIONAL_ID`, `PASSPORT`, `PHOTO` document kinds. A
  `NATIONAL_ID_CONFIRMED` attestation requires staff review of the ID document
  (`document.review`) and issuance via `attestation.issue:NATIONAL_ID_CONFIRMED`.
- **Escalation rule:** individual transactions below the regulatory cash
  threshold (§10) may run on Tier 1. Credit/financial exposure above
  **KES 50,000** must have `NATIONAL_ID_CONFIRMED` — this threshold is already
  hardwired into the product messaging (`apps/app/src/app/me/page.tsx`).

### 6.2 U2/U3 — Group members and officers

- **Membership creation:** self-join (search-existing group, then `Membership`)
  or officer-added (may be phone-less at first — `Person.msisdn` is nullable;
  the member becomes Tier 1 when a phone is verified).
- **Officers (CHAIRPERSON / TREASURER / SECRETARY) required controls:**
  - Tier 2 identity: `NATIONAL_ID_CONFIRMED`, a `GROUP_REGISTERED`
    attestation, and an `ORG_PAGE_VERIFIED`-grade document check of the group
    record.
  - Multi-signer control on withdrawals exists (`WithdrawalRequest` /
    `WithdrawalSignature`, HMAC-signed with each signer's PIN; M-of-N
    threshold; ~70-minute standby window). This is an AML control as much as a
    fraud control: **two or more unrelated signers must pass Tier 2**, and
    identity documents for each must be on the CDD file.
  - Officer change (e.g. a new treasurer) = **re-KYC at Tier 2** before the
    first withdrawal they can sign.
- **Groups (U4):** onboarding captures org name, kind, `memberCount`, and the
  group's consent to upload `REGISTRATION_CERT` / `GROUP_CONSTITUTION` /
  `MEMBER_LIST` / `MINUTES`. `registrationNo` "is verified via Attestation,
  never trusted raw" (`schema.prisma:185`); a self-typed registration number
  never becomes standing on its own.

### 6.3 U5/U6 — Merchants, store owners, cashiers

- **Merchant onboarding** (`apps/store/src/app/dashboard/new/StoreWizard.tsx`):
  `storeIdentitySchema` collects legal name, registration number, contact
  person + phone, physical address, coordinates. Enterprise business-gate
  details (`isRegistered`, `hasKraPin`, revenue bands, `bankProvider`, payment
  channels) are captured at registration (`Registration:768-807`).
- **Required to open a store:**
  - Tier 2 merchant identity: `BUSINESS_REGISTERED` or `KRA_PIN` attestation
    for incorporated/registered businesses; a valid `SINGLE_BUSINESS_PERMIT`
    or `SECTOR_LICENCE` / `FOOD_HANDLER` / `HEALTH_CLEARANCE` claim for
    informal traders where the segment requires it (all already in the
    claim catalogue).
  - `Enterprise.isRegistered` drives the "Verified Esoqo business" badge
    (`apps/web/src/app/discover/page.tsx:50`). **The badge must never render
    on an unattested claim** — it must be gated on a real `BUSINESS_REGISTERED`
    attestation, not the self-declared `hasRegisteredBusiness` string.
  - Beneficial-owner disclosure where an enterprise has multiple Individuals
    behind it.
- **Settlement:** today the settlement phone/account is informational; real
  payouts run through the enterprise ledger later. **Before any live payout,
  the settlement-account holder must be a Tier-2-verified Party** — an
  anti-money-mule rule.
- **Cashiers (U6):** each cashier is a store-scoped row with an Argon2id PIN
  and `pos.sell`. Required: identity attached to a real Party (no anonymous
  till access), an explicit role grant, and open-shift/float discipline (exists
  — `Shift` with opening float and variance). Cashiers handle physical cash,
  so their CDD record should carry `NATIONAL_ID_CONFIRMED` at Tier 2.

### 6.4 U7 — Storefront buyers

- The guest/party mix is deliberate; controls are:
  - **Tier 0 checkout (STK only):** M-Pesa identifies the payer by number;
    orders capture name + msisdn (exists).
  - **COD:** capture msisdn; the delivery contact is the credible identity.
  - **Pickup:** `pickupCode` is a one-time bearer credential — Tier 0 (exists).
  - **On-account / store credit (PoS "ON_ACCOUNT"):** requires a
    **Tier ≥ 1 buyer with a verified msisdn** and a `StoreCustomer` record —
    credit exposure cannot rest on a guest.
- Anti-fraud: the ordering msisdn is the anti-mule anchor; monitor for one
  customer / device harvesting many accounts (§7).

### 6.5 U8/U9 — Transport operators and crew

- **TicketOrg owner:** Tier 2 — the same document set as merchants
  (`BUSINESS_REGISTERED` / `KRA_PIN` or sector licence), plus the operator
  licence where applicable.
- **Crew (driver/conductor):** must already hold their **own Esoqo account**
  before a role grant — the only path (`handlers_org_context.go`);
  activation is OTP-gated step-up with a hard TTL. Required: Tier 2 crew
  identity (`NATIONAL_ID_CONFIRMED`) *before* `FARE` cash collection is
  enabled, because crew collect cash on the route.
- Crew with cash-handling duties (collection declarations, GPS pings) are the
  highest-value Tier-2 population after couriers; their CDD files and
  suspension/reinstatement state must be staff-auditable (exists —
  `OrgStaffGrant` suspend/reinstate).

### 6.6 U10/U11 — Parcel senders, receivers, couriers

- **Sender / receiver (Tier 0–1):** `senderName` + `senderMsisdn` and receiver
  details are always captured, guests included; tracking codes are bearer
  credentials (exists). The OTP for "this is my parcel" goes only to the
  number stored on the parcel, never a caller-supplied number
  (`docs/proposals/esoqo-parcel-labels-and-console.md`).
- **Courier (Tier 3) — the single biggest KYC gap in the code, explicitly
  admitted:** "PENDING_VETTING until a staff member flips them ACTIVE … no
  document/KYC upload pipeline yet, see the plan's explicit deferral note"
  (`schema.prisma:4103-4105`). Because couriers carry **physical COD money**
  and unlock full phone numbers only where custody allows, the required bar
  is:
  1. Government ID captured and verified (`NATIONAL_ID_CONFIRMED`, document
     review; `FIELD_VISIT` permitted).
  2. Clean diligence — no adverse vetting flags before `ACTIVE`.
  3. OTP-pinned onboarding devices; live-picture check where budget allows.
  4. Every courier **status change** writes an `AuditEvent` (exists — the
     audit layer is mandatory).
  5. If Esoqo scales to CA-licensed courier-hailing volumes: hold the
     Courier-Hailing Service Provider licence, remit the universal service
     levy, and be able to show it (`docs/proposals/parcel-audit-and-pilot-plan.md:229`).
- `ParcelCourierStatus.PENDING_VETTING → ACTIVE` must be the *only* path to
  ACTIVE — no force-flip.

### 6.7 U12/U13 — Donors and bill co-payers

- Anonymous donors are a deliberate, supported design (`donorName` defaults to
  "Anonymous"; giving never requires an account). KYC is not required for pure
  inbound giving, but:
  - Every donation / contribution still binds to an msisdn at payment time.
  - **Campaign orgs receiving funds are U5/U8 merchants for KYC purposes** —
    the outgoing side (who the money goes to) is the risk side.
  - Guest bill-co-payer contributions capture `contributorName` always —
    acceptable at Tier 0; the **bill owner is Tier 1+** with identity on file.

### 6.8 U14/U15 — Employers and voucher recipients

- **Employer (batch issuer):** Tier 2 company identity
  (`BUSINESS_REGISTERED` / `KRA_PIN`). The batch is funded by one M-Pesa
  payment that must confirm before anything exists
  (`ConfirmVoucherBatchByCheckoutID` — "nothing exists until it's actually
  paid for"). Employer KYC is required before the batch is loaded.
- **Voucher recipients:** Tier 1 (msisdn-verified). Closed-loop spend only
  (`VOUCHER_FLOAT`), no cash-out — consistent with the no-e-money position.

### 6.9 U16/U17 — Institutions and lending partners

- **Issuers** already exist as registered entities with fixed `allowedClaims`
  (`schema.prisma:490`). Institutional onboarding contract requirements:
  - Execute a **data processing agreement** with Esoqo before receiving any
    consent-gated snapshot — a member's `ConsentGrant` authorises Esoqo to
    share, but never substitutes for the recipient institution's DPA duties
    (`docs/proposals/esoqo-group-treasury-and-payment-id.md:295-307`).
  - Only **SASRA-regulated SACCOs / licensed lenders** are eligible for
    `LOAN_UNDERWRITING`-purpose reads.
  - Reads are field-scoped (`scope` — never "everything"), time-boxed
    (`expiresAt`), logged (`ConsentAccess`), and revocable from USSD
    (`*483*77#`).
  - **Tiered disclosure only:** the `SUMMARY` (GroupCreditInsightSnapshot) is
    consentable; a raw `LEDGER_EXTRACT` for a date range requires a separate,
    separately-worded grant — never default to raw-ledger sharing.
- **PEP / sanctions screening** applies at this tier (§7).

### 6.10 U18/U19 — Field agents and Esoqo staff

- **Staff (U19):** capability-based RBAC, not roles
  (`packages/db/src/capabilities.ts` ROLE_PRESETS). The privileged set to
  control: `party.pii`, `party.erase`, `party.credential`, `document.review`,
  `attestation.issue:*`, `consent.read`, `payment.approve`,
  `parcels.couriers.manage`. Required:
  - Staff screen + contract + reference check at hire (off-platform; recorded
    here for completeness).
  - Dual control for payment confirmation (`PAYMENT_APPROVAL_THRESHOLD`,
    no self-approval — exists in `dal/payments.ts`).
  - Four-eyes for `party.erase` (DPA erasure) and courier ACTIVE flips.
- **Field agents (U18):** `AGENT_ASSISTED` joins carry `agentId` on the
  Registration; the agent is the identity anchor for walk-in enrolments.
  Required: per-agent account + capability set (`registration.create`,
  `attestation.issue:FIELD_VISIT`, `party.read:county` scope) and every action
  written to the audit chain (exists — actor types include AGENT).

### 6.11 U20 — Public certificate verification

- Public `/verify` reads attestations with no account (exists). It reveals
  only the claim, holder display, issuer and dates — never PII. This surface
  must remain projection-safe: no phone, no ID — the parcel scan page's
  Tier-0 rule generalises.

## 7. AML / CFT controls (platform-wide; Tier 3 first)

The following controls **do not yet exist** and must be built. A grep for
`sanction`, `aml`, `PEP` across `packages/` and `services/` returns nothing
substantive.

1. **Sanctions & enforcement screening** — reciprocal screening of Tier 3
   parties (couriers, merchants, issuers, staff) and of any Party before a
   withdrawal / COD remittance over threshold, against: UN Security Council
   lists (1267/1989, 1718), Kenya's own lists, FRC advisories, adverse media
   for ecosystem-partner ledgers.
2. **PEP screening and risk flagging** at the institutional tier (U16/U17),
   with enhanced due diligence for founder/officer PEPs behind merchant orgs.
3. **Risk rating** — a static risk score per Party (segment, tier, volume)
   plus dynamic event triggers: unusual msisdn churn, reversal-heavy accounts,
   cross-segment jumps, chama signer concentration.
4. **Threshold-based monitoring** — escalate cash-equivalent activity above
   the regulatory single / aggregate cash thresholds (§10) and structured
   sub-threshold deposits (smurfing) across chama contributions, bill funding
   and voucher loads.
5. **Suspicious Transaction Reports (STR)** to the **Financial Reporting
   Centre (FRC)** — decision tree and named owner to be established.
6. **No-anonymous-merchant rule** — "1 verified account behind every store,
   till and future shipment — no anonymous sellers"
   (`docs/proposals/esoqo-shipping-partnership.md`). Enforce a hard gate: a
   Store / TicketOrg / ParcelOrg may not be ACTIVE without its owner at Tier 2.
7. **Physical-cash flows are the highest-risk flows:** group withdrawals, COD
   remittance, crew fare declarations, PoS cash shifts. All four are already
   ledger-posted — AML monitoring attaches to them first.

## 8. Ongoing due diligence and monitoring

- **Periodic re-KYC:** Tier 1 at onboarding; Tier 2 re-verified whenever a
  claim **expires** (`Attestation.expiresAt`) or is **revoked**
  (`revokedAt` / `revocationReason`); Tier 3 re-KYC annually.
- **Event-driven re-KYC (triggers already in the model):**
  - Officer / signer change on a chama treasury.
  - Store ownership or settlement-account change.
  - Courier status change (`PENDING_VETTING → ACTIVE` only via staff).
  - Credential expiry / revocation that drops a Party below its tier.
  - Regulatory threshold upgrades.
- **Dormancy and reactivation:** a Party returning into money movement after
  long inactivity is re-KYC'd at its tier before the first high-value
  transaction.
- **Monitoring feeds:** audit chain (`AuditEvent`, `pnpm audit:verify`),
  `ConsentAccess`, ledger `Posting` sums, courier remittance records, crew
  `CollectionDeclaration`s.

## 9. Data protection, consent and retention (DPA 2019)

- **Consent model (exists):** `ConsentGrant` is not a boolean — purpose-bound
  (`ConsentPurpose`), field-scoped (`scope`), channel-captured, dated,
  revocable, with the exact `wordingShown`. Every read is logged
  (`ConsentAccess`) and producible for the ODPC on request
  (`schema.prisma:520-560`).
- **Erasure (exists):** `erasePartyData` soft-deletes the Party and scrubs
  identifiers (`officialName → [erased]`, `knownAs`/`email`/`nationalIdHash`
  nulled, `msisdn → erased:{partyId}`) while preserving the audit chain — the
  chain is a legal record (`packages/db/src/dal/party.ts`). Intake path is not
  yet wired end-to-end (`README.md:253`).
- **Data minimization principles carried into KYC:** national ID is only ever
  stored as a hash; documents store an opaque `storageKey`, never the user's
  filename; KYC documents are served behind auth (unlike product photos —
  `apps/store/src/app/img/[...key]/route.ts`); files validated by magic bytes,
  10 MB cap, sha256 check before storage (`apps/app/src/app/join/upload.ts`).
- **Retention (recommended):** KYC/identity records retained per DPA minimality
  and any applicable AML retention for reporting institutions (commonly the
  life of the relationship plus several years after — confirm the current
  period with Kenyan counsel).
- **DPO + registration (outstanding):** ODPC data-controller registration and
  published DPO contact (`dpo@esoqo.co.ke`) before real parties are onboarded.
- **Special-category care:** gender, year of birth, health licences
  (`FOOD_HANDLER`, `HEALTH_CLEARANCE`), group membership and any ID document
  images are sensitive; they are collected only where a claim requires them,
  and never displayed by default.

## 10. Thresholds and limits

| Threshold | Value | Source / intent |
|---|---|---|
| National ID required for credit | KES 50,000 | Product-messaged gate (`apps/app/src/app/me/page.tsx`) |
| OTP daily spend cap | KES 5,000 | `OTP_DAILY_SPEND_CAP_KES` default in `.env.example` (anti-enumeration/abuse) |
| OTP rate limit | 5 / hour / number | `OTP_RATE_LIMIT_PER_HOUR` default |
| Registration-fee payment | single payment, dual control | `RegistrationPayment` + `PaymentApproval` chain |
| Parcel SLA / COD values | per pricing rule | `ParcelPricingRule.slaHours` snapshot at booking |
| Withdrawal standby window | ~70 min, active hours 7–20 | `withdrawalLeadMinutes` (AML cooling-off) |
| POCAMLA reporting thresholds | CBK/FRC directives | align cash / aggregate thresholds to current FRC guidance when monitoring is built |
| Courier-hailing licence | CAK app + annual fee; 0.5% universal service levy | `parcel-audit-and-pilot-plan.md` |

## 11. Record-keeping and audit

- The **audit chain** (`AuditEvent`, `schema.prisma:1934`) is append-only,
  hash-chained, and verifiable (`pnpm audit:verify`). Every KYC-relevant
  action — document review, attestation issue/revoke, payment approval,
  consent grant/access, erase, courier status flip — must write an
  `AuditEvent` (most already do).
- KYC **evidence trail per claimant:** `Registration` snapshot → Person /
  Organisation Party → Documents (status + reviewer + sha256) → Attestation
  (claim + method + evidenceRefs + confidence + chain) → ConsentGrant /
  ConsentAccess → postings. This is the exchangeable CDD file.
- **Retention of evidence refs:** `Attestation.evidenceRefs` should reference
  document IDs so a claim is reprovable long after upload.

## 12. Implementation roadmap — mapping to the codebase plan

| Control | Status | Where it lands |
|---|---|---|
| Tier 0/1 identity (OTP, `MSISDN_VERIFIED`) | **Exists** | `packages/auth`, `OtpChallenge`, join flow |
| Document upload + staff review | **Exists** | `Document`, `document.review`, admin documents screen |
| Attestation issue/revoke (claims, issuers, hash chain) | **Exists** (signing populated by...) | `Attestation`, `dal/attestation.ts`, … `services/credential` |
| Verifiable credentials / SD-JWT VC / OID4VCI | **Planned (Phase 3)** | `services/credential/README.md` |
| Courier KYC evidence pipeline | **Gap — deferred** | `ParcelCourier`; `parcel-audit-and-pilot-plan.md` |
| AML / sanctions / PEP screening | **Gap — build** | §7 of this document |
| SLED / STR filing to FRC | **Gap — build** | §7 |
| ODPC registration + DPO publication | **Gap — process** | README checklist |
| National ID verification API (e.g. NIIMS/Huduma-grade) | **Gap — integration** | `NATIONAL_ID_CONFIRMED` claim; raw ID stays hashed |
| Settlement payouts to merchants/couriers | **Planned** | `services/ledger` (Rust, Phase 2); settlement-holder Tier 2 gate |

## 13. Roles and responsibilities

| Role | KYC duties | Capability evidence |
|---|---|---|
| **Subject** | Supplies identity and evidence; grants/revokes consents | `:own` capability set |
| **Group officers** | Confirm member contributions; co-sign withdrawals | `OFFICER_ROLES` in treasury DAL |
| **Merchant** | Runs store, cashiers, settlement; supplies documents | Store wizard, cashier grants |
| **Staff registrar/ops** | Review registrations and documents; issue attestations | `registration.read`, `document.review`, `attestation.issue:*` |
| **Finance approver** | Dual-control payment confirmation | `payment.approve` |
| **Dedicated KYC/AML officer** | Screening, STRs, re-KYC scheduling | to be created (process role) |
| **DPO** | Consent, erasure, ODPC interface | `party.erase`, `consent.read` |
| **Issuers** | Issue only `allowedClaims`; respect consent grants | `Issuer.allowedClaims` |
| **Agents** | Agent-assisted enrolment; field visits | `attestation.issue:FIELD_VISIT`, `party.read:county` |

## 14. Appendix — evidence index

Key files for auditors and reviewers:

- Identity & claims: `packages/db/prisma/schema.prisma` (Party :74, Person
  :134, Organisation :173, Membership :244, Enterprise :268, Attestation :457,
  Issuer :490, ConsentGrant :520, ConsentAccess :548, Registration :748,
  Document :1836, AuditEvent :1934).
- Capabilities: `packages/db/src/capabilities.ts`.
- DAL gates: `packages/db/src/dal/{attestation,subject,payment-id,party,
  registration,documents,payments}.ts`.
- Services: `services/credential/README.md`, `services/ledger/README.md`,
  `services/core-go/internal/seed/reference.go` (seeded issuers).
- Proposals: `docs/proposals/esoqo-group-treasury-and-payment-id.md`,
  `docs/proposals/parcel-audit-and-pilot-plan.md`,
  `docs/proposals/esoqo-parcel-labels-and-console.md`,
  `docs/proposals/esoqo-shipping-partnership.md`.