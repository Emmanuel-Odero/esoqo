# Contributing to Esoqo

This is the engineer's guide: how to get the app running, how a change
moves from your laptop to production, how migrations work, and what's
actually true about the deploy pipeline today (as opposed to what an
older doc assumed). If something here and `docs/deployment/README.md`
disagree, this file is the more recently verified one — see the dated
note in each section.

---

## 1. Local setup

```bash
cp .env.example .env
pnpm install
pnpm stack:up            # postgres · pgbouncer · redis · mailhog · mock-sms
pnpm db:generate
pnpm db:migrate
pnpm db:seed              # creates the one staff login the admin app needs
pnpm dev
```

| Surface | URL |
|---|---|
| Public site (`web`) | http://localhost:3000 |
| Subject app / join flow (`app`) | http://localhost:3001 |
| Operations (`admin`) | http://localhost:3002 |
| Store — merchant, storefront, PoS (`store`) | http://localhost:3003 |
| Core API (`core-service`) | http://localhost:4000 |
| Core Go (`core-go`) | http://localhost:4100 |
| Mail catcher | http://localhost:8025 |
| SMS catcher | http://localhost:8026 |
| DB UI | `docker compose --profile tools up -d adminer` → :8080 |

Full detail (seeded logins, provider modes, what's real vs scaffolded)
is in the root `README.md` — this file doesn't repeat it.

**Stale checkout gotcha:** this repo gets switched between branches a
lot. Docker containers/volumes and per-app `.env` files are gitignored
and don't reset on `git checkout` — a container named `esoqo-postgres`
or a `packages/db/.env` full of credentials can silently be left over
from whatever branch was checked out last, and it'll happily keep
serving stale schema/`node_modules` to whatever branch you're actually
on now. If something that should work doesn't, run
`docker compose ls -a` and diff `packages/db/.env` against the root
`.env` before assuming the code is broken.

---

## 2. Branches and environments

| Branch | Environment | Namespace | Domain |
|---|---|---|---|
| `main` / `dev` | — (integration only, no environment) | — | — |
| `preview` | Preview | `esoqo-preview` | `preview.esoko.global` + `preview-<app>.esoko.global` (Cloudflare Access) |
| `production` | Production | `esoqo-production` | `esoqo.com` (+ `esoko.global`, which 301s to it) |

`dev` and `main` are currently identical (same commit) and don't map to
a running environment — they're where feature branches land before
promotion. **`estore`** is a long-lived feature branch (eStores admin
commerce console) not yet merged to `main`; check it if you're working
on that area.

**⚠ As of 2026-09-27, `preview` and `production` have diverged** — a
session doing infra work committed several fixes directly to
`production` (namespace/cert-manager/branch-name corrections, the
`esoko.global` → `esoqo.com` redirect) that were never merged back to
`preview`, while `preview` picked up a couple of its own
cert-manager-fix commits `production` doesn't have. Check
`git log --oneline origin/production..origin/preview` and the reverse
before assuming a plain `git merge --ff-only preview` from `production`
will work — it currently won't. Reconcile deliberately (merge, don't
force) before the next promotion.

**The intended flow, once branches are back in sync:**

```bash
# land your change on preview
git checkout preview && git pull
# ... work, commit ...
git push

# after preview is verified healthy, promote
git checkout production && git pull
git merge --ff-only preview     # refuses if diverged — see above
git push
```

Production is meant to always be a fast-forward of an already-green
preview — never a branch preview hasn't run.

---

## 3. What actually deploys code — read this before assuming CI/CD works

`docs/deployment/README.md` describes a GitOps model: push to a branch,
GitHub Actions builds images and bumps the tag, Rancher Fleet notices
the commit and applies it. **That pipeline is not currently operating.**
Three independent things are broken or unconfirmed, discovered and
verified 2026-09-27:

1. **GitHub Actions is broken at the platform level, not the YAML
   level.** Every push-triggered run — on every branch — resolves to a
   deleted, orphaned workflow record (`workflow_id` whose own metadata
   is `{"name":"","path":"BuildFailed","state":"deleted"}`) instead of
   the real, active workflow, and instantly fails with 0 jobs. Proved
   this is unrelated to the workflow file itself: deleting
   `build-images.yml` entirely and pushing still produced a new run
   bound to the same dead workflow_id. This needs a GitHub support
   ticket (server-side routing/cache issue) — nothing in this repo can
   fix it. **Do not spend time editing workflow YAML in response to a
   `startup_failure`** — check `gh run list` and the workflow's own
   `runs` count first; if the real workflow has 0 runs ever, this is
   the same bug.
2. **Fleet's actual state is unconfirmed and looks disconnected.** The
   Rancher account available for day-to-day work is namespace-scoped
   (`esoqo-preview`/`esoqo-production` only — confirmed via
   `kubectl auth can-i ... --all-namespaces` → `no`), which has no
   visibility into `fleet-default` or any cluster-scoped resource.
   Every deploy done in practice has been a direct
   `kubectl apply -k deploy/k8s/overlays/<env>`, not a git push. Don't
   assume pushing a commit alone does anything to the cluster.
3. **Branch protection isn't available on this GitHub plan** — private
   repo, free tier, `gh api repos/.../branches/production/protection`
   returns 403 ("Upgrade to GitHub Pro"). So even if Actions worked,
   nothing currently stops an untested commit from reaching a
   deployable branch.

**What this means in practice: deploying is a manual, two-step process
— build+push the images, then apply the manifests.** See §5.

---

## 4. Getting cluster access

You need a kubeconfig scoped to your Rancher role:

1. Log into https://rancher.2lovelaces.io
2. **Cluster Management** → check the `local` cluster's row → **Download
   KubeConfig** (top toolbar button — you must tick the row's checkbox
   first, the button stays disabled otherwise)
3. `export KUBECONFIG=~/path/to/that/file.yaml`
4. Verify your actual rights before assuming anything:
   ```bash
   kubectl auth can-i create deployments -n esoqo-preview
   kubectl auth can-i create deployments -n esoqo-production
   kubectl auth can-i create deployments --all-namespaces   # almost certainly "no"
   ```

A restricted role produces a kubeconfig that authenticates fine and
then refuses everything — which reads like a broken manifest, not a
missing role. If `can-i` says `no` for a namespace you need, that's a
Rancher project-membership problem, not something to work around.

---

## 5. Deploying a change

### 5.1 Build and push the images

`deploy/scripts/build-and-push.sh` is the real deploy trigger right
now (GitHub Actions being broken, per §3). It must be run from the
branch it's building for, with a clean working tree — the image tag is
the commit SHA, so an uncommitted change would ship inside an image
labelled with a commit that doesn't contain it.

```bash
git checkout preview          # or production
deploy/scripts/build-and-push.sh preview   # or: production
```

Needs:
- `docker login ghcr.io` with a PAT that has **`write:packages`
  scope**. This is the single most common way this script silently
  "hangs" — a token missing that scope does not error, it just sits
  at "pushing layers" forever with zero progress and zero errors,
  indistinguishable from a real network stall. If a push has been
  stuck for more than ~2 minutes with no layer ever resolving,
  check the token's scopes before assuming anything about network,
  image size, or GHCR throttling:
  ```bash
  curl -sSI -H "Authorization: token $PAT" https://api.github.com/user \
    | grep -i x-oauth-scopes
  ```
- `kustomize` on PATH (`brew install kustomize` — kubectl's built-in
  kustomize can't `edit set image`).
- ~15GB free Docker disk, and patience: building all 7 images under
  QEMU emulation (any Apple Silicon Mac, since the cluster is amd64)
  takes 25–40 minutes cold. `--platform linux/amd64` is not optional —
  a plain `docker build` produces an arm64 image that fails on the
  cluster with "no match for platform in manifest".
- If you only need to rebuild one or two apps rather than all 7 (e.g.
  after fixing a bug in a single service), it's faster to invoke
  `docker buildx build --platform linux/amd64 --push` directly for
  just that Dockerfile, then `kustomize edit set image` for that one
  image inside the overlay dir, rather than re-running the full script.

The script commits the tag bump into `deploy/k8s/overlays/<env>/
kustomization.yaml` for you. Push that commit — even though nothing is
watching it right now (§3), it's still the record of what's actually
running, and it's what a future working Fleet setup would react to.

### 5.2 Apply it to the cluster

```bash
export KUBECONFIG=~/path/to/your.kubeconfig
kubectl apply -k deploy/k8s/overlays/preview        # or production
```

Watch the rollout:

```bash
kubectl get pods -n esoqo-preview -w
kubectl rollout status deploy/web -n esoqo-preview --timeout=5m
```

If a migration Job was part of this change (new commit SHA → new Job
name, since `spec.template` is immutable — see §6), confirm it
actually succeeded, not just that pods came up:

```bash
kubectl get jobs -n esoqo-preview
kubectl logs -n esoqo-preview -l app.kubernetes.io/name=migrate --tail=50
```

### 5.3 Verify

```bash
curl -sS https://preview-api.esoko.global/health     # UI hosts are behind Cloudflare Access
# production:
curl -sS https://esoqo.com/api/health
curl -sS https://api.esoqo.com/ready      # walks the audit chain
```

---

## 6. Migrations

### Writing one

```bash
# edit packages/db/prisma/schema.prisma, then:
pnpm --filter @esoqo/db migrate       # runs `prisma migrate dev` — prompts for a name, applies locally
```

This generates a new folder under `packages/db/prisma/migrations/` with
a timestamped name and a `migration.sql`. **Read the generated SQL
before committing it** — Prisma's migration diffing is usually right
but not infallible, and for anything beyond a trivial additive column
it's worth confirming by hand. Commit the migration folder along with
the schema change in the same PR.

### Running migrations fresh (new environment, or "did they actually apply?")

The migrate `Job` (`deploy/k8s/base/migrate-job.yaml`) runs
`prisma migrate deploy` against `DIRECT_DATABASE_URL` (never
`DATABASE_URL`/PgBouncer — Prisma migrations don't survive transaction
pooling). It's applied as part of `kubectl apply -k` per §5, but you
can also run it by hand against a live pod if you need to force a
retry without waiting for the next deploy:

```bash
kubectl exec -n esoqo-production deploy/core-service -- sh -c \
  'cd /repo/packages/db && pnpm exec prisma migrate deploy'
```

**If this fails with `P3009` ("found failed migrations")** — Prisma
found a migration marked as started-but-never-finished (usually because
the database wasn't reachable yet the first time it ran, or the
migration's own SQL has a real bug) and refuses to touch anything past
it, on every subsequent run, until you resolve it explicitly:

```bash
# only if you've confirmed the underlying cause is fixed / the tables
# it touches are actually empty and it's safe to consider a no-op:
kubectl exec -n esoqo-production deploy/core-service -- sh -c \
  'cd /repo/packages/db && pnpm exec prisma migrate resolve --rolled-back <migration_name>'
# then retry
kubectl exec -n esoqo-production deploy/core-service -- sh -c \
  'cd /repo/packages/db && pnpm exec prisma migrate deploy'
```

The real error is often hidden behind a generic cascading "current
transaction is aborted" message in the migrate Job's own log — check
`kubectl logs postgres-0` (the actual Postgres pod) around the same
timestamp for the real `ERROR:` line if the migrate Job's log isn't
telling you anything useful.

**If a migration was baked into an old image tag and the bug gets
fixed in git afterward**, the deployed image still has the broken SQL
compiled in until you rebuild it. You can unblock the *database* state
without waiting for a rebuild by `kubectl cp`-ing the corrected
`migration.sql` into a running pod (even one still running the old
image) before running `migrate resolve --applied` — Prisma computes
the checksum from whatever `migration.sql` it finds locally, so this
lets the checksum match the fixed version:

```bash
kubectl cp packages/db/prisma/migrations/<name>/migration.sql \
  esoqo-production/<pod>:/repo/packages/db/prisma/migrations/<name>/migration.sql
kubectl exec -n esoqo-production <pod> -- sh -c \
  'cd /repo/packages/db && pnpm exec prisma migrate resolve --applied <name> && pnpm exec prisma migrate deploy'
```

### Breaking / destructive schema changes

Migrations and app pods are applied in the same pass, with nothing
sequencing them — old and new pods run side by side mid-rollout. An
**additive** migration (new table, new nullable column) is safe as-is.
A **destructive** one (dropped/renamed column, tightened constraint) is
not — use expand/contract across two releases:

1. **Expand.** Add the new column. Write to both old and new paths,
   read from old. Deploy. Backfill.
2. **Contract.** Switch reads to the new column, stop writing the old
   one. Only now drop it, in a later release.

Take a manual backup before either step for anything beyond a trivial
additive change — see `docs/deployment/README.md` §10.

---

## 7. Code quality gates

These run in CI (`ci.yml`) — except CI doesn't currently run (§3), so
**run them yourself before opening a PR**:

```bash
pnpm lint        # includes the DAL-import lint rule and a11y rules
pnpm typecheck
pnpm test
pnpm --filter @esoqo/db audit:verify   # audit hash-chain integrity
```

The three rules that matter most (full reasoning in the root README):
1. **Authorisation lives in the Data Access Layer**, never in
   `proxy.ts`/middleware — enforced by a lint rule forbidding Prisma
   imports outside `packages/db`.
2. **Balances are derived, never stored** — no balance column, ever.
3. **If it can't work on USSD, it's not a core feature.**

---

## 8. Where to go next

- `docs/deployment/README.md` — the full ops runbook: cluster
  bootstrap, TLS/cert-manager, backups/restore, rollback, and a
  troubleshooting table. Treat its §3.9 and any "as of 2026-09-27"
  notes as the currently-true parts; treat the Fleet/GitHub-Actions
  narrative in §1–§7 as the *intended*, not current, state per §3
  above.
- `docs/adr/` — architecture decisions (why auth is DAL-only, why
  `services/core-go` exists, why the domain schema is one Postgres
  DB rather than one per bounded context, etc).
- `docs/SDD.md` — the software design document, for the domain model
  and cross-app request flows.
