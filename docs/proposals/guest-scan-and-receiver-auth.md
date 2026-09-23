# The Guest Scanner and the Receiver Who Can Prove It

**Status:** implemented
**Scopes:** `packages/db` (ParcelEvent + receiver-auth columns), `core-go`
(`dbx/parcel_receiver_auth`, `DeliverParcel`, `handlers_parcel_receiver`, notify),
`apps/web` (`/scan`, `ReceiverAuthPanel`, one-screen booking), `apps/app` parcel-org console,
`apps/admin` parcels console.

**Problems it solves:**

1. The website had no universal scanner. Mobile had one and core-go already owned the whole
   dispatch (`GET /v1/scan/resolve`, 13 kinds), but on the web a camera existed only inside the
   parcel tracking form.
2. The delivery code was a **staff-only** credential — only the current holder could type it
   (`dbx.DeliverParcel`) — so the receiver never proved anything themselves, and when a code went
   wrong there was no recovery at all. No reissue existed anywhere in the codebase, the 5-try
   throttle lived only in Redis where staff could not see it, and a locked parcel silently stopped.
3. A guest booking captured no declaration of contents, value or legality, and asked for it across
   two screens.

---

## 1. Two routes to one place

`parcel_claim.go` proves "I am a party to this parcel" by possession of the **phone** — an OTP to
the number already on file — and then reveals the delivery code to the receiver.
`parcel_receiver_auth.go` proves the same thing by possession of the **code**.

Both land on `GetParcelPartyView` at `ClaimTierReceiver`. One projection, two credentials. They
exist as a pair because each one's assumption is the other's failure case: a receiver whose SMS
never arrived has no phone route, and a receiver whose sender read the code down the line needs no
second text.

The code-route response strips `deliveryCode` before returning. On the OTP path echoing it is the
whole point; here the caller just typed it, so echoing only leaves a copy on a shared screen.

## 2. Escalation, and where the counter lives

| Attempts | State | Who is told | What unsticks it |
| --- | --- | --- | --- |
| 1–2 | wrong, tries remaining | nobody | typing it correctly |
| 3 | `receiverAuthLockedAt` | carrier dispatch desk (SMS) | staff grant: +2 |
| 4–5 | wrong, tries remaining | nobody | typing it correctly |
| 6th | `receiverAuthHardLockedAt` | **the sender** (SMS) + the desk | reissue only |

`ReceiverAuthMaxAttempts = 3`, not the 5 the courier-side throttle allows, because the situations
differ: a clerk reads a number off the customer's own phone with the customer there to correct
them; whoever types here may be anyone who photographed the label.

**The counter is in Postgres, not Redis.** `authsvc`'s limiters fail open on purpose, which is
right for a throttle guarding a staff endpoint — a lost counter means a clerk gets a few extra
tries. It is wrong for escalation state: staff must see it, act on it, and have their grant
survive a restart. A guard that forgets is fine; a queue that forgets is a parcel nobody comes
back to. The route keeps an IP rate limit as well, because the two cover different attacks — the
row counter stops guessing at one parcel, the IP limit stops one host walking a list of codes
photographed off a shelf, which a per-parcel counter cannot see by construction.

**A hard lock texts the sender, not the receiver.** By then we no longer believe whoever is typing
is the receiver. Texting the receiver's number would either tell an impostor how far they got or
tell a genuine receiver something they cannot act on. The sender holds the original code, knows
who they sent it to, and can say "that is not them" or "ring them, it's 4821".

`ReissueDeliveryCode` is the first write to `parcel."deliveryCode"` after insert anywhere in the
codebase. The new code is texted to both parties and **never** returned to a console or written
into an event row: `staffDetail` is read by every clerk with console access, which is a far wider
set than "the receiver".

## 3. Self-confirmation, and what it is fenced with

A verified receiver may close their own parcel — `podMethod = RECEIVER_SELF_AGENT`. This is the
single most privileged thing a guest can do in this API, so it carries four fences:

- A **single-use 10-minute token** minted only by a passed verification. Ten minutes, not the 24h
  `ClaimTokenTTL` allows a claim: that buys a read, this buys an irreversible write, and the flow
  is "I just typed my code and now I am tapping Confirm". The token check fails **closed** on a
  Redis error, unlike the limiters around it — it is the authorisation itself, not a guard.
- **`HELD_AT_AGENT` only.** A parcel on a shelf is collected in person at a shop with somebody
  behind the counter — the same fact `AGENT_COLLECTION` already leans on. A parcel in transit has
  no witness, and letting whoever holds the label and the code close it from anywhere would make
  the weakest proof in the system the easiest one to reach. For `IN_TRANSIT`, passing the code
  unlocks the receiver view and nothing more.
- **No outstanding COD.** Closing from a phone collects nothing and would strand the seller's
  goods money behind a parcel the system thinks is finished.
- **Courier pay is held, not accrued.** Every other delivery accrues on commit because staff were
  present to assert it happened; `AccrueCourierEarnings` is irreversible by design.
  `courierEarningsHeldUntil` is the window in which a fraudulent close can still be caught.

`codIsOutstanding` is shared by the check that offers the button and the check that honours it.
They were briefly two expressions and disagreed in exactly one case — a COD parcel whose cash the
courier had already taken — hiding the button on a parcel the write would have allowed.

## 4. A parcel history that can hold a failure

The public timeline was synthesized entirely from `parcel_handoff` legs plus a booked/delivered
bookend, so a non-custody fact was unrepresentable; the nearest thing, `parcel.exceptionNote`, is
one overwritable slot with a status guard that excludes `HELD_AT_AGENT`.

`parcel_event` is append-only, with `kind`, `severity`, and a `publicLabel` that is both the
visibility switch and the wording — one column, so the two cannot disagree and render a blank row
to a stranger. `staffDetail` carries what the public label must not.

Which rows are public is the editorial heart of the feature:

- a **pass** is staff-only (telling a prober their probe registered is a gift);
- a **single wrong code** is staff-only;
- a **lock** is public — the parcel has visibly stopped and the sender reading the same page needs
  to know why, and it reveals nothing a successful guesser would not already have;
- a **reissue** is public, because the receiver's old code has just stopped working and nothing
  else on the page would explain it.

`ParcelTrackEvent` gains `severity`, and `EventsTimeline` branches on it. It previously drew every
row as a green tick — fine while every row was a custody leg, actively misleading the moment a
failure could appear there.

## 5. The scanner

`/scan` on `apps/web`, guest-safe, `noindex`. Camera plus type-in, because a scratched label, a
code read over the phone and a desktop browser are all ordinary. It resolves through
`/v1/scan/resolve` and **never sniffs a prefix** — that boundary is why a new code type is a
server change plus one case in a switch, not a parser in every client.

Parcels redirect to `/t/<code>` and certificates to `/verify`, both of which already have real
pages. `ticket | order | party | fare` render inline cards — the same five kinds mobile renders
inline. `store | table | product` link out to `apps/store`, the one place that knows how to render
a shop. `trip | voucher` say what the code is and point at the app rather than claiming it is not
an Esoqo code.

`ParcelScanner` moved to `components/CodeScanner` and lost its parcel vocabulary; three copies of
the dynamic-import and camera-teardown dance would be three chances to leak a stream.

## 6. Booking

One screen, ordered *who → what → where → declare*. People first: names and numbers are what a
sender already has in their head, and a form that opens with a decision reads as longer than it is.

The declaration writes `senderDeclaredContents`, `declaredValueKes` (long accepted by the API and
simply never sent), `lawfulContentsAttestedAt`, `termsAcceptedAt`, `termsVersion`,
`carrierTermsVersion`. Timestamps and a version rather than booleans: in a dispute, "which terms,
and when" is the entire question.

**`contentsDeclaredAt` is untouched and still staff-only.** It asserts that a named member of
staff asked a person face to face, which a web form can never produce; widening it to cover a
checkbox would destroy the only column that says a human did the asking. The guest declaration is
a separate, weaker, honestly-named fact.

`POST /v1/parcels` also gains a rate-limit bucket. It was the only public write in the router with
none at all, and making booking faster for a sender makes it equally faster for anyone minting
junk rows.

## 7. Not built

Restaurant menu and wifi. Neither has any backing in the repo: `esoqo://table` is parsed at
`dbx/scan.go` but minted nowhere, the only storefront is `apps/store`, and there is no SSID or
credential concept anywhere. Table codes link out to the storefront; wifi is not offered. Building
them means table-QR minting, a public menu route, and an entirely new wifi-credential model with
its own schema and admin surface — a larger piece of work than everything above.

## 8. Verification

- `go build ./... && go vet ./... && go test ./...` — pass. New `parcel_receiver_auth_test.go`
  covers the state machine (lock on the third, a grant buying exactly two, hard lock on burning
  them, a correct code on the final try still passing, a locked parcel never advancing its own
  counter), event visibility, that no event row can carry a code, and the COD predicate. New
  `notify` tests pin who each message addresses and the single-segment GSM-7 budget.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` — pass for every package touched. Two failures
  predate this work and are untouched by it: a `.ts` import extension in
  `apps/web/.../booking-response.test.ts`, a restricted `prisma` import in
  `apps/web/api/health`, and typed-route errors throughout `@esoqo/jamii`.
- End-to-end against the dev stack: three wrong codes → lock + desk SMS; grant → two more; those
  burned → hard lock + sender SMS; grant refused once hard locked; reissue → both parties texted,
  old code dead, new code passes; self-confirm → `DELIVERED` / `RECEIVER_SELF_AGENT` with earnings
  held; token replay refused; `IN_TRANSIT` and COD-outstanding both refused at the write, not just
  hidden in the UI; guest booking stores the declaration with `contentsDeclaredAt` still null.
