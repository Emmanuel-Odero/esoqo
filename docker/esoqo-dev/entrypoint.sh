#!/bin/sh
# esoqo-dev entrypoint — installs deps only when actually needed, then
# hands off to a pnpm dev task.
#
# Which task is DEV_TASK (default "dev:apps"). The default deliberately
# does NOT run every workspace: five Next.js Turbopack dev servers plus
# the core service do not fit in a Docker Desktop VM on a 16GB host —
# they leak until V8's heap cap, and a global OOM then takes the whole
# stack down. "dev:apps" runs web, app, admin, store and core-service
# (see package.json); run the full set with DEV_TASK=dev when needed.
#
# Why this exists: docker-compose.yml bind-mounts the whole repo into
# /app for hot-reload. That bind mount would also overlay every
# workspace's node_modules (apps/*/node_modules, packages/*/node_modules,
# services/core/node_modules, ...) with whatever's on the HOST — which is
# either empty (nobody ran `pnpm install` locally) or full of macOS
# binaries that don't run in this Linux container. So docker-compose.yml
# gives each workspace's node_modules its own named volume, taking it out
# of the bind mount entirely; those volumes persist across container
# restarts/recreates.
#
# Given that, install only needs to run when it actually could have
# changed something: first boot (volumes empty) or pnpm-lock.yaml has
# changed since the last install. Otherwise skip straight to `pnpm dev` —
# no multi-minute reinstall on every `docker compose restart`.
set -eu

STAMP=/app/node_modules/.install-stamp
LOCKFILE_HASH=$(sha1sum /app/pnpm-lock.yaml | cut -d' ' -f1)

if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$LOCKFILE_HASH" ]; then
  echo "==> installing dependencies (lockfile changed or first boot)"
  pnpm install --frozen-lockfile
  echo "$LOCKFILE_HASH" > "$STAMP"
else
  echo "==> dependencies up to date, skipping install"
fi

# The generated Prisma client lands in the root node_modules volume, so it
# survives restarts — which is the problem. A schema edit does not touch
# pnpm-lock.yaml, so the install above is *correctly* skipped, and the
# container then boots a stale client that starts fine and fails at runtime
# with "Unknown argument" / "Field does not exist" errors that read as bugs
# in your own code. Key the stamp on the schema as well as the lockfile, so
# a Prisma version bump invalidates the generated client too.
GEN_STAMP=/app/node_modules/.prisma-generate-stamp
GEN_KEY=$(cat /app/pnpm-lock.yaml /app/packages/db/prisma/schema.prisma | sha1sum | cut -d' ' -f1)

if [ ! -f "$GEN_STAMP" ] || [ "$(cat "$GEN_STAMP")" != "$GEN_KEY" ]; then
  echo "==> generating Prisma client (schema or lockfile changed, or first boot)"
  (cd /app/packages/db && pnpm exec prisma generate)
  echo "$GEN_KEY" > "$GEN_STAMP"
else
  echo "==> Prisma client up to date, skipping generate"
fi

exec pnpm "${DEV_TASK:-dev}"
