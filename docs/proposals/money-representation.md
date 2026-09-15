# Money representation across the stack

Status: proposal
Scope: `services/core-go`, `mobile/esoqo_app`, the five web apps
Related: `docs/proposals/mobile-component-system.md`

---

## 1. Summary

**The database is correct. Everything above it is not.**

Every money column in `packages/db/prisma/schema.prisma` is `Decimal(12, 2)`,
and the ledger is `Decimal(18, 2)`. Precision is sound at rest. It is destroyed
in transit and in computation — `float64` in Go, `double` in Dart — and then
written back into those Decimal columns.

Two independent workarounds for the resulting drift were already in the
codebase before this audit. Both were written by someone who hit the bug in
production and reached for a tolerance instead of a representation:

```dart
// mobile/esoqo_app — complete_delivery_screen.dart, cash-on-delivery
if (short <= 0.004) return const SizedBox.shrink();
```

```go
// services/core-go — internal/ledger/ledger.go, double-entry balance check
if sum < -0.005 || sum > 0.005 { // float tolerance
    return "", errors.New("ledger: postings do not sum to zero")
}
```

The second one is the serious one: the invariant that makes double-entry
bookkeeping worth doing was enforced with a tolerance.

How load-bearing that tolerance was is worth stating precisely, because the
answer is not "everywhere":

- **13 of 15 `PostEntry` call sites are symmetric two-leg** — `{+x, -x}` from
  the same variable. IEEE754 sums those to exactly zero, so the tolerance never
  mattered there.
- **Two sites are three-leg splits, both in the COD path** —
  `dbx/parcel_cod.go:341` (`collected − goods − fee`) and
  `dbx/parcel_cod.go:670` (`gross − paid − fee`). Their legs come from
  `math.Round(x*100)/100`, whose results are not exactly representable, so the
  sum carries a genuine residue. **The tolerance is what let those two through.**
- **Two more sites bypassed the check entirely** — `dbx/treasury.go:281` and
  `:754` write `journal_entry` + `posting` rows inline in their own transaction
  rather than through `PostEntry`, so no balance check ran on the group
  contribution or withdrawal paths at all.

Both the mobile half (§4) and the ledger half (§5, step 1) are now fixed. The
remaining work is the wire contract, which cannot be changed unilaterally — it
affects five web apps.

---

## 2. The wire format is inconsistent

Mobile currently receives money in **two different JSON shapes** depending on
which backend served the request:

| Source | Shape | Example | Precision on the wire |
|---|---|---|---|
| TS endpoints (Prisma `Decimal`) | JSON **string** | `"254.15"` | preserved |
| core-go (`float64` struct fields) | JSON **number** | `254.15` | already lost |

Evidence of both in the mobile models: `ticketing_models.dart:180` declares
`final String priceKes`, while `parcel_models.dart:58` reads
`(json['minKes'] as num).toDouble()`. Same concept, same app, two shapes.

Mobile's `Money.fromJson` now accepts either, so this is not blocking. But it
means no client can be written against a single rule, and every new endpoint is
a coin flip for whoever consumes it.

---

## 3. Scope of the server-side problem

`float64` on money-shaped fields appears across **41 files** in `core-go`:

- `internal/ledger/ledger.go` — `Posting.AmountKES`, and the balance check above
- `internal/payments/` — `mpesa.go`, `pesapal.go`, `transaction_status.go`
- `internal/httpapi/` — 13 handler files, all with `binding:"required"` money fields
- `internal/dbx/` — 21 files reading Decimal columns into float64 and back

Computation, not just transport, happens in float. The clearest case:

```go
// internal/dbx/parcel_agents.go
func (t ParcelCoverageTier) CoverageFeeKes(declaredValueKes float64) float64
func (t ParcelCoverageTier) CoveredAmountKes(declaredValueKes float64) float64
```

These derive a fee in `float64` and the result is persisted into a
`Decimal(12,2)` column. The rounding happens at the database, silently, after
the error has already been introduced.

---

## 4. What is already done (mobile)

Shipped, tested, passing:

- **`lib/core/money/money.dart`** — an immutable `Money` backed by `int cents`.
  Exact `+`, `-`, `*`, `percentage`, `discounted`, `sum`. Parses both wire
  shapes. Returns `null` (not zero) for missing input, so "not set" and "zero"
  stay distinguishable. Formats with cents only when cents exist; `toWire()`
  emits an exact 2dp decimal string.
- **`test/core/money_test.dart`** — 26 tests, each pinned to a real defect found
  in the audit, including tests that *assert the double version drifts* so the
  fix cannot be quietly reverted.
- **COD path migrated** — `parcel_models.dart`, `complete_delivery_screen.dart`,
  `parcels_hub_screen.dart`, `parcels_repository.dart`. The `0.004` epsilon is
  deleted; "not short" is now exactly `!short.isPositive`.

Two real user-facing bugs fixed by that migration:

1. **Phantom shortfalls.** A 3-item COD order at KES 99.99 each, paid in full,
   produced a positive shortfall of ~1e-14 in `double`. The epsilon hid it —
   and would have hidden a genuine sub-cent shortfall too.
2. **"KES 0 short".** `2500.00 - (2000.00 + 499.99)` yields
   `0.010000000000218279`, rendered through `toStringAsFixed(0)` as `0`. A
   courier was told the buyer owed **"KES 0 short"**. It now reads
   `KES 0.01 short`.

Still on `double` in mobile, deliberately deferred because they flow into the
`setPrice(priceKes: double)` wire contract and through the 986-line
`book_parcel_screen.dart`: `ParcelPricing.minKes/maxKes/priceForReason`,
`coverageFeeKes`, and the cart totals in `table_order_screen.dart:71` /
`self_checkout_screen.dart:54`. These should migrate with §5.

---

## 5. Recommended server-side change

Three steps, in order. Step 1 stands alone and is worth doing immediately.

### Step 1 — Fix the ledger invariant (no contract change) — **DONE**

`ledger.Posting.AmountKES float64` is now `AmountCents int64`, and the balance
check is exact. Shipped:

- **`ValidateBalanced([]Posting) error`** — split out of `PostEntry` so it is
  testable without a database, and so an unbalanced entry is rejected *before*
  a connection is taken. Exact `sum != 0`; the error names the imbalance in
  cents.
- **`CentsFromKES(float64) int64`** — the migration boundary, rounding half away
  from zero. Callers in `dbx` still hold `float64` until step 2; converting here
  means whatever error their float already carries is captured at the nearest
  cent and cannot grow. The ledger itself does no float arithmetic.
- **`Posting.Decimal() string`** — renders the amount for the `Decimal(18,2)`
  column as an exact string bound with `$3::numeric`. Deliberately *not*
  `float64(cents)/100`, which would hand a float back to the driver at the last
  step.
- **All 15 `PostEntry` call sites converted**, plus the two inline-transaction
  writers in `dbx/treasury.go`, which now call `ValidateBalanced` themselves —
  closing the gap where the group-contribution and withdrawal paths had no
  balance check at all.
- **`internal/ledger/ledger_test.go`** — 8 tests, including the three-leg COD
  shapes that made the tolerance load-bearing, and one that pins why sub-cent
  imbalances are now unconstructable rather than merely detected.

`go build ./...` clean, `go vet` clean, full `go test ./...` passing.

### Step 1b — Retire the SUSPENSE placeholder — **DONE**

Ticketing and fleet credited operator payables to `SUSPENSE`, a kind whose
meaning is "not yet classified" and which is supposed to trend to zero. Both
call sites flagged it in their own comments as a placeholder waiting on a
schema value. Shipped:

- **`TICKET_REVENUE` and `FARE_REVENUE`** added to `AccountKind`, using the
  names the code's own TODO comments asked for. Kept distinct because one SACCO
  can both sell scheduled tickets and run stage fares, and a shared account
  would make those streams unseparable after the fact.
- **Migration `20260913000000`** — enum values only. Split from the data move
  because Postgres will not let a new enum value be *used* in the transaction
  that adds it, and Prisma wraps each migration in one.
- **Migration `20260913000100`** — moves the balances by posting a **balanced
  reclassification entry per (party, stream)**, not by `UPDATE`-ing postings.
  `JournalEntry`/`Posting` are declared immutable ("Never updated, never
  deleted"); silently restating history is the one thing a ledger must not do.
  The split is driven by `journal_entry.reference` (`booking:` vs `fare:`), so a
  party holding both streams in one SUSPENSE account separates correctly. The
  migration ends in a `DO` block that raises rather than commit an unbalanced
  ledger.
- **Three call sites repointed**; no code writes to `SUSPENSE` any more.

Validated against a throwaway clone of the dev schema with a fixture covering
ticketing-only, fleet-only, both-streams-in-one-account, and an unrelated
SUSPENSE balance that had to stay put:

| Party | Before | After |
|---|---|---|
| A (ticketing only) | SUSPENSE −3,000 | SUSPENSE 0 · TICKET_REVENUE −3,000 |
| B (fleet only) | SUSPENSE −1,500 | SUSPENSE 0 · FARE_REVENUE −1,500 |
| C (**both**) | SUSPENSE −2,800 | SUSPENSE 0 · TICKET_REVENUE −2,000 · FARE_REVENUE −800 |
| D (unrelated) | SUSPENSE −500 | SUSPENSE −500 — untouched |

Global ledger sum `0.00`, zero unbalanced entries, all 12 original postings
still present, and a re-run changed nothing.

### Step 1c — Pin the closed-loop invariant — **DONE**

`internal/httpapi/closed_loop_test.go`. Esoqo is not a mobile money platform,
and three properties keep it from becoming one by accident: stored value is
closed-loop, there is no cash-out, and there is no peer-to-peer transfer. All
three hold today — but only by accident, and a single well-meaning "let users
cash out their voucher" ticket would cross the line inside a sprint.

Two guards: an allowlist of the entire stored-value route surface, and a banned
vocabulary check (`unload`, `cashout`, `redeem`, `transfer`, `p2p`, …). Both
were verified to actually fire by temporarily registering a
`POST /v1/vouchers/:id/cashout` route; both failed with the intended message,
and the route was reverted.

Deliberately *not* banned: group-treasury withdrawals, COD remit/settle, and
courier payouts. Those move real money but none is stored value being redeemed
by its holder — they are a chama releasing its own pooled funds under
multi-signature approval, a rider handing over cash they physically collected,
and Esoqo paying its own payables.

This is a tripwire, not a control. Anyone can edit the allowlist; the point is
that doing so shows up in a diff and has to be argued for.

### Step 2 — Compute in decimal — **DONE for `dbx`**

**`internal/money`** — the Go mirror of `mobile/esoqo_app/lib/core/money/money.dart`,
so a rounding rule means the same thing on both sides of the wire. `Cents` is
an `int64`; the only places a rounding decision is made are `FromKES`,
`ParseKES`, `Percent` and `Points`, each of which names its rule in its doc
comment. 15 tests.

`ParseKES` is string-based rather than `ParseFloat`-then-scale, which matters:
core-go reads most money out of Postgres as `::text` precisely so the decimal
survives the trip, and parsing it into a float first throws that away again.

Eleven inline `math.Round(x*100)/100` expressions are gone, replaced by one
stated rule each:

| Site | Was |
|---|---|
| `ParcelCoverageTier.CoverageFeeKes` | `t.FeeKes + covered*t.FeePct/100` |
| `SplitParcelRevenue` | two `math.Round` round-trips |
| `CodExpectedKes`, `AllocateCodCollection` | three `math.Round` round-trips |
| `SettleSellerCod` | per-parcel fee + float accumulation of the run total |
| `ParcelCourierTariff.EarningsFor` | `math.Round(earned*100)/100` |
| COD shortfall | `math.Round((expected-collected)*100)/100` |
| 4 × voucher points | `int(kes*10 + 0.5)` |
| Installment basket total | `total += priceKES` in a loop |

`money.Points()` reproduces `int(kes*10 + 0.5)` exactly, half-up boundary
included, and is tested against that expression directly — points are spent
against a balance, so rounding a half-point the other way would make a voucher
that used to cover a purchase stop covering it.

The three-leg COD settlement now posts straight from exact cents
(`gross`, `-paid`, `-fee`), so it balances by construction rather than by
rounding luck. It was one of the two entries whose residue the ledger's old
±0.005 tolerance absorbed.

**Behaviour-preserving**, not just compiling: the seven pre-existing tests that
cover these functions — `TestAllocateCodCollectionAlwaysReconciles`,
`TestSplitParcelRevenueClampsAndRounds`, `TestCoverageFeeAndPayoutAgreeOnTheCap`
and others — all still pass untouched.

Deliberately left alone: `math.Round(in.DepositKES)` and `math.Round(amountKES)`
in `ticketing_installment.go` round to **whole KES**, not cents. Different
intent (installments are whole shillings, and the messages say so).

Still outstanding for step 2: `internal/payments` (`mpesa.go`, `pesapal.go`,
`transaction_status.go`) still holds `AmountKES float64`. Those are closer to
the wire than to arithmetic, so they move with step 3.

#### Two bugs found while converting

1. **`OpenInstallmentPlan` could never succeed.** The deposit insert declared
   two placeholders and supplied one argument:
   ```go
   VALUES (gen_random_uuid(), $1, $2, 'DEPOSIT', 'PENDING', now())
   RETURNING id`, bookingID).Scan(&depositPaymentID)
   ```
   pgx rejects that on every call, so no pay-in-portions plan could be opened
   at all. Unrelated to money representation; found because the conversion
   required reading the statement. Fixed.

2. **A float equality comparison decided whether a payment closed a plan.**
   `CreateBookingBalancePayment` computed `remaining := total - paid` in float64
   and then tested `amount == remaining` to classify the payment as `BALANCE`
   rather than `INSTALLMENT`. A hundredth of a cent of drift would classify a
   genuine final payment as an instalment, leaving a plan the buyer has paid in
   full permanently short of `PAID`. Both sides now parse exactly from the
   Decimal columns and the equality is integer.

### Step 3a — Converge the wire format, input side — **DONE**

**`money.Amount`** (`internal/money/amount.go`) — `Cents` with JSON behaviour:
unmarshals from **either** a JSON string (`"254.15"`) or a JSON number
(`254.15`), and marshals to a decimal string. A JSON number is parsed from its
literal text rather than through `float64`, because `254.15` the literal is
exact where `254.15` the float64 is not; scientific notation falls back to
`ParseFloat`.

That asymmetry is the whole design. Moving a **request** field to `money.Amount`
is strictly non-breaking — every client shipped today keeps sending numbers and
keeps working, while a client that has moved on can send an exact decimal
string. No coordinated release required.

**All 28 input-side money fields converted**, across 19 request structs. Zero
`float64` money fields remain in any `*Request` struct. Pointer fields
(`*money.Amount`) keep the nil/present distinction that `CodCollectedKes` and
`DeclaredValueKes` depend on — nil means "not reported", which is not the same
as zero.

Verified rather than assumed, in `internal/httpapi/money_binding_test.go`:

- a plain JSON number still binds — **every existing client keeps working**
- a decimal string binds to the identical value
- **`binding:"required"` still rejects a missing, null or zero amount.** This
  was the real risk: `go-playground/validator` implements `required` as "not
  the zero value", and `Amount` is a named `int64` with custom JSON methods —
  exactly the shape where a validator can quietly start treating every value as
  present. Had that broken silently, every money endpoint would have begun
  accepting amount-less requests and writing zero-value rows instead of
  erroring.
- malformed amounts error rather than silently zeroing

Mobile now sends `codCollectedKes` as `Money.toWire()` — a courier's cash no
longer round-trips through a float on the way out.

### Step 3b — Converge the wire format, output side — **PILOT DONE**

#### Picking the first endpoint, empirically

The sequencing note below originally said to start with the parcel COD and
delivery surfaces because "mobile owns them end-to-end". **That was wrong.**
TypeScript reads COD money in 7 files — `apps/admin`'s `CodConsole` and
`PayoutConsole`, `apps/app`'s `RiderCashPanel`, `apps/web`'s send-parcel
actions — 37 references in total.

So the safe set was derived rather than guessed: every money JSON key core-go
emits, cross-referenced against TypeScript reads.

| Key | TS reads | | Key | TS reads |
|---|---|---|---|---|
| `earnedTodayKes` | **0** | | `holdingFeeKes` | 17 |
| `paidKes` | **0** | | `feeKes` | 45 |
| `unpaidKes` | **0** | | `balanceKes` | 64 |
| `earnedKes` | **0** | | `amountKes` | **239** |

Exactly one endpoint is reachable with zero coordination:
**`GET /v1/me/courier-earnings`**, whose sole consumer is mobile's
`CourierEarningsScreen`.

#### What moved

- `CourierEarnings.{UnpaidKes,PaidKes,EarnedTodayKes}` and
  `CourierEarningRow.EarnedKes` → `money.Amount`; the endpoint now emits
  `"1250.00"` rather than `1250`.
- **The `::float8` aggregate is gone.** `SUM` over a `Decimal(12,2)` column is
  exact in Postgres; casting the result to `float8` threw that away on the way
  out, for no reason beyond `Scan` wanting a `float64`. These are the totals a
  courier reconciles their own pay against. Now read as `::text` and parsed
  exactly.
- Dart model moved to `Money`; the screen renders `.format()`.

#### `money.Amount` now implements `sql.Scanner` / `driver.Valuer`

Needed the moment a response field is scanned straight out of a Decimal column.
Worth stating why it is not optional: `rows.Scan` takes `any`, so
`rows.Scan(&row.EarnedKes)` **compiles perfectly and fails at runtime** without
it — a strictly worse failure mode than not compiling.

Whether pgx honours `sql.Scanner` is a property of the driver, not of this
package, so unit tests cannot establish it. `amount_pgx_test.go` checks it
against a real Postgres, gated on `TEST_DATABASE_URL`:

```
TEST_DATABASE_URL="postgres://esoko:esoko_dev_only@localhost:5432/esoko" \
  go test ./internal/money/ -run PGX -v
```

It round-trips through `numeric(18,2)` and asserts that `0.10 + 0.20` is 30
cents and that the three-leg COD split leaves nothing stranded — **in the
database**, not in memory. Both pass.

#### Mobile ships independently

`Money.fromJson` accepts either shape, so the app parses correctly against a
converged server *and* an unconverged one. Client and server rollouts do not
have to be ordered.

#### Second group — the coverage/COD/payout surface — **DONE**

`feeForValueKes`, `coveredAmountKes`, `goodsKes`, `readyKes`, `owedKes`,
plus the `coverageFeeKes`/`coveredAmountKes` pair on the pricing-quote
endpoint. Go fields, the `::float8` aggregates behind them, the five
TypeScript consumers, and their type declarations all moved together.

`readyKes` was not in the original group but came with `goodsKes`: they live in
the same struct and are subtracted from each other, so moving one without the
other would have been meaningless.

Both endpoints that emit `coveredAmountKes` were converted together. One had
been left as a raw number, which would have left **the same JSON key with two
different shapes depending on the endpoint** — worse than either shape alone.

**`packages/domain/src/money.ts`** — the third mirror of the same rules, after
Go and Dart. 22 tests. It exists because the TypeScript failure mode is the
nastiest of the three:

```ts
items.reduce((sum, i) => sum + i.amountKes, 0)  // "0250.001300.00…"
Math.round(courier.owedKes)                      // NaN
```

`+` concatenates rather than throwing, so a total becomes nonsense with no
error anywhere.

A third float epsilon turned up during the conversion, this time in the admin
console — `inPocket > 0.004` in `CodConsole.tsx`, the same workaround as the
mobile COD screen and the ledger. Now exact, so the comparison is `> 0`.

#### Remaining — three keys, and why they are not a sweep

`amountKes` (239 TS references), `balanceKes` (64) and `feeKes` (45), plus the
admin pricing editors' `maxCoverKes` / `maxAmountKes` / `perKmKes` /
`holdingFeeKes` / `perDeliveryKes` / `maxPerDeliveryKes`.

Two things make these different in kind from the groups above:

1. **Provenance is mixed.** Many of those 239 `amountKes` reads are
   Prisma-sourced — already decimal strings, entirely unaffected by a core-go
   change. Others read core-go and would break. Distinguishing them needs
   data-flow tracing per call site; grep cannot do it, and guessing wrong means
   either a missed breakage or a pointless edit.

2. **The pricing-editor keys are round-trip fields.** They are both read from
   and written back by the admin editors, and they feed the pure computation
   functions (`CoverageFeeKes`, `CoveredAmountKes`) that step 2 already moved to
   exact cents. Converting the struct fields cascades into those signatures —
   which is the *right* end state (it removes the float boundary entirely for
   `ParcelCoverageTier`) but is a refactor of the type, not a field swap.

An attempt at converting these in one batch was made and reverted: the compiler
showed the change spreading through the request/response boundary and the
computation layer at once. A half-converted money layer is worse than a
clearly-bounded one, so it was rolled back to the verified state above.

#### Third group — `ParcelCoverageTier` as a type — **DONE**

The unit the previous batch failed on, done properly: the struct fields *and*
both methods moved together, rather than swapping fields and leaving the
signatures behind.

```go
// was
func (t ParcelCoverageTier) CoverageFeeKes(declaredValueKes float64) float64
func (t ParcelCoverageTier) CoveredAmountKes(declaredValueKes float64) float64
// now
func (t ParcelCoverageTier) CoverageFee(declared money.Cents) money.Cents
func (t ParcelCoverageTier) CoveredAmount(declared money.Cents) money.Cents
```

There is no float left anywhere in this path. The earlier step-2 version was
exact *inside* the method but converted in and out of `float64` at the
signature, which meant the boundary could still round differently from the
arithmetic within it. `CoveredAmount` also collapsed to a plain `Min`, which is
what it always meant.

`FeePct` deliberately stays `float64`: it is a rate, not an amount.
Percentages have no smallest unit to be exact about, and `money.Cents` would
imply one.

Moved with it:

- `scanCoverageTier` reads the money columns **straight into `money.Amount`**
  via the `sql.Scanner` added for the courier-earnings pilot — no intermediate
  string, no `parseFloatOrZero`.
- `UpsertCoverageTier` binds `$2::numeric` / `$3::numeric` from
  `driver.Valuer`, so an admin's edit reaches the Decimal column without ever
  being a float.
- The booking-time freeze in `parcels.go` and the two quote endpoints, so the
  number frozen onto a parcel is the same method call the sender was quoted.
- `CoverageEditor.tsx` — the money fields are now strings end to end, with no
  `Number()` in either direction. Its dirty check compares *amounts* rather than
  text, so `"25000"` and `"25000.00"` no longer read as an unsaved edit, and
  what the admin types is normalised to an exact 2dp decimal on save.

Three tests, two of them new invariants rather than restatements:

- the original cap agreement, unchanged in meaning — only in unit
- a fee percentage that lands off-cent (`0.35%` of `1,999.99` = `6.999965`)
  must resolve to exactly `7.00`
- across the cap boundary, the fee computed on the declared value must equal
  the fee computed on the covered amount — i.e. a sender is never charged a
  premium against an amount a claim could not pay out
- plus a direct assertion of the JSON shape, since nothing else in the suite
  would notice `MarshalJSON` regressing to a number

### Step 3b — **COMPLETE**

Every money field core-go emits is now a decimal string. The sweep is empty:

```
float64 money json fields in core-go:  NONE
float tolerances in money paths:       NONE
```

Converted in the final pass: the agent / COD-policy / courier-tariff group
(`holdingFeeKes`, `maxAmountKes`, `perKmKes`, `perDeliveryKes`,
`maxPerDeliveryKes`), the price band (`minKes`/`maxKes`), the installment
balance view (`totalKes`/`amountPaidKes`/`balanceKes`), voucher balances,
parcel-org revenue, and the COD remit/settle responses — each with its
TypeScript and Dart consumers in the same change.

`ParcelCourierTariff.EarningsFor` and `ParcelPriceBand` moved to `money.Cents`
end to end, the same way `ParcelCoverageTier` did. `money.Cents.Scale` was added
for rate × quantity (per-km × distance), which `Percent` and integer multiply
did not cover.

#### A measurement error worth recording

An earlier pass reported "NONE remaining" when seven fields were still
`float64`. The grep matched `(Kes|KES)[A-Za-z]* float64`, which requires the
field name to *begin* with `Kes` — so it silently missed `MinKes`, `MaxKes`,
`TotalKES`, `RevenueKes` and others. The corrected pattern anchors on the field
name ending in `Kes`/`KES`:

```
grep -rE '^\s*[A-Za-z]*(Kes|KES)\s+\*?float64\s+`json:'
```

A second surface was missed for the same reason: money emitted through `gin.H`
maps carries no struct tag at all, so no tag-based grep can see it. Those were
found only by searching for the JSON key itself.

#### Six float tolerances, all removed

Every one was the same workaround, written independently by different people in
different languages:

| Where | Was | Guarding |
|---|---|---|
| `ledger.go` | `sum < -0.005 \|\| sum > 0.005` | the double-entry balance invariant |
| `complete_delivery_screen.dart` | `short <= 0.004` | a courier's COD shortfall |
| `CodConsole.tsx` | `inPocket > 0.004` ×4 | cash still with a rider |
| `PayoutConsole.tsx` | `done.shortfallKes > 0.004` | a courier payout shortfall |
| `RiderCashPanel.tsx` | `result.shortfallKes > 0.004` | a rider's cash-up |
| `parcels.go` | `priceTolerance = 0.5` | price re-validation round-tripping |
| `handlers_payments_webhook.go` | `math.Abs(cb.Amount-expected) > 0.005` | **M-Pesa callback amount verification** |

The last one is the one to note: it decided whether a real M-Pesa payment
matched what was asked for. It now compares exact cents.

`priceTolerance` is kept at one cent rather than deleted — a client may
legitimately round its own display before sending — but it is no longer
covering for arithmetic.

#### Previously remaining, now done

`amountKes` (239 TS references), `balanceKes` (64), `feeKes` on the non-parcel
surfaces (45), and the `ParcelAgent` / COD-policy / courier-tariff editors
(`holdingFeeKes`, `maxAmountKes`, `perKmKes`, `perDeliveryKes`,
`maxPerDeliveryKes`).

The agent/policy/tariff group is the same shape as this one — a type plus its
editor — and is the natural next unit. `amountKes` and `balanceKes` remain the
hard ones for the provenance reason above: they are read from both Prisma and
core-go, and separating those call sites needs tracing rather than grep.

#### Original sequencing note (superseded by the table above)

This is the breaking half and must not be swept. `Amount` marshals to a string,
which changes the shape a consumer sees, and there are **587 money-field reads
across 112 TypeScript files**. A response field moves only together with the TS
code that reads it — endpoint by endpoint.

The machinery is in place: changing a response field's type to `money.Amount`
is now a one-line change per field. What is *not* in place is the per-endpoint
pairing with its consumer, which is the actual work.

Sequencing note: prefer endpoints mobile owns end-to-end first (the parcel COD
and delivery surfaces), since `Money.fromJson` already accepts both shapes and
those have no TS consumer to coordinate with. Leave the ticketing and store
surfaces — which `apps/app`, `apps/web` and `apps/store` all read — until last.

#### Original plan for reference

Serialise money as a **decimal string** everywhere, matching what Prisma already
emits: `{"priceKes": "254.15"}`. This is the standard financial-API choice and
the only one that survives JavaScript clients, whose `number` is a float64 too.

This is the coordinated step — five web apps plus mobile. Mobile is already
ready: `Money.fromJson` accepts strings today, and `Money.toWire()` emits them.
Do it per-endpoint behind a version or an `Accept` header rather than as one
cutover.

---

## 6. Test to add alongside step 1

Done as part of step 1. The ledger deserved the same treatment `Money` got — a test that asserts the
*old* behaviour was wrong, so the tolerance cannot come back:

```go
func TestPostEntryRejectsImbalance(t *testing.T) {
    // Under the old float tolerance this imbalance was ACCEPTED and
    // written to the ledger. It must now be rejected.
    postings := []Posting{
        {AccountID: a, AmountCents: 10000},
        {AccountID: b, AmountCents: -9999}, // one cent out
    }
    _, err := PostEntry(ctx, pool, ref, desc, key, postings)
    require.Error(t, err)
}
```

---

## 7. The principle

Money is a count, not a measurement. Store it, move it, and compute it as an
exact integer of the smallest unit; convert to a decimal only to display it.

Every tolerance constant in a money path — `0.004`, `0.005`, or any other — is
a representation bug with a comment on it. When you find one, fix the type, not
the threshold.
