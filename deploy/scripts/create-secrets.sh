#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Create (or rotate) the two Secrets that Fleet deliberately does not
#  manage: esoqo-db and esoqo-secrets.
#
#  These are NOT in git and must never be. Everything else about this
#  deployment is reproducible from the repo; these two are the
#  exception, and that is the whole point — a repo clone must not be
#  enough to reach the database or spend money on someone's behalf.
#
#  Usage:
#      deploy/scripts/create-secrets.sh testnet    ./testnet.secrets.env
#      deploy/scripts/create-secrets.sh production ./production.secrets.env
#
#  The env file is a plain KEY=value list — start from
#  deploy/scripts/secrets.env.template. Keep it in a password manager,
#  not on disk; this script reads it and does not copy it anywhere.
#
#  Re-running rotates: the Secret is replaced and the pods that mount it
#  are restarted. envFrom does not hot-reload, so without the restart
#  the new value is in the cluster but not in any running process.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

ENVIRONMENT="${1:-}"
ENV_FILE="${2:-}"

if [[ -z "$ENVIRONMENT" || -z "$ENV_FILE" ]]; then
  echo "usage: $0 <testnet|production> <path-to-env-file>" >&2
  exit 64
fi

case "$ENVIRONMENT" in
  testnet)    NAMESPACE=esoqo-testnet ;;
  production) NAMESPACE=esoqo-production ;;
  *) echo "error: environment must be 'testnet' or 'production', got '$ENVIRONMENT'" >&2; exit 64 ;;
esac

[[ -f "$ENV_FILE" ]] || { echo "error: no such file: $ENV_FILE" >&2; exit 66; }

# Refuse to run against the wrong cluster. `kubectl` remembers whatever
# context was used last, and "I thought I was on testnet" is how
# production databases get their credentials rotated by surprise.
CONTEXT=$(kubectl config current-context)
echo "  environment : $ENVIRONMENT"
echo "  namespace   : $NAMESPACE"
echo "  kube context: $CONTEXT"
echo
read -r -p "Apply secrets to this context? [y/N] " confirm
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

# Fail before touching the cluster, not halfway through. A partially
# created secret set means pods that boot and then crash on the one
# missing key.
for key in \
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB APP_ROLE_PASSWORD REDIS_PASSWORD \
  SESSION_SECRET OTP_PEPPER AUDIT_CHAIN_SEED \
  FLEET_QR_SECRET MPESA_CALLBACK_SECRET; do
  require "$key"
done

# FLEET_QR_SECRET and MPESA_CALLBACK_SECRET are required above rather
# than optional, and that is not conservatism. Both environments run
# APP_ENV=production, and services/core-go/internal/config/config.go
# refuses to boot without them outside development — it will not fall
# back to the dev values published in this repo, because a service that
# silently starts with 'dev-session-secret-change-me' issues sessions
# anyone holding the source can forge. Omit either and core-go
# CrashLoopBackOffs with the reason only visible in its logs.

# These three are what sign sessions, hash OTPs and chain the audit log.
# A short one is not a weak secret, it is no secret at all — and the
# audit chain seed cannot be rotated after the fact without invalidating
# every existing link.
for key in SESSION_SECRET OTP_PEPPER AUDIT_CHAIN_SEED; do
  val="${!key}"
  if (( ${#val} < 32 )); then
    echo "error: $key is ${#val} chars; needs at least 32" >&2
    echo "       generate one with: openssl rand -hex 32" >&2
    exit 65
  fi
done

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# ── Connection strings ──────────────────────────────────────────────
# Built here rather than hand-written, because the two URLs must differ
# in exactly the right way and hand-editing gets it wrong:
#
#   DATABASE_URL        → PgBouncer (6432), pooled. What the apps use.
#   DIRECT_DATABASE_URL → Postgres (5432), direct. What Prisma migrate,
#                         pg_dump and the audit-chain walk use, because
#                         none of them survive transaction pooling.
#
# The password is URL-encoded: an unescaped '@' or '/' silently truncates
# the connection string and the error names the wrong host.
urlenc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }
PG_PASS_ENC=$(urlenc "$POSTGRES_PASSWORD")
REDIS_PASS_ENC=$(urlenc "$REDIS_PASSWORD")

DATABASE_URL="postgresql://${POSTGRES_USER}:${PG_PASS_ENC}@pgbouncer:6432/${POSTGRES_DB}?pgbouncer=true&connection_limit=10"
DIRECT_DATABASE_URL="postgresql://${POSTGRES_USER}:${PG_PASS_ENC}@postgres:5432/${POSTGRES_DB}"
REDIS_URL="redis://:${REDIS_PASS_ENC}@redis:6379"

kubectl create secret generic esoqo-db \
  --namespace "$NAMESPACE" \
  --from-literal=POSTGRES_USER="$POSTGRES_USER" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=POSTGRES_DB="$POSTGRES_DB" \
  --from-literal=APP_ROLE_PASSWORD="$APP_ROLE_PASSWORD" \
  --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD" \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" \
  --from-literal=REDIS_URL="$REDIS_URL" \
  --dry-run=client -o yaml | kubectl apply -f -

# ── Application secrets ─────────────────────────────────────────────
# Optional keys are passed through as empty rather than omitted, so a
# provider that is switched on later needs a rotation, not a manifest
# change. ${VAR:-} keeps `set -u` from aborting on an unset optional.
kubectl create secret generic esoqo-secrets \
  --namespace "$NAMESPACE" \
  --from-literal=SESSION_SECRET="$SESSION_SECRET" \
  --from-literal=OTP_PEPPER="$OTP_PEPPER" \
  --from-literal=AUDIT_CHAIN_SEED="$AUDIT_CHAIN_SEED" \
  --from-literal=SMS_API_KEY="${SMS_API_KEY:-}" \
  --from-literal=SMS_USERNAME="${SMS_USERNAME:-}" \
  --from-literal=SMTP_HOST="${SMTP_HOST:-}" \
  --from-literal=SMTP_PORT="${SMTP_PORT:-587}" \
  --from-literal=SMTP_SECURE="${SMTP_SECURE:-false}" \
  --from-literal=SMTP_USER="${SMTP_USER:-}" \
  --from-literal=SMTP_PASSWORD="${SMTP_PASSWORD:-}" \
  --from-literal=MPESA_CONSUMER_KEY="${MPESA_CONSUMER_KEY:-}" \
  --from-literal=MPESA_CONSUMER_SECRET="${MPESA_CONSUMER_SECRET:-}" \
  --from-literal=MPESA_SHORTCODE="${MPESA_SHORTCODE:-}" \
  --from-literal=MPESA_PASSKEY="${MPESA_PASSKEY:-}" \
  --from-literal=MPESA_CALLBACK_SECRET="${MPESA_CALLBACK_SECRET:-}" \
  --from-literal=MPESA_CALLBACK_URL="${MPESA_CALLBACK_URL:-}" \
  --from-literal=PESAPAL_CONSUMER_KEY="${PESAPAL_CONSUMER_KEY:-}" \
  --from-literal=PESAPAL_CONSUMER_SECRET="${PESAPAL_CONSUMER_SECRET:-}" \
  --from-literal=PESAPAL_IPN_ID="${PESAPAL_IPN_ID:-}" \
  --from-literal=FLEET_QR_SECRET="${FLEET_QR_SECRET:-}" \
  --from-literal=CECF_SERVICE_SECRET="${CECF_SERVICE_SECRET:-}" \
  --from-literal=CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}" \
  --from-literal=CLOUDFLARE_ZONE_ID="${CLOUDFLARE_ZONE_ID:-}" \
  --from-literal=JAMII_DOMAIN_RECONCILE_SECRET="${JAMII_DOMAIN_RECONCILE_SECRET:-}" \
  --from-literal=R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-}" \
  --from-literal=R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}" \
  --from-literal=R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}" \
  --from-literal=R2_BUCKET="${R2_BUCKET:-}" \
  --from-literal=SEED_ADMIN_PIN="${SEED_ADMIN_PIN:-}" \
  --from-literal=SEED_ADMIN_HASH="${SEED_ADMIN_HASH:-}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo
echo "✓ secrets applied to $NAMESPACE"

# On a rotation the workloads are already running and holding the old
# values in their environment. On a first install there is nothing to
# restart and this is a no-op.
if kubectl -n "$NAMESPACE" get deploy web >/dev/null 2>&1; then
  echo
  read -r -p "Restart workloads so they pick up the new values? [y/N] " restart
  if [[ "$restart" == "y" || "$restart" == "Y" ]]; then
    kubectl -n "$NAMESPACE" rollout restart deploy
    kubectl -n "$NAMESPACE" rollout restart statefulset
    echo "✓ rollout restarted"
  else
    echo "  skipped — running pods still hold the OLD values until restarted"
  fi
fi
