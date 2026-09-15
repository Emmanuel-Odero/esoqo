#!/usr/bin/env bash
# Pilot check: one-SACCO smoke test for scan-to-pay + tout verify + vouchers.
# Console M-Pesa mode auto-confirms, so no Daraja credentials needed.
#
#   BASE=http://localhost:4100 ./scripts/pilot-check.sh
#
# Optional tokens (grab from mobile sign-in / staff PIN login):
#   TOUT_TOKEN       staff PIN session (Pilot Scanner, 444444) — verify + collections
#   PASSENGER_TOKEN  subject session (+254700300200) — voucher pay + wallet
# Steps without a token are skipped, never failed.
set -u
BASE="${BASE:-http://localhost:4100}"
PASS=0; FAIL=0; SKIP=0

ok()   { PASS=$((PASS+1)); echo "  PASS $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL $1 ($2)"; }
skip() { SKIP=$((SKIP+1)); echo "  SKIP $1 ($2)"; }

need_jq() { command -v jq >/dev/null || { echo "jq is required"; exit 2; }; }
need_jq
curlj() { curl -sS --max-time 15 "$@"; }

echo "== pilot-check @ $BASE =="

# 1. Resolve boarding code (public)
echo "-- resolve BUS-PILOT"
RESOLVE=$(curlj "$BASE/v1/trips/resolve?code=BUS-PILOT") || { fail resolve "curl"; RESOLVE=""; }
TRIP_ID=$(echo "$RESOLVE" | jq -r '.trip.tripId // empty')
if [ -n "$TRIP_ID" ]; then ok "resolve trip $TRIP_ID"; else fail resolve "$(echo "$RESOLVE" | head -c 200)"; fi
echo "$RESOLVE" | jq -r '.trip | "\(.orgName) · \(.vehiclePlate) · \(.routeName)"' 2>/dev/null

# Pick cheapest stage for the smoke fare
STAGE_ID=$(echo "$RESOLVE" | jq -r '.trip.stages[0].id // empty')
STAGE_FARE=$(echo "$RESOLVE" | jq -r '.trip.stages[0].fareKes // "50"')

# 2. M-Pesa fare (console auto-confirms)
echo "-- create M-Pesa fare"
FARE_MSISDN="${FARE_MSISDN:-+254700300200}"
FARE=$(curlj -X POST "$BASE/v1/fares" -H 'Content-Type: application/json' \
  -d "{\"tripQrCode\":\"BUS-PILOT\",\"stageToId\":${STAGE_ID:+\"$STAGE_ID\"},\"amountKes\":$STAGE_FARE,\"method\":\"MPESA_STK\",\"buyerMsisdn\":\"$FARE_MSISDN\",\"buyerName\":\"Pilot\"}") || FARE=""
FARE_ID=$(echo "$FARE" | jq -r '.fareId // empty')
FARE_STATUS=$(echo "$FARE" | jq -r '.status // empty')
if [ -n "$FARE_ID" ] && [ "$FARE_STATUS" = "CONFIRMED" ]; then ok "fare $FARE_ID CONFIRMED"; else fail fare "$(echo "$FARE" | head -c 200)"; fi

# 3. Tout verify (authed)
echo "-- verify fare"
if [ -z "${TOUT_TOKEN:-}" ]; then
  skip verify "set TOUT_TOKEN (staff PIN login)"
else
  VERIFY=$(curlj -X POST "$BASE/v1/fares/verify" -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOUT_TOKEN" \
    -d "{\"code\":\"$FARE_ID\",\"scopeTripId\":\"$TRIP_ID\"}") || VERIFY=""
  VSTATUS=$(echo "$VERIFY" | jq -r '.verification.status // empty')
  if [ "$VSTATUS" = "VALID" ]; then ok "verify VALID"; else fail verify "$(echo "$VERIFY" | head -c 300)"; fi
  # Double-show → still VALID (reuse counter climbs, flagged at 3+)
  VERIFY2=$(curlj -X POST "$BASE/v1/fares/verify" -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOUT_TOKEN" \
    -d "{\"code\":\"$FARE_ID\",\"scopeTripId\":\"$TRIP_ID\"}") || VERIFY2=""
  echo "$VERIFY2" | jq -r '.verification | "  second show: \(.status) (count \(.verifyCount))"' 2>/dev/null
fi

# 4. Voucher fare (authed passenger)
echo "-- voucher fare"
if [ -z "${PASSENGER_TOKEN:-}" ]; then
  skip voucher-fare "set PASSENGER_TOKEN (subject session)"
else
  VOUCHERS=$(curlj "$BASE/v1/me/vouchers" -H "Authorization: Bearer $PASSENGER_TOKEN") || VOUCHERS=""
  VID=$(echo "$VOUCHERS" | jq -r '.vouchers[0].id // empty')
  if [ -z "$VID" ]; then fail voucher-fare "no voucher on account"; else
    VFARE=$(curlj -X POST "$BASE/v1/fares" -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $PASSENGER_TOKEN" \
      -d "{\"tripQrCode\":\"BUS-PILOT\",\"amountKes\":$STAGE_FARE,\"method\":\"VOUCHER\",\"voucherId\":\"$VID\",\"buyerMsisdn\":\"$FARE_MSISDN\"}") || VFARE=""
    VS=$(echo "$VFARE" | jq -r '.status // empty')
    if [ "$VS" = "CONFIRMED" ]; then ok "voucher fare $(echo "$VFARE" | jq -r '.fareId')"; else fail voucher-fare "$(echo "$VFARE" | head -c 300)"; fi
  fi
  echo "$BASE/v1/me/loyalty → $(curlj "$BASE/v1/me/loyalty" -H "Authorization: Bearer $PASSENGER_TOKEN" | jq -c '{totalPoints, kesEquiv}' 2>/dev/null)"
fi

# 5. Collections + fraud (authed staff)
echo "-- collections & fraud"
if [ -z "${TOUT_TOKEN:-}" ]; then
  skip collections "set TOUT_TOKEN"
else
  curlj "$BASE/v1/fleet/trips/$TRIP_ID/collections" -H "Authorization: Bearer $TOUT_TOKEN" | jq -r '.summary | "  collections: mpesa=\(.mpesaConfirmedKes) cash=\(.cashFaresKes) voucher=\(.voucherConfirmedKes // "?") fares=\(.fareCount)"' 2>/dev/null || fail collections "bad response"
  ok "collections read"
  curlj "$BASE/v1/admin/fraud/summary" -H "Authorization: Bearer $TOUT_TOKEN" | jq '.' 2>/dev/null | head -20
fi

echo "== done: $PASS pass, $FAIL fail, $SKIP skip =="
[ "$FAIL" -eq 0 ]
