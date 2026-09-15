# Group Treasury (multisig chama accounts) & Esoqo Payment ID

**Type** · Research + product direction (design doc; implementation spans `packages/db`,
`services/core`, `services/channels`, `services/ledger`, `apps/app/me`, `apps/admin`)
**Prepared** · 14 August 2026
**Status** · Draft for discussion — not yet scoped into phases with the team

This document covers two related asks: (1) a digital treasury for groups (contributions,
meeting attendance, multisig/time-delayed withdrawals, SMS+dashboard notifications), and
(2) an **Esoqo Payment ID** — a portable payment identity for people and businesses that
doubles as the data trail for building a financial portfolio (loans, grants). It starts
from what a chama/table-banking group actually does today, maps that onto primitives
that already exist in `packages/db/prisma/schema.prisma`, and proposes the gaps.

---

## 1 · What already exists — build on it, don't re-invent it

The schema was clearly designed with exactly this feature in mind, even though nothing
in `services/ledger` or `services/channels` has been built yet (both READMEs say
"not started"). The load-bearing primitives are already there:

| Need | Existing primitive |
|---|---|
| A chama/SHG/table-banking group | `Organisation` with `OrgKind.CHAMA` / `SELF_HELP_GROUP` / `TABLE_BANKING` |
| Membership + officer roles | `Membership` — `CHAIRPERSON` / `TREASURER` / `SECRETARY` / `MEMBER` / `OTHER` |
| A group's pot | `Account` with `AccountKind.GROUP_SAVINGS`, one per org |
| Money movement, auditable, balance never stored | `JournalEntry` + `Posting` (double-entry, balances derived, never mutated) |
| Idempotent money-in | `JournalEntry.idempotencyKey` — the exact pattern for "M-Pesa callback arrives twice" |
| **Multisig, already built once** | `PaymentApproval` — a signature chain on `RegistrationPayment` today: `decision`, HMAC `signature`, "one REJECT halts". This is the dual-control pattern to generalise for withdrawals. |
| PIN step-up auth | `UserCredential.pinHash` (Argon2id) + `OtpPurpose.STEP_UP` |
| Instant freeze on suspected compromise | `UserCredential.frozenAt` — "SIMAMA" |
| Trust/verification record, extensible without migration | `Attestation` (`ClaimType`, `AttestationMethod`, hash-chained) |
| Consent-gated data sharing (DPA 2019) | `ConsentGrant` / `ConsentAccess` — this is exactly the mechanism for "share my portfolio with a lender" |
| Tamper-evident history | `AuditEvent`, hash-chained |
| Member-facing surface | `apps/app/src/app/me/group/page.tsx`, `me/payments`, `me/consents` already exist |

So this is less "design a system" and more "extend a system that was already shaped for
it." That matters for scope and risk: the double-entry ledger and the signature-chain
pattern are proven in the codebase already, just narrower than needed.

## 2 · Why this is the right feature, not just a nice one

- **Multi-signatory withdrawal is already how chamas operate offline.** Chama group bank
  accounts conventionally require ≥2 signatories to withdraw — digitising it is not
  imposing new friction, it's encoding an existing norm members already trust.
- **Treasurer fraud is the single most-cited failure mode of chamas** — the pattern
  reported repeatedly: a treasurer stops holding physical meetings, tells members to
  send cash directly, then stalls with "missing bank statement" excuses when asked to
  account. It goes underreported because members won't take friends/family to court.
  ([K24: how to spot chama fraud](https://k24.digital/lifestyle/money/how-to-spot-chama-fraud-before-your-hard-earned-savings-vanish),
  [Nation: chama treasurer charged](https://nation.africa/kenya/counties/nairobi/-chama-treasurer-charged-with-defrauding-members-sh70-000-4286232))
  **The entire feature request in this brief is a direct structural countermeasure to
  that exact fraud pattern** — a withdrawal nobody can approve in silence, a copy nobody
  can suppress, a meeting record nobody can fabricate.
- **There is existing competition** — Chamasoft, MyChama.app, DigiChama, Postbank's
  M-Chama account (24/7 mobile access via agents/M-Pesa) — meaning the market is proven,
  but none of them sit inside a platform that already has verified Party identity,
  Enterprise/Store data, and a consent framework. Esoqo's differentiation is that group
  treasury data becomes **usable elsewhere on the platform** (loan eligibility, business
  payment ID) rather than living in a silo.
  ([MyChama.app](https://mychama.app/), [Postbank M-Chama](https://postbank.co.ke/m-chama-account/))
- **PesaLink is moving toward "PesaLink ID"** — instant transfer by phone number or
  national ID instead of account number — and M-Pesa is integrating with it. The
  direction of the entire Kenyan payments market is toward a portable ID as the payment
  handle instead of a provider-specific account number. An Esoqo Payment ID is on-trend,
  not speculative.
  ([TechCabal: PesaLink wants to be Kenya's payments rail](https://techcabal.com/2025/10/02/pesalink-wants-kenyas-payments-rail/),
  [Techish: M-Pesa/PesaLink integration](https://tech-ish.com/2025/01/21/m-pesa-pesalink-kenya-integration/))

## 3 · New schema — the gaps

Everything below extends `packages/db/prisma/schema.prisma`, follows its existing
conventions (UUID PKs, `@@map` snake_case, comments that explain *why*), and reuses
`Organisation` / `Membership` / `Account` / `JournalEntry` / `Posting` rather than
duplicating them.

```prisma
// ── Meetings & attendance ──────────────────────────────────────
model Meeting {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @db.Uuid
  org         Organisation @relation(fields: [orgId], references: [partyId])
  scheduledAt DateTime
  location    String?      // physical venue, or "virtual"
  agenda      String?
  quorumPct   Int      @default(50)  // % of active members needed to count as quorate
  calledById  String   @db.Uuid
  createdAt   DateTime @default(now())
  closedAt    DateTime?

  attendance  AttendanceRecord[]
  withdrawals WithdrawalRequest[]  // some groups require quorum before a request opens
}

enum AttendanceMethod { SELF_APP SELF_USSD AGENT_MARKED }

model AttendanceRecord {
  id         String   @id @default(uuid()) @db.Uuid
  meetingId  String   @db.Uuid
  meeting    Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  personId   String   @db.Uuid
  present    Boolean
  method     AttendanceMethod
  markedById String?  @db.Uuid   // set when an agent marked on someone's behalf
  markedAt   DateTime @default(now())

  @@unique([meetingId, personId])
}

// ── Scheduled, multisig withdrawal ─────────────────────────────
enum WithdrawalStatus {
  PENDING_SIGNATURES   // broadcast sent, standby window open
  APPROVED             // threshold reached before window closed
  EXECUTED
  REJECTED             // any signer rejected — halts immediately
  EXPIRED               // window closed, threshold never reached
}

model WithdrawalRequest {
  id              String   @id @default(uuid()) @db.Uuid
  orgId           String   @db.Uuid
  org             Organisation @relation(fields: [orgId], references: [partyId])
  accountId       String   @db.Uuid
  account         Account  @relation(fields: [accountId], references: [id])
  meetingId       String?  @db.Uuid
  meeting         Meeting? @relation(fields: [meetingId], references: [id])
  requestedById   String   @db.Uuid   // the accountant/treasurer
  amountKes       Decimal  @db.Decimal(12, 2)
  purpose         String
  payeeName       String
  payeeMsisdn     String?
  requiredSigners Int      // M-of-N threshold, from GroupTreasuryPolicy at request time
  broadcastAt     DateTime @default(now())
  standbyOpensAt  DateTime // broadcastAt + policy.withdrawalLeadMinutes (default 70)
  status          WithdrawalStatus @default(PENDING_SIGNATURES)
  journalEntryId  String?  @unique @db.Uuid  // set once executed

  signatures WithdrawalSignature[]

  @@index([orgId, status])
}

/// One signer's decision. Same shape as PaymentApproval, deliberately —
/// generalise that pattern rather than fork it: HMAC signature, one
/// REJECT halts, PIN step-up required before signing.
model WithdrawalSignature {
  id           String   @id @default(uuid()) @db.Uuid
  withdrawalId String   @db.Uuid
  withdrawal   WithdrawalRequest @relation(fields: [withdrawalId], references: [id], onDelete: Cascade)
  signerId     String   @db.Uuid   // Party — must hold a signer-eligible Membership role
  decision     ApprovalDecision   // reuse existing enum: APPROVE | REJECT
  pinVerifiedAt DateTime
  signature    String             // HMAC-SHA256(withdrawalId|signerId|decision|signedAt, SESSION_SECRET)
  signedAt     DateTime
  ip           String?

  @@unique([withdrawalId, signerId])
}

// ── Per-group policy, so 70 minutes is a default, not a constant ──
model GroupTreasuryPolicy {
  orgId                 String @id @db.Uuid
  org                   Organisation @relation(fields: [orgId], references: [partyId])
  requiredSigners        Int   @default(2)
  withdrawalLeadMinutes  Int   @default(70)
  /// The window only runs during these hours, in the group's own
  /// timezone — a request raised Saturday 9pm does not quietly expire
  /// while every signer is asleep. Minutes elapsed outside this range
  /// don't count toward withdrawalLeadMinutes; the clock pauses and
  /// resumes next activeHoursStart.
  activeHoursStart       Int   @default(7)   // 07:00 local
  activeHoursEnd         Int   @default(20)  // 20:00 local
  signerRoles            MemberRole[] @default([CHAIRPERSON, TREASURER, SECRETARY])
  requireQuorateMeeting  Boolean @default(false)
  contributionAmountKes  Decimal? @db.Decimal(12, 2)
  contributionCycle      String?  // "weekly" | "monthly" | "custom"
}

// ── Esoqo Payment ID ────────────────────────────────────────────
model EsoqoPaymentId {
  partyId    String   @id @db.Uuid
  party      Party    @relation(fields: [partyId], references: [id])
  code       String   @unique   // e.g. "ESK-4471-KE", human-typeable
  activatedAt DateTime @default(now())
  suspendedAt DateTime?

  @@index([code])
}

// ── Group Trust Signal (v1: no lending-outcome data yet) ──────
/// A SNAPSHOT, not a live-updating score — same reasoning as
/// balances being derived, not stored: computing it fresh each time
/// it's requested/shared is what keeps it honest. This row is the
/// record of "what was disclosed, when, under what formula version,"
/// not a cache. v1 inputs are strictly limited to events this schema
/// already produces — Posting (contribution consistency),
/// AttendanceRecord (reliability), WithdrawalSignature (signing
/// responsiveness and reject-rate). Loan-repayment behaviour is a
/// deliberate v2 addition, once an internal-lending feature (§7.10)
/// actually produces a repayment/default event to score against —
/// scoring against an outcome type that can't occur yet would be
/// inventing data, not deriving it.
model GroupCreditInsightSnapshot {
  id            String   @id @default(uuid()) @db.Uuid
  partyId       String   @db.Uuid
  party         Party    @relation(fields: [partyId], references: [id])
  formulaVersion String
  contributionScore Int  // 0-100
  attendanceScore   Int  // 0-100
  signatureScore    Int  // 0-100, responsiveness + reject-rate
  computedAt    DateTime @default(now())
  /// Set only when this snapshot was generated to satisfy a specific
  /// ConsentAccess — most snapshots are member-facing only and never
  /// leave the platform.
  disclosedViaConsentAccessId String? @db.Uuid

  @@index([partyId, computedAt])
}
```

Notes on the design decisions baked into this sketch:

- **`WithdrawalSignature` deliberately mirrors `PaymentApproval`** instead of reusing it
  directly, because `PaymentApproval.approverId` is FK'd to `StaffUser` (an internal
  reviewer), while a withdrawal signer is a `Party` (a group member). Same shape, same
  "one REJECT halts" rule, same HMAC-signature idea — just scoped to members instead of
  staff. Worth a short ADR if you want the pattern name formalised.
- **`standbyOpensAt` is derived, not fixed at 70** — `GroupTreasuryPolicy.withdrawalLeadMinutes`
  makes 70 the default, not a hard constant, because groups differ (some meet weekly,
  some monthly — a 70-minute standby window is generous for a weekly WhatsApp-active
  group and tight for one that's mostly SMS-only).
- **The 70-minute window is a broadcast/cooling-off period, not a signature deadline.**
  Recommend requiring *both* threshold signatures **and** the window elapsing before
  execution — not "whichever comes first." Otherwise two colluding signers could approve
  in the first 90 seconds and the entire broadcast purpose (giving the other N-2 members
  a chance to object) is defeated. `WithdrawalStatus.APPROVED` should only fire at
  `standbyOpensAt`, checking signatures collected up to that point.

## 4 · The flows

**Contribution posted** → a `Posting` credits the org's `GROUP_SAVINGS` account inside a
balanced `JournalEntry` → every active member gets an SMS copy ("KES 500 from Wanjiru
credited to Umoja Chama, new balance KES 84,200 — ref UC-2291") **and** a dashboard
notification on `/me`. This is the cheapest, highest-trust part of the feature and should
ship first — it's a fan-out on an event that already happens (a posting), not new money
logic.

**Meeting & attendance** → treasurer/secretary schedules a `Meeting`; SMS reminder goes
out at T-24h and T-1h; members mark attendance in-app, via USSD (`services/channels`),
or an officer marks on behalf of a member with no phone (`AGENT_MARKED`, mirroring the
existing `JoinPath.AGENT_ASSISTED` idea). Quorum, once reached, can gate certain actions
(`GroupTreasuryPolicy.requireQuorateMeeting`) — some groups will want "no withdrawal
without a quorate meeting behind it," others won't.

**Scheduled withdrawal**:
1. Accountant/treasurer opens a withdrawal request — amount, purpose, payee.
2. System sets `standbyOpensAt = now + policy.withdrawalLeadMinutes` (70 by default) and
   broadcasts to every eligible signer *and*, separately, an informational copy to every
   member (SMS + dashboard) — everyone sees a withdrawal was proposed, not just signers.
3. A second, shorter reminder goes out ~5 minutes before `standbyOpensAt` for signers who
   haven't acted — this is the "PIN popup" moment.
4. Each signer authenticates with their PIN (step-up, reusing `UserCredential`/`OtpPurpose.STEP_UP`)
   and signs APPROVE or REJECT. One REJECT halts the whole request immediately and
   notifies everyone why.
5. At `standbyOpensAt`, if `requiredSigners` APPROVEs are on file, the request moves to
   `APPROVED` and `services/ledger` executes the balanced `JournalEntry` (debit
   `GROUP_SAVINGS`, credit a settlement/payout account). If not enough signatures, it
   `EXPIRE`s and must be re-raised — no silent retry.
6. Execution fires the same "everybody gets a copy" SMS + dashboard notification as any
   other posting, closing the loop with a receipt reference.

## 5 · Esoqo Payment ID

A short, memorable, verified ID (`ESK-####-KE`) issued once a `Party` has at least
`ClaimType.MSISDN_VERIFIED` (and, for businesses, ideally `BUSINESS_REGISTERED` or
`KRA_PIN`) — reusing `Attestation`, not inventing a new verification path. It's usable
as a payment handle for peer transactions and store checkout the way a PesaLink ID or
till number is, but it's *Esoqo's own*, portable across a person's roles on the platform
(individual wallet, business till, chama membership) rather than provider-locked.

The part that answers "help them grow their financial portfolio for loans, grants" is
not the ID itself — it's what accrues under it over time:

- Contribution consistency (from `Posting` history on their memberships)
- Meeting attendance rate (from `AttendanceRecord`)
- On-time loan/withdrawal repayment behaviour, once a lending feature exists
- Business transaction volume (from `Store`/`StoreOrder`/`PosSale`, already built)

This is exactly the alternative-credit-data problem microfinance has always had for
thin-file borrowers — a chama member with five years of perfect weekly contributions has
no formal credit history, but has better repayment signal than most formal borrowers.
Surface it as a derived "portfolio" summary, and let the member **consent** (via the
already-built `ConsentGrant`/`ConsentAccess`) to share it with a specific SACCO or lender
for a specific purpose and time window — never a blanket export. SASRA-regulated SACCOs
are the natural first integration partner, since they already sit above informal chamas
in Kenya's savings-group hierarchy and would recognise verified group financial history
as underwriting signal.
([SASRA FAQ](https://www.sasra.go.ke/frequently-asked-questions/))

**The distribution play is two-sided, and Esoqo should stay the neutral protocol, not
become a lender.** The pitch to a SASRA-regulated SACCO (e.g. a mid-tier deposit-taking
SACCO) is verified, consent-based underwriting signal on chama members at effectively
zero acquisition cost; the pitch to members is that group discipline they already have
becomes a loan they were previously denied for lack of formal credit history. Add
`ConsentPurpose.LOAN_UNDERWRITING` to the existing enum for this — no new privacy
mechanism needed, it's the same `ConsentGrant`/`ConsentAccess` pattern already built for
DPA 2019 compliance, just a new purpose value.

Two things this needs that are outside this doc's scope but are real dependencies, not
footnotes: (1) a **data processing agreement with the partner SACCO** before any
`GroupCreditInsightSnapshot` is disclosed — a member's `ConsentGrant` authorises Esoqo to
share, it doesn't substitute for the receiving institution's own DPA obligations; (2) a
**tiered disclosure model** — most lenders will want more than a 0–100 score, so design
for two consent grains under the same `LOAN_UNDERWRITING` purpose: `SUMMARY`
(the snapshot above) and, only where a member separately consents, a scoped `LEDGER_EXTRACT`
of the underlying postings for a specific date range. Never default to raw-ledger sharing.

## 6 · Where this lives (per the existing ADRs)

| Concern | Plane / service | Why |
|---|---|---|
| Meeting/withdrawal orchestration, notification fan-out, policy checks | `services/core` (TS) | Business logic that isn't money-truth or the 2s USSD path |
| Posting execution, balance derivation | `services/ledger` (Rust, Phase 2) | ADR-0004: money math is not AI-owned; needs `rust_decimal` + serialisable isolation. **Until this ships, `services/core` can write Postings directly the same way `confirmStoreOrderPayment`/`confirmDonationPayment` already do** — that's a real, already-established bridge pattern, not a new risk. |
| SMS broadcast, USSD attendance marking, USSD PIN signing | `services/channels` (Rust, Phase 1 — "ship this before the PWA") | 2s aggregator SLA, session state, exactly what this feature needs for members without smartphones |
| Schema, DAL, capability checks | `packages/db` | ADR-0003 — `requireCapability()` before every query, no ad-hoc Prisma elsewhere |
| Member-facing UI | `apps/app/src/app/me/group/*` (new: `treasury`, `meetings`) | Already the home for `/me/group`, `/me/payments`, `/me/consents` |
| Officer/staff oversight, dispute review | `apps/admin` | Mirrors the Our Jamii admin pattern already shipped |

## 7 · African-context features worth adding (the "make it even better" ask)

1. **USSD is not a fallback, it's a first-class signer path.** Smartphone penetration in
   this segment sits around 58% — a "PIN popup" that only exists on a smartphone screen
   locks out a meaningful share of group members, often the older or more rural ones who
   are also the members most trusted with signing authority. The SMS that announces a
   withdrawal should carry a USSD code (`*XXX#`) that opens the same PIN-signature flow.
2. **Agent-assisted attendance and signing** for members with no phone at all at that
   moment — same trust model as the existing `AGENT_ASSISTED` join path, logged with
   `markedById` so it's never anonymous.
3. **Threshold + time window together, never either alone** — covered in §3, but worth
   restating as a product principle: the 70-minute broadcast window's entire value is
   "everyone had a chance to see and object," which a fast quorum defeats if allowed to
   short-circuit it.
4. **Dual-SMS-aggregator redundancy.** A missed withdrawal notice is not just an
   inconvenience here — it's the exact blind spot the fraud pattern in §2 exploits
   ("treasurer stopped holding meetings, told us to send cash directly"). `services/channels`
   should treat SMS delivery confirmation as a tracked, retried thing, not fire-and-forget.
5. **Kiswahili-native copy**, per the `services/channels` README's own stated principle —
   worth reinforcing here because a withdrawal-approval SMS is exactly the message a
   member most needs to read fast and correctly, no translation-lag.
6. **A member-visible, tamper-evident treasury timeline** — the hash-chained `AuditEvent`
   already exists; surface it as a plain-language feed ("Meeting called Aug 10, quorum
   reached · Withdrawal of KES 12,000 requested Aug 12, approved by 3 of 3 required
   signers, executed Aug 12 14:40"). This directly neutralises the fraud pattern where a
   treasurer stalls with "missing bank statement" excuses — there's nothing to stall on
   when the timeline is member-visible by default, not requested.
7. **Separate welfare/emergency pot from table-banking savings**, as its own
   `AccountKind` (e.g. `WELFARE`) — real chamas commonly run a rotating merry-go-round pot,
   a savings pot, and a welfare/emergency pot simultaneously, and conflating them in one
   account is a common source of member disputes about what money was "supposed" to be for.
8. **Merry-go-round rotation as a first-class contribution pattern**, not just flat
   recurring savings — a `RotationSchedule` that assigns which member receives the pot on
   which cycle date, since this is one of the two dominant chama structures alongside
   table banking.
9. **Reply-to-confirm on the copy SMS** ("reply 1 if you've seen this") for SMS-only
   members, as a lightweight second accountability channel that doesn't require the app.
10. **Internal lending before external lending** — let a group's own `GROUP_SAVINGS`
    balance and a member's attendance/contribution record support member-to-member loans
    first (same multisig approval flow, smaller scope), with the Esoqo Payment ID
    portfolio (§5) as the on-ramp to external SACCO/lender credit once that history
    exists. This sequencing matches how chamas already build trust internally before
    seeking outside capital. It's also the event that unlocks v2 of
    `GroupCreditInsightSnapshot` — repayment behaviour only becomes a valid scoring input
    once this exists to produce it.
11. **Consumption is offline-first; signing is not.** Balances, the treasury timeline,
    meeting agendas, and draft contribution declarations should work read-and-queue —
    cache locally, sync when back online — because for a meaningful share of this user
    base connectivity is something you walk to, not something you have. But a
    `WithdrawalSignature` must stay a live, online, freshly-PIN-verified act. Queuing a
    signature offline and auto-applying it on reconnect would mean the signer never had a
    present-tense look at the request at the moment it actually executes — which
    quietly defeats the whole point of the cooling-off window in item 3. USSD is the
    right fallback for "no smartphone"; there is no safe fallback for "no connectivity
    at the moment of signing" other than treating it as a missed vote — the threshold is
    met by the others, or the request expires.

## 8 · Open product questions before schema lands

- **Who counts as an eligible signer** — the three officers (`CHAIRPERSON`/`TREASURER`/`SECRETARY`)
  by default, or does each group pick its own signer set and threshold at setup?
- **Is 70 minutes fixed for MVP or configurable from day one?** The sketch above makes it
  a policy field either way, but it changes whether `GroupTreasuryPolicy` ships in phase 1.
- **How is a contribution captured** — self-declared like `RegistrationPayment` (member
  says "I paid", staff/treasurer confirms), or a direct M-Pesa STK push into the group
  account the way `StoreOrder` checkout already works? These have very different UX and
  fraud surfaces.
- **Does `requireQuorateMeeting` gate withdrawals for MVP**, or is that a v2 policy toggle?

---

Suggested next step: confirm the open questions in §8, then I can draft the actual
Prisma migration + DAL functions (`packages/db`) and the `/me/group/treasury` UI as a
first vertical slice — contribution SMS + dashboard notification only, no withdrawal
logic yet, so the fan-out pattern is proven before the harder multisig piece is built.
