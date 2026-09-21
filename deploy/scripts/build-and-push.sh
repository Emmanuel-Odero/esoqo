#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Local equivalent of .github/workflows/build-images.yml.
#
#  Fleet reads manifests straight from git, so it never needed GitHub
#  Actions. Actions only does two things — build the images and commit
#  the new tags — and this script does both from a laptop. Use it when
#  Actions is unavailable, or to deploy a commit without pushing it
#  through CI first.
#
#      deploy/scripts/build-and-push.sh testnet
#      deploy/scripts/build-and-push.sh production
#
#  Everything it produces is identical to the workflow's output: same
#  images, same tags, same overlay edit, same commit. A later CI-built
#  deploy picks up seamlessly from whatever this leaves behind.
#
#  ⚠  This builds SEVEN images and needs ~15GB of free Docker disk.
#  Docker Desktop's VM disk filling up is what produced the
#  containerd I/O errors during the first attempt at this — check
#  Settings → Resources → Disk image size before a cold run.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

ENVIRONMENT="${1:-}"
REGISTRY="ghcr.io"
OWNER="emmanuel-odero" # GHCR paths are lowercase; the account is Emmanuel-Odero

case "$ENVIRONMENT" in
  testnet)
    BRANCH="esoko/testnet"
    OVERLAY="deploy/k8s/overlays/testnet"
    WEB_URL="https://testnet.esoko.global"
    APP_URL="https://app.testnet.esoko.global"
    STORE_URL="https://store.testnet.esoko.global"
    JAMII_ORIGIN="https://jamii.testnet.esoko.global"
    ;;
  production)
    BRANCH="production"
    OVERLAY="deploy/k8s/overlays/production"
    WEB_URL="https://esoko.global"
    APP_URL="https://app.esoko.global"
    STORE_URL="https://store.esoko.global"
    JAMII_ORIGIN="https://jamii.esoko.global"
    ;;
  *)
    echo "usage: $0 <testnet|production>" >&2
    exit 64
    ;;
esac

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Refuse to build from the wrong branch. The overlay committed at the
# end goes to $BRANCH, and building testnet code while standing on
# production would push production-tagged images built from the wrong
# tree — with NEXT_PUBLIC_* baked in, that is not recoverable by a
# retag.
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  echo "error: on branch '$CURRENT_BRANCH' but '$ENVIRONMENT' builds from '$BRANCH'" >&2
  echo "       git checkout $BRANCH" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree is dirty" >&2
  echo "       The image tag is the commit SHA, so an uncommitted change would" >&2
  echo "       ship inside an image labelled with a commit that does not contain it." >&2
  exit 1
fi

TAG=$(git rev-parse --short=12 HEAD)

echo "  environment : $ENVIRONMENT"
echo "  branch      : $BRANCH"
echo "  tag         : $TAG"
echo "  registry    : $REGISTRY/$OWNER"
echo

# Fail early and loudly rather than after twenty minutes of building.
if ! docker info >/dev/null 2>&1; then
  echo "error: docker is not responding" >&2
  exit 1
fi
if ! grep -q "$REGISTRY" ~/.docker/config.json 2>/dev/null; then
  echo "note: not logged in to $REGISTRY. Run:" >&2
  echo "      echo \$GHCR_PAT | docker login ghcr.io -u Emmanuel-Odero --password-stdin" >&2
  echo "      (the PAT needs write:packages)" >&2
  exit 1
fi

read -r -p "Build and push 7 images? [y/N] " confirm
[[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "aborted"; exit 1; }

# Registry pushes fail transiently — a dropped connection partway
# through a 600MB layer is routine, and without a retry one blip leaves
# the release half-pushed: some images at the new tag, some not, and an
# overlay about to be pinned to tags that do not all exist. Retrying is
# safe because a push is idempotent; already-uploaded layers are skipped.
push_with_retry() {
  local ref="$1"
  for attempt in 1 2 3; do
    if docker push "$ref"; then
      return 0
    fi
    echo "  push failed (attempt $attempt/3) — retrying in $((attempt * 10))s"
    sleep $((attempt * 10))
  done
  echo "error: could not push $ref after 3 attempts" >&2
  return 1
}

build() {
  local name="$1" dockerfile="$2"; shift 2
  local image="$REGISTRY/$OWNER/esoqo-$name"
  echo
  echo "── $name ───────────────────────────────────────────"
  # Both tags: the SHA is what the overlay pins and what makes "which
  # commit is running?" answerable; the moving $ENVIRONMENT tag is for
  # humans doing a quick `docker pull`.
  docker build \
    --file "$dockerfile" \
    --tag "$image:$TAG" \
    --tag "$image:$ENVIRONMENT" \
    "$@" \
    .
  push_with_retry "$image:$TAG"
  push_with_retry "$image:$ENVIRONMENT"
}

NEXT_ARGS=(
  --build-arg "NEXT_PUBLIC_WEB_URL=$WEB_URL"
  --build-arg "NEXT_PUBLIC_APP_URL=$APP_URL"
  --build-arg "NEXT_PUBLIC_STORE_URL=$STORE_URL"
  --build-arg "NEXT_PUBLIC_JAMII_PRIMARY_ORIGIN=$JAMII_ORIGIN"
)

build web   docker/Dockerfile.next --build-arg APP=web   --build-arg PORT=3000 "${NEXT_ARGS[@]}"
build app   docker/Dockerfile.next --build-arg APP=app   --build-arg PORT=3001 "${NEXT_ARGS[@]}"
build admin docker/Dockerfile.next --build-arg APP=admin --build-arg PORT=3002 "${NEXT_ARGS[@]}"
build store docker/Dockerfile.next --build-arg APP=store --build-arg PORT=3003 "${NEXT_ARGS[@]}"
build jamii docker/Dockerfile.next --build-arg APP=jamii --build-arg PORT=3004 "${NEXT_ARGS[@]}"
build core-service docker/Dockerfile.core
build core-go      services/core-go/Dockerfile

# ── The deploy: pin the tags, name the migration Job, commit ────────
echo
echo "── pinning tags in $OVERLAY ────────────────────────"

if ! command -v kustomize >/dev/null 2>&1; then
  echo "error: kustomize not found. brew install kustomize" >&2
  echo "       (kubectl's built-in kustomize cannot 'edit set image')" >&2
  exit 1
fi

( cd "$OVERLAY"
  for img in web app admin store jamii core-service core-go; do
    kustomize edit set image \
      "$REGISTRY/$OWNER/esoqo-${img}=$REGISTRY/$OWNER/esoqo-${img}:$TAG"
  done
)

# A Job's spec.template is immutable, so the name must change per
# release or Fleet cannot apply the second one.
TAG_LC=$(echo "$TAG" | tr '[:upper:]' '[:lower:]')
sed -i '' -E "s|^(  name: esoqo-migrate-).*$|\1${TAG_LC}|" deploy/k8s/base/migrate-job.yaml

# Catch a malformed edit before it is committed, not after Fleet has
# already tried to apply it.
kubectl kustomize "$OVERLAY" > /dev/null
echo "overlay renders cleanly"

git add deploy/k8s
if git diff --cached --quiet; then
  echo "nothing to commit — images unchanged"
  exit 0
fi

git commit -m "deploy($ENVIRONMENT): $TAG"

echo
echo "✓ images pushed and overlay pinned to $TAG"
echo
echo "  Nothing is deployed until this commit is pushed — that is what"
echo "  Fleet reacts to:"
echo
echo "      git push origin $BRANCH"
