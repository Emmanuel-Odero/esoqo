# CECF WordPress — Bedrock + Sage multisite network

WordPress for the **Child Elder Care Foundation**, deployed as its own Render
service inside this monorepo. One [Bedrock](https://roots.io/bedrock/)
codebase + one shared MariaDB database serve every CECF property
(`childeldercare.foundation`, `donate.*`, `blog.*`, ...) as blogs in a
**subdomain multisite network** — nginx + php-fpm run together in a single
container/instance, so "different sites, shared resources" happens at the
database-table level (`wp_2_posts`, `wp_3_posts`, ...), which is what real
WP Multisite already gives you.

The Sage theme (`web/app/themes/cecf-sage`) is a **real pnpm workspace
package** (`@esoqo/cecf-sage-theme`) — it shares this repo's
`pnpm-lock.yaml`, pnpm store, and Turbo build cache with every Node app here.
That's why the Dockerfile's build context is the **repo root**, not this
folder — the theme-build stage needs the workspace files to resolve.

## Layout

```
services/cecf-wordpress/
├── composer.json / composer.lock      # Bedrock root
├── config/                            # env-driven WP config (Bedrock)
├── web/
│   ├── wp/                            # WordPress core (composer-installed, not committed)
│   ├── wp-config.php
│   └── app/                           # wp-content, renamed by Bedrock
│       ├── mu-plugins/
│       ├── plugins/
│       ├── uploads/                   # mounted disk in prod
│       └── themes/cecf-sage/          # Sage theme, pnpm workspace package
├── docker/                            # nginx.conf, supervisord.conf, entrypoint.sh
└── Dockerfile                         # multi-stage: pnpm theme build → composer vendor → php-fpm+nginx runtime
```

## Local development

```sh
pnpm cecf:up      # docker compose --profile cecf up -d
pnpm cecf:logs
pnpm cecf:down
```

Point `childeldercare.test` and `*.childeldercare.test` at `127.0.0.1` in
`/etc/hosts` (or use a wildcard-capable local DNS tool) to exercise the
multisite subdomain routing locally. The site is otherwise reachable at
`http://localhost:8090`.

First boot runs `wp core multisite-install` automatically
(`docker/entrypoint.sh`) using `WP_ADMIN_USER` / `WP_ADMIN_PASSWORD` /
`WP_ADMIN_EMAIL` — required env vars with no defaults, by design, so a
production deploy can't silently install with a guessable admin account.

To work on just the theme without the PHP stack:

```sh
pnpm --filter @esoqo/cecf-sage-theme dev     # Vite dev server
pnpm --filter @esoqo/cecf-sage-theme build
```

## Deployment (Render)

Two blueprint entries in the root `render.yaml`, not a separate blueprint:

- **`cecf-wordpress`** — `runtime: docker`, `dockerContext: .` (repo root),
  persistent disk mounted at `web/app/uploads`.
- **`cecf-mariadb`** — a private service (`type: pserv`, no public ingress)
  running the official `mariadb:11` image with its own persistent disk.
  Render has no managed MySQL/MariaDB offering, so this is self-hosted;
  it is **not** covered by Render's managed-Postgres backups/failover.

`DB_HOST`/`DB_PORT` on `cecf-wordpress` are wired via `fromService` to
`cecf-mariadb`'s internal address. `DB_PASSWORD` / `MARIADB_PASSWORD` are
each `sync: false` and must be set to the **same value** in the Render
dashboard for both services — the same manual-duplication pattern already
used for `SESSION_SECRET` etc. across `esoqo-web`/`esoqo-app`/`esoqo-admin`.

## Open follow-ups (deliberately not yet decided in code)

- **Object cache**: `docker/php` builds the `redis` PHP extension and
  `REDIS_URL` is wired through, but no cache plugin (e.g. `redis-cache`) is
  Composer-installed yet — it wasn't resolvable through this repo's
  `wp-packages.org` Composer mirror at scaffold time; needs the actual
  package name/repo confirmed, or install via WPackagist directly.
- **Backups**: `cecf-mariadb`'s disk is not independently snapshotted by
  Render. Add a `type: cron` service running `mysqldump` → R2/S3 before
  going live.
- **Wildcard TLS**: Render issues certs per hostname on custom domains, not
  wildcard. Either add every subsite hostname individually in the Render
  dashboard, or front the network with Cloudflare (also gets you free
  CDN/WAF for a nonprofit budget).
- **Plugin workflow**: Bedrock's default `DISALLOW_FILE_MODS = true`
  (`config/application.php`) blocks installing/updating plugins from the
  wp-admin dashboard — everything must go through Composer. Confirm this
  matches how CECF's non-developer admins expect to manage the site before
  launch; it's a deliberate security default, not an oversight.
- **Canonical domain**: decide `www.childeldercare.foundation` vs the bare
  apex as canonical and 301 the other — not yet configured.
- **Staging**: no second environment defined yet (e.g.
  `cecf-wordpress-staging` off a DB snapshot).
