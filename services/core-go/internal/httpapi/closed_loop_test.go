package httpapi

import (
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/config"
)

// Esoqo is not a mobile money platform, and three properties are what
// keep it from becoming one by accident:
//
//  1. Stored value is CLOSED-LOOP — a voucher can be loaded and spent
//     inside Esoqo, and that is all.
//  2. There is NO CASH-OUT of stored value — no path converts a voucher
//     balance or loyalty points back into currency.
//  3. There is NO PEER-TO-PEER TRANSFER — no path moves value from one
//     person to another.
//
// Holding customer funds is what draws regulatory attention (in Kenya,
// CBK's remit under the National Payment Systems Act); adding any of the
// three above is what changes the kind of thing Esoqo is. Today all
// three hold. They hold by accident, though — nothing stops a
// well-meaning "let users cash out their voucher" ticket from quietly
// crossing the line in a sprint.
//
// This test makes crossing it deliberate. It is not a security control:
// anyone can edit the allowlist. It is a tripwire that forces the change
// to be argued for in a diff rather than discovered in an audit. If you
// are here because this test failed, that is the test working — go and
// get the legal position confirmed before you edit the list.
//
// See docs/proposals/money-representation.md.

// The complete stored-value surface. Every route that touches a voucher,
// a voucher batch, or loyalty points must appear here.
//
//	create  — mint an empty card
//	load    — put money in, via M-Pesa STK (one direction only)
//	status  — read balance
//	resolve — look a card up by QR/short code, to spend against it
//	list    — a person's own cards
//	freeze  — suspend a lost/stolen card
//	batches — an employer pre-funding staff allowance cards
//
// Conspicuously absent, and required to stay absent: unload, redeem,
// withdraw, cash-out, refund-to-mpesa, transfer, gift-balance.
var closedLoopStoredValueRoutes = map[string]bool{
	"POST /v1/vouchers":            true,
	"POST /v1/vouchers/:id/load":   true,
	"GET /v1/vouchers/:id/status":  true,
	"GET /v1/vouchers/resolve":     true,
	"GET /v1/me/vouchers":          true,
	"POST /v1/vouchers/:id/freeze": true,
	"POST /v1/me/voucher-batches":  true,
	"GET /v1/me/voucher-batches":   true,
	"GET /v1/me/points":            true,
}

func TestStoredValueSurfaceStaysClosedLoop(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := NewServer(config.Config{}, nil, nil)

	var inspected int
	for _, r := range s.Router().Routes() {
		if !touchesStoredValue(r.Path) {
			continue
		}
		inspected++
		key := r.Method + " " + r.Path
		if !closedLoopStoredValueRoutes[key] {
			t.Errorf(
				"new stored-value route %q is not in the closed-loop allowlist.\n"+
					"If it lets a voucher balance or loyalty points leave Esoqo as money, "+
					"or move between people, it changes Esoqo from a commerce platform "+
					"into an e-money issuer. Confirm the regulatory position before "+
					"adding it to closedLoopStoredValueRoutes.", key)
		}
	}

	// Without this, a rename of the voucher routes (or a typo in
	// touchesStoredValue) would make the loop above match nothing and
	// the test pass while guarding exactly nothing.
	if inspected < len(closedLoopStoredValueRoutes) {
		t.Fatalf("matched only %d stored-value routes but the allowlist names %d — "+
			"touchesStoredValue is no longer finding them, so this guard is not running",
			inspected, len(closedLoopStoredValueRoutes))
	}
}

// TestNoStoredValueCashOutOrTransferRoutes is the same guard stated as a
// vocabulary ban, so a route that dodges the allowlist by living
// somewhere unexpected still trips something.
//
// Deliberately NOT banned: /groups/:id/withdrawals, /withdrawals/:id/sign,
// the parcel COD remit/settle routes, and the courier payout route. Those
// do move real money out, but none of them is stored value being
// redeemed by its holder — they are a chama releasing its own pooled
// funds under multi-signature approval, a rider handing over cash they
// physically collected, and Esoqo paying its own payables. Different
// activity, different argument, already governed by their own controls.
func TestNoStoredValueCashOutOrTransferRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := NewServer(config.Config{}, nil, nil)

	banned := []string{
		"unload", "cashout", "cash-out", "redeem",
		"transfer", "send-money", "sendmoney", "p2p",
	}

	for _, r := range s.Router().Routes() {
		lower := strings.ToLower(r.Path)
		for _, word := range banned {
			if strings.Contains(lower, word) {
				t.Errorf(
					"route %s %s contains %q — this is the vocabulary of moving value "+
						"between people or back into currency, which is the line Esoqo "+
						"does not cross. See this file's doc comment.",
					r.Method, r.Path, word)
			}
		}
	}
}

func touchesStoredValue(path string) bool {
	lower := strings.ToLower(path)
	return strings.Contains(lower, "voucher") ||
		strings.Contains(lower, "/points")
}
