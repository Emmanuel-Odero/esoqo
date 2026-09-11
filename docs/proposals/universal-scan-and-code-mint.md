# One Scanner, One Code, No Collisions

**Status:** implemented
**Scopes:** `core-go` (fleetqr, dbx/scan, voucher/trip/ticket/payment-id minting, handlers_scan), mobile universal scanner + Settings payment QR.
**Problem it solves:** Esoko has more kinds of QR than screens, and short codes were minted with modulo-bias randomness and no retry-on-conflict — a real collision surface as Esoko scales past a few thousand users (the payment-id space was `ESK-1000-KE`..`ESK-9999-KE`, only 9,000 codes).

---

## 1. The minting contract

Every code Esoko issues is a **short code** (`PREFIX-RANDOM`) with a registered prefix, a unique constraint in Postgres, and — for the codes people actually type or scan *by hand* — a checksum character so a fat-fingered digit gets a fast "not a code" instead of silently mis-routing.

| Prefix | Issuer | Space | Checksum |
| --- | --- | --- | --- |
| `TRIP-` / `BUS-` | trip QR rotate | 31^6 (~887M) | yes (checked) |
| `VCH-` | voucher mint | 31^6 | yes (checked) |
| `TKT-` | ticket booking | 31^10 | no (space is large enough) |
| `PKP-` | store pickup | `PKP-` + 6 | no |
| `ESK-…-KE` | payment id | 31^6 | no |

All codes are **retried on unique-violation** (SQLState `23505`) by re-rolling the random segment within the same transaction, so a collision is a one-line retry, never an error surfaced to a user. `fleetqr`'s randomness is unbiased — it samples from `31` symbols via `rand.Int(rand.Reader, big.NewInt(31))` instead of `int(r)%31`, which previously drifted toward the smaller ASCII value.

`fleetqr` exposes:
- `ShortCode(prefix, n?)` — unbiased unchecked code.
- `ShortCodeChecked(prefix, n)` — `PREFIX-` + segment + **weighted positional checksum char** (`WithCheck`); validated by `CheckedShape(prefix, code, n)`.
- `Sign` / `Verify` + `TripPayload` / `VoucherPayload` — the signed deep-link payloads (`esoko://t?…`, `esoko://v?…`) unchanged.

## 2. The universal resolver

`GET /v1/scan/resolve?code=` (public, guest-safe) — one code in, one kind + action out:

`trip | voucher | fare | product | store | table | ticket | order | party | certificate | unknown`

Dispatch order (Go owns it; the app never sniffs):
1. Signed deep links `esoko://t?` (trip) and `esoko://v?` (voucher public).
2. `esoko://table?`, `esoko://s?` (store shelf), `esoko://p?` (product).
3. Registered short-code prefixes via table lookup, with **checksum-typo pre-reject** for `TRIP-/BUS-/VCH-` 11-char codes (an old unchecked shape still resolves).
4. Product barcode (SKU), then fare-proof code (`FareProofForCode`).
5. Hex-only, length ≥ 8 → certificate attestation id (`ResolveCertificateByCode`).
6. `unknown`.

New public-safe projections, mirroring the website's typed flows:
- **ticket** — `ResolveTicketByCode`: class, event, org, seat, price, status (join ticket→class→booking→schedule→listing→org, LEFT JOIN seat).
- **order** — `ResolveOrderByPickupCode`: pickup code, store, total, status, ready-at (reuses `orderStatusSelect`).
- **party** — `ResolvePartyByPaymentID` for `ESK-…` codes: display name (knownAs→officialName→organisation name→**Withheld**), verified flag from the `MSISDN_VERIFIED` attestation, organisation flag.
- **certificate** — `ResolveCertificateByCode`: valid / expiring / expired / revoked, prettified claim type, holder, issuer; mirrors `packages/db` `verifyCertificate`.

Each projection carries an `action` hint (`pay | menu | checkout | pickup | verify | open | info`) the app uses to decide route-vs-inline-card. Anything crew-only (full fare details, check-in) stays behind the existing verify rule; guest scans get the safe stub.

## 3. Mobile

- `scan_repository.dart` adds `ScanResolution` with the five inline card models (`ScanFareProof`, `ScanTicketInfo`, `ScanOrderInfo`, `ScanPartyInfo`, `ScanCertInfo`); still only ever reads `/v1/scan/resolve`.
- `universal_scan_screen.dart` routes new kinds to inline cards:
  - **ticket** — class/event/seat/price + validity pill.
  - **order** — pickup status pill (ready/collected) + store + total + code.
  - **party** — avatar, name, mono `ESK-` code, "Verified on Esoko" pill.
  - **certificate** — found/not-found, status pill, holder, issuer, validity dates; "not found" points to esoko.co.ke/verify.
  - hint row now lists `BUS- · VCH- · TKT- · PKP- · ESK-`.
- **Settings** tab grows a **"My payment QR"** card: `QrImageView` of the user's `esokoId`, the mono code underneath, a Copy button, and "Show this when paying at a shop or to another person."

## 4. Consequences / notes

- Old unchecked voucher/trip codes still resolve (checksum guard only rejects a *mismatched* check char, not its absence).
- ESK codes are no longer tied to a 9,000-code space; `EnsureEsokoPaymentId` retries 5× on conflict.
- Ticket and pickup codes keep their prior treatment (unchecked, large or unique-retried space).
- Web end-to-end gate already types the same resolver; the documented camera follow-up is unchanged.

## 5. Verification

- `go build ./...`, `go vet ./...`, `go test ./...` — pass; new `internal/fleetqr/qr_test.go` covers shape, unbiased sampling, checksum determinism/sensitivity, registry, sign/verify, payload round-trips.
- `flutter analyze --no-pub`, `flutter test`, `flutter build web --release` — pass.