#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Runs inside the esoqo-deployer Job (deploy/docker/Dockerfile.deployer),
#  one per push to `preview` or `production`, triggered by
#  services/ci-webhook. This is build-and-push.sh's logic, automated —
#  same images, same tags, same overlay edit, same commit — plus the
#  two steps that script always left to a human: pushing the commit,
#  and sequencing the migration strictly before any Deployment is
#  touched (migrate-job.yaml's own header documents that gap; this
#  closes it).
#
#  Required env (all set by ci-webhook when it creates this Job):
#    GIT_SHA, GIT_SHA_SHORT, GIT_REPO_URL, TARGET_BRANCH, NAMESPACE,
#    GIT_READ_TOKEN, GIT_WRITE_TOKEN
#
#  GHCR auth for the Kaniko builds themselves comes from the
#  ci-ghcr-push Secret mounted as a docker config file directly into
#  each Kaniko Job (see kaniko-job-template.yaml) — this script never
#  touches those credentials itself.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

: "${GIT_SHA:?}" "${GIT_SHA_SHORT:?}" "${GIT_REPO_URL:?}" "${TARGET_BRANCH:?}" "${NAMESPACE:?}"
: "${GIT_READ_TOKEN:?}" "${GIT_WRITE_TOKEN:?}"

REGISTRY="ghcr.io"
OWNER="emmanuel-odero"
TAG="$GIT_SHA_SHORT"
WORKDIR=/work
mkdir -p "$WORKDIR"

case "$TARGET_BRANCH" in
  preview)
    ENVIRONMENT="preview"
    OVERLAY="deploy/k8s/overlays/preview"
    WEB_URL="https://preview.esoko.global"
    APP_URL="https://preview-app.esoko.global"
    STORE_URL="https://preview-store.esoko.global"
    JAMII_ORIGIN="https://preview-jamii.esoko.global"
    ;;
  production)
    ENVIRONMENT="production"
    OVERLAY="deploy/k8s/overlays/production"
    WEB_URL="https://esoqo.com"
    APP_URL="https://app.esoqo.com"
    STORE_URL="https://store.esoqo.com"
    JAMII_ORIGIN="https://jamii.esoqo.com"
    ;;
  *)
    echo "error: unknown TARGET_BRANCH '$TARGET_BRANCH'" >&2
    exit 1
    ;;
esac

# ── GitHub Deployments API ──────────────────────────────────────────
# The pipeline's own record of a release is the tag-bump commit; this
# additionally publishes the release to the repo's Deployments tab (and
# the environment timeline next to it), which is otherwise empty because
# nothing here used to call the API. Purely informational: a failure to
# publish must never block or fail a real deploy, so every call is
# best-effort (`|| true`).
REPO_SLUG="${GIT_REPO_URL#https://}"
REPO_SLUG="${REPO_SLUG%.git}"
REPO_SLUG="${REPO_SLUG#github.com/}"
API="https://api.github.com/repos/${REPO_SLUG}"
DEPLOYMENT_ID=""

gh_api() { # method path [json-body]
  curl -fsS -X "$1" \
    -H "Authorization: Bearer ${GIT_WRITE_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API}$2" ${3:+--data "$3"}
}

deployment_status() { # state description
  [ -n "$DEPLOYMENT_ID" ] || return 0
  gh_api POST "/deployments/${DEPLOYMENT_ID}/statuses" \
    "{\"state\":\"$1\",\"environment_url\":\"${WEB_URL}\",\"description\":\"$2\"}" >/dev/null || true
}

# Post the terminal status from the exit path, so a failure anywhere
# below (verify gate, build, migration, rollout, push) is recorded as
# `failure` rather than leaving the deployment stuck on `in_progress`.
on_exit() {
  local code=$?
  if [ -n "$DEPLOYMENT_ID" ]; then
    if [ "$code" -eq 0 ]; then
      deployment_status success "Live on ${WEB_URL}"
    else
      deployment_status failure "Deploy failed (exit ${code})"
    fi
  fi
}
trap on_exit EXIT

# required_contexts:[] deliberately skips GitHub's commit-status gate:
# nothing here reports statuses (Actions is broken server-side), and the
# real pre-rollout gate is the in-cluster verify Job below.
DEPLOYMENT_JSON=$(gh_api POST "/deployments" \
  "{\"ref\":\"${GIT_SHA}\",\"environment\":\"${ENVIRONMENT}\",\"description\":\"Esoko ${ENVIRONMENT} ${GIT_SHA_SHORT}\",\"auto_merge\":false,\"required_contexts\":[],\"transient_environment\":false,\"production_environment\":$([ "$ENVIRONMENT" = production ] && echo true || echo false)}" || true)
DEPLOYMENT_ID=$(printf '%s' "$DEPLOYMENT_JSON" | jq -r '.id // empty' 2>/dev/null)
deployment_status in_progress "Building and verifying ${GIT_SHA_SHORT}"

echo "== deploying $GIT_SHA_SHORT ($TARGET_BRANCH) to $NAMESPACE =="

# ── 1. Clone the overlay at the exact triggering commit ─────────────
# Only deploy/k8s/... from this checkout gets used — the Kaniko Jobs
# below clone the same commit independently, straight from GitHub.
GIT_REPO_HOST_PATH="${GIT_REPO_URL#https://}"
AUTH_URL="https://x-access-token:${GIT_READ_TOKEN}@${GIT_REPO_HOST_PATH}"
git clone --filter=blob:none "$AUTH_URL" "$WORKDIR/repo"
cd "$WORKDIR/repo"
git checkout "$GIT_SHA"

# ── 1a. Ownership gate (defence in depth) ───────────────────────────
# ci-webhook already refuses any push whose GitHub *sender* is not in
# ALLOWED_PUSHERS, and only it can create this Job. But anyone with
# `edit` in the namespace could craft an esoqo-deploy-<sha> Job by hand
# and bypass that listener. Refuse to build/deploy a commit whose git
# identity is not the owner's (or the deployer bot, or GitHub's own
# merge/squash committer). Extra identities can be added via
# ALLOWED_GIT_IDENTITIES (comma-separated). This is deliberately generous
# so the owner's normal push/merge flows are never blocked, while a
# direct push by anyone else still is.
owner_idents=" emmanuelodero808@gmail.com 65104775+emmanuel-odero@users.noreply.github.com ci@esoqo.com noreply@github.com "
for extra in $(printf '%s' "${ALLOWED_GIT_IDENTITIES:-}" | tr ',' ' '); do
  owner_idents+=" $(printf '%s' "$extra" | tr 'A-Z' 'a-z') "
done
tip_author=$(git log -1 --format='%ae' "$GIT_SHA" | tr 'A-Z' 'a-z')
tip_committer=$(git log -1 --format='%ce' "$GIT_SHA" | tr 'A-Z' 'a-z')
if [[ "$owner_idents" != *" $tip_author "* && "$owner_idents" != *" $tip_committer "* ]]; then
  echo "error: refusing to deploy $GIT_SHA — authored by '$tip_author', committed by '$tip_committer'; neither is an authorised identity" >&2
  exit 1
fi

# ── 2. Build 7 images and run the test suite — all in parallel ──────
# Kaniko Jobs do the builds, registry-cached; the verify Job runs
# lint/typecheck/test against ephemeral Postgres+Redis. Both are applied
# here, together; the tests are then awaited as a gate below, before the
# migration and before any Deployment moves. A red suite aborts the
# release exactly like a failed build.
echo
echo "== building 7 images and running in-cluster CI in parallel =="

render_verify_job() {
  sed \
    -e "s|__TAG__|${TAG}|g" \
    -e "s|__NAMESPACE__|${NAMESPACE}|g" \
    -e "s|__GIT_SHA__|${GIT_SHA}|g" \
    -e "s|__GIT_REPO_HOST_PATH__|${GIT_REPO_HOST_PATH}|g" \
    deploy/k8s/base/verify-job-template.yaml
}

render_verify_job | kubectl apply -f -

render_kaniko_job() {
  local name="$1" dockerfile="$2"; shift 2
  # Remaining args are each one --build-arg=KEY=VALUE flag; every one
  # becomes its own YAML list item under `args:` — kaniko's container
  # args are argv entries, not a shell-split string, so these cannot be
  # collapsed into one line.
  local build_args_yaml=""
  for ba in "$@"; do
    build_args_yaml+="            - \"${ba}\""$'\n'
  done

  awk -v repl="$build_args_yaml" '{
    if ($0 == "__EXTRA_BUILD_ARGS__") { printf "%s", repl } else { print }
  }' deploy/k8s/base/kaniko-job-template.yaml \
  | sed \
    -e "s|__NAME__|${name}|g" \
    -e "s|__NAMESPACE__|${NAMESPACE}|g" \
    -e "s|__TAG__|${TAG}|g" \
    -e "s|__DOCKERFILE__|${dockerfile}|g" \
    -e "s|__GIT_REPO_HOST_PATH__|${GIT_REPO_HOST_PATH}|g" \
    -e "s|__GIT_SHA__|${GIT_SHA}|g" \
    -e "s|__REGISTRY__|${REGISTRY}|g" \
    -e "s|__OWNER__|${OWNER}|g" \
    -e "s|__ENVIRONMENT__|${ENVIRONMENT}|g"
}



NEXT_BUILD_ARGS=(
  "--build-arg=NEXT_PUBLIC_WEB_URL=${WEB_URL}"
  "--build-arg=NEXT_PUBLIC_APP_URL=${APP_URL}"
  "--build-arg=NEXT_PUBLIC_STORE_URL=${STORE_URL}"
  "--build-arg=NEXT_PUBLIC_JAMII_PRIMARY_ORIGIN=${JAMII_ORIGIN}"
)

render_kaniko_job web   docker/Dockerfile.next "${NEXT_BUILD_ARGS[@]}" --build-arg=APP=web   --build-arg=PORT=3000 | kubectl apply -f -
render_kaniko_job app   docker/Dockerfile.next "${NEXT_BUILD_ARGS[@]}" --build-arg=APP=app   --build-arg=PORT=3001 | kubectl apply -f -
render_kaniko_job admin docker/Dockerfile.next "${NEXT_BUILD_ARGS[@]}" --build-arg=APP=admin --build-arg=PORT=3002 | kubectl apply -f -
render_kaniko_job store docker/Dockerfile.next "${NEXT_BUILD_ARGS[@]}" --build-arg=APP=store --build-arg=PORT=3003 | kubectl apply -f -
render_kaniko_job jamii docker/Dockerfile.next "${NEXT_BUILD_ARGS[@]}" --build-arg=APP=jamii --build-arg=PORT=3004 | kubectl apply -f -
render_kaniko_job core-service docker/Dockerfile.core     | kubectl apply -f -
render_kaniko_job core-go      services/core-go/Dockerfile | kubectl apply -f -

# ── 2a. Tests are the gate ──────────────────────────────────────────
# Applied above, so the suite has been running while the images built.
# Wait for a terminal condition explicitly rather than a bare
# `wait --for=condition=complete` — a failed Job never reaches Complete,
# so that form would sit out the whole timeout instead of failing fast.
VERIFY_JOB="esoqo-verify-${TAG}"
VERIFY_STATUS=""
echo
echo "== in-cluster CI (lint/typecheck/test) =="
for _ in $(seq 1 360); do # 360 * 5s = 30m ceiling
  complete=$(kubectl get job "$VERIFY_JOB" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || true)
  failed=$(kubectl get job "$VERIFY_JOB" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || true)
  if [[ "$complete" == "True" ]]; then VERIFY_STATUS=passed; break; fi
  if [[ "$failed" == "True" ]]; then VERIFY_STATUS=failed; break; fi
  sleep 5
done

if [[ "$VERIFY_STATUS" != "passed" ]]; then
  echo "error: in-cluster CI ${VERIFY_STATUS:-timed out} — Deployments were NOT touched; images may already be pushed" >&2
  kubectl logs "$VERIFY_JOB" -n "$NAMESPACE" --tail=150 || true
  exit 1
fi
echo "tests passed"

FAILED=0
for svc in web app admin store jamii core-service core-go; do
  if ! kubectl wait --for=condition=complete "job/kaniko-${svc}-${TAG}" -n "$NAMESPACE" --timeout=20m; then
    echo "error: build failed for $svc" >&2
    kubectl logs "job/kaniko-${svc}-${TAG}" -n "$NAMESPACE" --tail=60 || true
    FAILED=1
  fi
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "error: one or more image builds failed — aborting before touching anything live" >&2
  exit 1
fi
echo "all 7 images built and pushed as :$TAG"

# ── 3. Pin every image tag in the overlay, rename the migrate Job ───
# Both edits happen now, up front; only the Job gets APPLIED yet (next
# section) — the Deployments stay on the old images, live, until the
# migration proves out.
echo
echo "== pinning tags in $OVERLAY =="

if ! command -v kustomize >/dev/null 2>&1; then
  echo "error: kustomize not found in deployer image" >&2
  exit 1
fi

( cd "$OVERLAY"
  for img in web app admin store jamii core-service core-go; do
    kustomize edit set image \
      "${REGISTRY}/${OWNER}/esoqo-${img}=${REGISTRY}/${OWNER}/esoqo-${img}:${TAG}"
  done
)

TAG_LC=$(echo "$TAG" | tr '[:upper:]' '[:lower:]')
sed -i -E "s|^(  name: esoqo-migrate-).*\$|\1${TAG_LC}|" deploy/k8s/base/migrate-job.yaml

kubectl kustomize "$OVERLAY" > "$WORKDIR/rendered.yaml"
echo "overlay renders cleanly"

# ── 4. Migration — strictly before any Deployment is touched ────────
# kustomize's images: transformer already rewrote the migrate Job's own
# core-service image reference to :$TAG in the render above, same as
# every Deployment's — but only the Job gets applied here. Split the
# multi-doc render on the `---` separator and pick out the one Job.
echo
echo "== running migration =="

awk -v RS='\n---\n' -v name="esoqo-migrate-${TAG_LC}" '$0 ~ name {print; print "---"}' "$WORKDIR/rendered.yaml" > "$WORKDIR/migrate-job.rendered.yaml"
if ! grep -q "^kind: Job$" "$WORKDIR/migrate-job.rendered.yaml"; then
  echo "error: could not find the migrate Job in the rendered overlay" >&2
  exit 1
fi
kubectl apply -f "$WORKDIR/migrate-job.rendered.yaml"

if ! kubectl wait --for=condition=complete "job/esoqo-migrate-${TAG_LC}" -n "$NAMESPACE" --timeout=15m; then
  echo "error: migration failed — Deployments were NOT touched, old images stay running" >&2
  kubectl logs "job/esoqo-migrate-${TAG_LC}" -n "$NAMESPACE" --tail=100 || true
  exit 1
fi
echo "migration applied cleanly"

# ── 5. Apply the rest — every Deployment now moves to the new tag ───
echo
echo "== rolling out $TAG =="
kubectl apply -f "$WORKDIR/rendered.yaml"

for dep in web app admin store jamii core-service core-go; do
  kubectl rollout status "deployment/${dep}" -n "$NAMESPACE" --timeout=5m
done
echo "all deployments healthy on $TAG"

# ── 6. Commit the overlay edit back, so git stays the truthful record ─
git add deploy/k8s
if git diff --cached --quiet; then
  echo "nothing to commit — images unchanged"
  exit 0
fi

git -c user.name="esoqo-deployer" -c user.email="ci@esoqo.com" commit -m "deploy(${ENVIRONMENT}): ${TAG} [skip ci]"

PUSH_URL="https://x-access-token:${GIT_WRITE_TOKEN}@${GIT_REPO_HOST_PATH}"
git push "$PUSH_URL" "HEAD:refs/heads/${TARGET_BRANCH}"

echo
echo "✓ ${ENVIRONMENT} is now running ${TAG}"
