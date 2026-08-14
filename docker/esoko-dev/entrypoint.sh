#!/bin/sh
# esoko-dev entrypoint — installs deps only when actually needed, then
# hands off to `pnpm dev`.
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

exec pnpm dev
