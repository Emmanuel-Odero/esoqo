#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Create (or rotate) the three Secrets services/ci-webhook and the
#  esoqo-deployer Job it creates both need. Same split as
#  create-secrets.sh's esoqo-db/esoqo-secrets: not in git, read from a
#  local env file this script does not copy anywhere.
#
#    ci-webhook-secret   — WEBHOOK_SECRET, the HMAC secret GitHub signs
#                          its push payload with. Must match exactly
#                          what's configured on the repo's webhook
#                          (Settings → Webhooks) for this environment.
#    ci-git-credentials  — GIT_READ_TOKEN (clones deploy/k8s/... and is
#                          what every Kaniko Job authenticates its own
#                          git-context clone with) and GIT_WRITE_TOKEN
#                          (pushes the tag-bump commit back). Both are
#                          GitHub PATs — fine-grained, scoped to just
#                          this repo (`contents: read` and
#                          `contents: write` respectively).
#    ci-ghcr-push        — a docker-registry Secret (GHCR_USERNAME,
#                          GHCR_TOKEN as its username/password, so it
#                          doubles as Kaniko's /kaniko/.docker/config.json
#                          via the Secret's own .dockerconfigjson key)
#                          with write:packages — separate from the
#                          existing read-only `ghcr` pull secret
#                          patched onto the namespace's default
#                          ServiceAccount; this one is mounted only
#                          into the Kaniko build Jobs.
#
#  Usage:
#      deploy/scripts/create-ci-secrets.sh preview    ./preview.ci-secrets.env
#      deploy/scripts/create-ci-secrets.sh production ./production.ci-secrets.env
#
#  Start from deploy/scripts/ci-secrets.env.template. Re-running rotates
#  — ci-webhook needs `kubectl rollout restart deploy/ci-webhook` after
#  (envFrom/secretKeyRef do not hot-reload); the Kaniko/deployer Jobs
#  always read the current Secret value since they're created fresh
#  per deploy.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

ENVIRONMENT="${1:-}"
ENV_FILE="${2:-}"

if [[ -z "$ENVIRONMENT" || -z "$ENV_FILE" ]]; then
  echo "usage: $0 <preview|production> <path-to-env-file>" >&2
  exit 64
fi

case "$ENVIRONMENT" in
  preview)    NAMESPACE=esoqo-preview ;;
  production) NAMESPACE=esoqo-production ;;
  *) echo "error: environment must be 'preview' or 'production', got '$ENVIRONMENT'" >&2; exit 64 ;;
esac

[[ -f "$ENV_FILE" ]] || { echo "error: no such file: $ENV_FILE" >&2; exit 66; }

CONTEXT=$(kubectl config current-context)
echo "  environment : $ENVIRONMENT"
echo "  namespace   : $NAMESPACE"
echo "  kube context: $CONTEXT"
echo
read -r -p "Apply CI secrets to this context? [y/N] " confirm
[[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "aborted"; exit 1; }

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: $name is empty or unset in $ENV_FILE" >&2
    exit 65
  fi
}

for v in WEBHOOK_SECRET GIT_READ_TOKEN GIT_WRITE_TOKEN GHCR_USERNAME GHCR_TOKEN; do
  require "$v"
done

if [[ "${#WEBHOOK_SECRET}" -lt 32 ]]; then
  echo "error: WEBHOOK_SECRET must be at least 32 characters (it's an HMAC key, not a password to remember)" >&2
  exit 65
fi

kubectl -n "$NAMESPACE" create secret generic ci-webhook-secret \
  --from-literal=WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NAMESPACE" create secret generic ci-git-credentials \
  --from-literal=GIT_READ_TOKEN="$GIT_READ_TOKEN" \
  --from-literal=GIT_WRITE_TOKEN="$GIT_WRITE_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NAMESPACE" create secret docker-registry ci-ghcr-push \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_USERNAME" \
  --docker-password="$GHCR_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

echo
echo "✓ CI secrets applied to $NAMESPACE"
echo
read -r -p "Restart ci-webhook to pick up the new WEBHOOK_SECRET now? [y/N] " restart
if [[ "$restart" == "y" || "$restart" == "Y" ]]; then
  kubectl -n "$NAMESPACE" rollout restart deployment/ci-webhook
fi
