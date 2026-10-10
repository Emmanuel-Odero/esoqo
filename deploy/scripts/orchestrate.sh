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

echo "== deploying $GIT_SHA_SHORT ($TARGET_BRANCH) to $NAMESPACE =="

# ── 1. Clone the overlay at the exact triggering commit ─────────────
# Only deploy/k8s/... from this checkout gets used — the Kaniko Jobs
# below clone the same commit independently, straight from GitHub.
GIT_REPO_HOST_PATH="${GIT_REPO_URL#https://}"
AUTH_URL="https://x-access-token:${GIT_READ_TOKEN}@${GIT_REPO_HOST_PATH}"
git clone --filter=blob:none "$AUTH_URL" "$WORKDIR/repo"
cd "$WORKDIR/repo"
git checkout "$GIT_SHA"

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
