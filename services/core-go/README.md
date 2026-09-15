# core-go

Esoqo's mobile-facing REST API (Gin), for the Flutter apps (Android, iOS,
Wear OS). See `docs/adr/0005-mobile-api-in-go.md` for why this exists
alongside `services/core` (TypeScript/Fastify), and the plan this was
scaffolded from for what comes next (groups/chamas, shopping, ticketing
domain endpoints).

## Phase 0 scope (current)

Auth only — enough to prove the pattern end to end before any domain
endpoint is added:

- `GET /health`, `GET /ready` (walks the same audit hash chain as
  `services/core`'s `/ready` — see `packages/db/src/audit.ts`, ported in
  `internal/audit`).
- `POST /v1/auth/otp`, `POST /v1/auth/verify-otp` — Kenyan-mobile-only OTP,
  ported 1:1 from `packages/auth/src/otp.ts`. A verified `SIGN_IN` OTP
  auto-provisions a bare Party+Person on first use and issues a session
  directly (mobile-first: OTP proves the number, PIN is set afterwards
  for faster subsequent sign-ins).
- `POST /v1/auth/sign-in` — returning-user PIN sign-in, Argon2id +
  anti-enumeration (`DUMMY_PIN_HASH`) + 5-strike/15-minute lockout, ported
  from `packages/auth/src/pin.ts` and `packages/db/src/dal/auth-credential.ts`.
- `POST /v1/auth/set-pin`, `POST /v1/auth/sign-out` (authenticated).
- `GET /v1/me` (authenticated) — profile + live capability list.

Sessions are **bearer tokens**, not cookies — same opaque-token-in-Redis
design as `packages/auth/src/session.ts` (`ctxFromToken`), just carried as
`Authorization: Bearer <token>` instead of `esoko_session`. See
`internal/authsvc/session.go`.

## Known gaps (tracked, not accidental)

- First-time sign-up records `county = "Unknown"` on the new Party (see
  `dbx.FindOrCreatePersonByMsisdn`) — there's no fuller onboarding step
  yet on the mobile side to collect it properly.
- Only the `SUBJECT` capability preset is ported (`internal/authsvc/capabilities.go`)
  — STAFF/AGENT stay TypeScript-only until an admin-facing mobile surface
  exists.
- No sqlc/codegen yet — `internal/dbx` is hand-written SQL against
  `packages/db/prisma/schema.prisma`'s existing tables. Every column name
  is quoted camelCase (Prisma leaves columns at their default field name,
  only tables get `@@map`'d to snake_case) — get this wrong and Postgres
  silently folds the identifier to lowercase and misses the real column.

## Running locally

Against the repo's existing `docker compose` stack (`pnpm stack:up`):

```bash
cd services/core-go
DATABASE_URL="postgresql://esoko:esoko_dev_only@localhost:6432/esoko?sslmode=disable" \
REDIS_URL="redis://localhost:6379" \
APP_ENV=development \
AUDIT_CHAIN_SEED="<same value as .env's AUDIT_CHAIN_SEED>" \
go run ./cmd/api
```

`GIN_MODE=release` before deploying — Phase 0 leaves Gin's debug route
dump on since this only ever runs locally so far.

Then seed reference data, demo fixtures and 20 ready-to-use sign-in
accounts (no self-serve sign-up screen exists, so this is how you get a
signed-in session locally without an SMS provider):

```bash
go run ./cmd/seed
```

See **[DEMO_ACCOUNTS.md](./DEMO_ACCOUNTS.md)** for the full phone/PIN
list — store owners, ticketing/transport company owners, every
org-staff-grant role (including a suspended one and a "dual hat" account
that owns a company *and* holds a staff grant elsewhere), and plain
shoppers.
