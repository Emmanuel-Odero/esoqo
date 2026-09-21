#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Pre-deploy cluster check.
#
#      deploy/scripts/preflight.sh testnet
#
#  Every failure below is one that otherwise surfaces as a pod stuck
#  Pending or a certificate stuck False — states that look like a bug in
#  the manifests but are really a missing cluster prerequisite. Finding
#  them here costs seconds; finding them during a deploy costs an hour
#  of reading events.
#
#  Read-only. Creates nothing, changes nothing.
# ════════════════════════════════════════════════════════════════════
set -uo pipefail   # deliberately not -e: every check must run, so the
                   # report is complete rather than stopping at the first

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  testnet)    NAMESPACE=esoqo-testnet;    APEX=testnet.esoko.global ;;
  production) NAMESPACE=esoqo-production; APEX=esoko.global ;;
  *) echo "usage: $0 <testnet|production>" >&2; exit 64 ;;
esac

PASS=0; FAIL=0; WARN=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; echo "      → $2"; FAIL=$((FAIL+1)); }
warn() { echo "  ! $1"; echo "      → $2"; WARN=$((WARN+1)); }

echo
echo "Preflight — $ENVIRONMENT ($NAMESPACE)"
echo "context: $(kubectl config current-context 2>/dev/null || echo NONE)"
echo

# ── Reachability ────────────────────────────────────────────────────
echo "Cluster"
if kubectl version -o json >/dev/null 2>&1; then
  ok "API server reachable"
else
  bad "API server unreachable" "Check KUBECONFIG. Download it from Rancher → cluster → Kubeconfig File."
  echo; echo "Cannot continue without an API server."; exit 1
fi

# ── Ingress ─────────────────────────────────────────────────────────
echo
echo "Ingress"
CLASSES=$(kubectl get ingressclass -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
if [[ -z "$CLASSES" ]]; then
  bad "no IngressClass on the cluster" "Install ingress-nginx: Rancher → Apps → Charts → Ingress-Nginx"
elif grep -qw nginx <<<"$CLASSES"; then
  ok "IngressClass 'nginx' present"
else
  bad "IngressClass 'nginx' not found (have: $CLASSES)" \
      "Either install ingress-nginx, or change ingressClassName in both overlays' ingress.yaml and in deploy/cluster/cluster-issuer.yaml to one of the above. k3s ships Traefik, not nginx."
fi

# The external IP is what every DNS record must point at, so surface it
# whether or not anything else passes.
LB_IP=$(kubectl get svc -A -o jsonpath='{range .items[?(@.spec.type=="LoadBalancer")]}{.status.loadBalancer.ingress[0].ip}{"\n"}{end}' 2>/dev/null | grep -v '^$' | head -1)
if [[ -n "$LB_IP" ]]; then
  ok "LoadBalancer IP: $LB_IP"
else
  warn "no LoadBalancer IP" "Controller may be NodePort. Use a node's public IP: kubectl get nodes -o wide"
fi

# ── cert-manager ────────────────────────────────────────────────────
echo
echo "TLS"
if kubectl get crd certificates.cert-manager.io >/dev/null 2>&1; then
  ok "cert-manager CRDs installed"
  for issuer in letsencrypt-staging letsencrypt-prod; do
    if kubectl get clusterissuer "$issuer" >/dev/null 2>&1; then
      READY=$(kubectl get clusterissuer "$issuer" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)
      [[ "$READY" == "True" ]] && ok "ClusterIssuer $issuer ready" \
        || warn "ClusterIssuer $issuer not ready" "kubectl describe clusterissuer $issuer"
    else
      bad "ClusterIssuer $issuer missing" "kubectl apply -f deploy/cluster/cluster-issuer.yaml"
    fi
  done
else
  bad "cert-manager not installed" "Rancher → Apps → Charts → cert-manager (enable Install CRDs)"
fi

# ── Storage ─────────────────────────────────────────────────────────
echo
echo "Storage"
DEFAULT_SC=$(kubectl get sc -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}{"\n"}{end}' 2>/dev/null | awk '$2=="true"{print $1}' | head -1)
if [[ -n "$DEFAULT_SC" ]]; then
  ok "default StorageClass: $DEFAULT_SC"
else
  bad "no default StorageClass" \
      "Postgres, Redis and the backup PVC all omit storageClassName and rely on the default. Without one every PVC stays Pending forever. Mark one default, or add storageClassName to the manifests."
fi

# ── Namespace and secrets ───────────────────────────────────────────
echo
echo "Namespace and secrets"
if kubectl get ns "$NAMESPACE" >/dev/null 2>&1; then
  ok "namespace $NAMESPACE exists"
  for s in esoqo-db esoqo-secrets; do
    if kubectl -n "$NAMESPACE" get secret "$s" >/dev/null 2>&1; then
      ok "secret $s present"
    else
      bad "secret $s missing" "deploy/scripts/create-secrets.sh $ENVIRONMENT <env-file>"
    fi
  done
  # envFrom on a missing key is silent; on a missing Secret the pod
  # never starts. Check the keys that would fail at runtime instead.
  for k in DATABASE_URL DIRECT_DATABASE_URL REDIS_URL; do
    kubectl -n "$NAMESPACE" get secret esoqo-db -o jsonpath="{.data.$k}" 2>/dev/null | grep -q . \
      && ok "esoqo-db.$k set" \
      || bad "esoqo-db.$k missing" "Re-run create-secrets.sh — it builds these three."
  done
else
  warn "namespace $NAMESPACE does not exist yet" "Fleet creates it on first apply; secrets must then be added before pods can start."
fi

# ── Registry access ─────────────────────────────────────────────────
echo
echo "Registry"
if kubectl -n "$NAMESPACE" get secret ghcr >/dev/null 2>&1; then
  ok "ghcr pull secret present"
else
  warn "no ghcr pull secret in $NAMESPACE" \
       "Fine IF the GHCR packages are public. If they are private this is the ImagePullBackOff you are about to hit — see docs/deployment/README.md § 3.7"
fi

# ── DNS ─────────────────────────────────────────────────────────────
echo
echo "DNS"
for host in "$APEX" "app.$APEX" "admin.$APEX"; do
  RESOLVED=$(dig +short "$host" A 2>/dev/null | grep -E '^[0-9]+\.' | head -1)
  if [[ -z "$RESOLVED" ]]; then
    bad "$host does not resolve" "Add the A records at Namecheap — docs/deployment/README.md § 3.6. cert-manager cannot issue until it does."
  elif [[ -n "$LB_IP" && "$RESOLVED" != "$LB_IP" ]]; then
    warn "$host → $RESOLVED (ingress is $LB_IP)" "Stale record, or traffic is proxied. HTTP-01 needs it pointing at the ingress."
  else
    ok "$host → $RESOLVED"
  fi
done

# ── Manifests ───────────────────────────────────────────────────────
echo
echo "Manifests"
OVERLAY="deploy/k8s/overlays/$ENVIRONMENT"
if kubectl kustomize "$OVERLAY" >/dev/null 2>&1; then
  ok "$OVERLAY renders"
  if kubectl kustomize "$OVERLAY" 2>/dev/null | grep -q ":bootstrap"; then
    warn "images still pinned to :bootstrap" "No real build has been deployed yet. Run deploy/scripts/build-and-push.sh $ENVIRONMENT"
  else
    ok "images pinned to a real tag"
  fi
else
  bad "$OVERLAY does not render" "kubectl kustomize $OVERLAY"
fi

echo
echo "─────────────────────────────────"
echo "  $PASS passed, $WARN warnings, $FAIL blocking"
echo
[[ $FAIL -eq 0 ]] || { echo "Fix the blocking items before deploying."; exit 1; }
echo "Ready to deploy."
