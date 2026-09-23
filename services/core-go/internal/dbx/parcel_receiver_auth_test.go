package dbx

import (
	"strings"
	"testing"
)

// The receiver-authentication state machine.
//
// Three counters (attempts, granted extras, and the derived ceiling)
// and two lock states, every one of them one off-by-one away from
// either locking an honest receiver a try early or handing an attacker
// a free guess. decideReceiverAuth is pure precisely so this can be a
// table instead of a database.
//
// What these pin, in one sentence each: three wrong codes lock; a
// grant buys exactly two more and no more; burning those hard locks;
// a correct code at any point wipes the slate including the grant; and
// an already-locked parcel never advances its own counter.

func TestReceiverAuthLocksOnTheThirdWrongCode(t *testing.T) {
	// Walks the real sequence rather than asserting on one call, because
	// the bug this guards against is cumulative: each step feeds the
	// next's `attempts`.
	attempts := 0
	for i := 1; i <= ReceiverAuthMaxAttempts-1; i++ {
		d := decideReceiverAuth(attempts, 0, false, false, false)
		if d.Result != ReceiverAuthWrong {
			t.Fatalf("attempt %d: got %s, want WRONG — locking early strands a receiver who can still count", i, d.Result)
		}
		if want := ReceiverAuthMaxAttempts - i; d.TriesLeft != want {
			t.Fatalf("attempt %d: triesLeft = %d, want %d", i, d.TriesLeft, want)
		}
		attempts = d.NewAttempts
	}

	d := decideReceiverAuth(attempts, 0, false, false, false)
	if d.Result != ReceiverAuthLocked {
		t.Fatalf("attempt %d: got %s, want LOCKED", ReceiverAuthMaxAttempts, d.Result)
	}
	if !d.SetLocked || d.SetHardLocked {
		t.Fatalf("first lockout must be soft (recoverable by a grant): setLocked=%v setHardLocked=%v",
			d.SetLocked, d.SetHardLocked)
	}
	if !d.JustLocked {
		t.Fatal("justLocked must be set — it is what fires the alert to the carrying company, and an alert that never fires makes the whole escalation invisible")
	}
	if d.NewAttempts != ReceiverAuthMaxAttempts {
		t.Fatalf("attempts = %d, want %d", d.NewAttempts, ReceiverAuthMaxAttempts)
	}
}

func TestReceiverAuthGrantBuysExactlyTwoMore(t *testing.T) {
	// The state right after GrantReceiverAuthRetry: counters reset, the
	// extras banked, the soft lock cleared.
	attempts, extra := 0, ReceiverAuthExtraAttempts
	allowed := ReceiverAuthMaxAttempts + ReceiverAuthExtraAttempts

	for i := 1; i <= ReceiverAuthExtraAttempts+ReceiverAuthMaxAttempts-1; i++ {
		d := decideReceiverAuth(attempts, extra, false, false, false)
		if d.Result != ReceiverAuthWrong {
			t.Fatalf("post-grant attempt %d of %d: got %s, want WRONG", i, allowed, d.Result)
		}
		attempts = d.NewAttempts
	}

	d := decideReceiverAuth(attempts, extra, false, false, false)
	if d.Result != ReceiverAuthHardLocked {
		t.Fatalf("after the granted tries are gone: got %s, want HARD_LOCKED — a soft lock here would let staff grant again, which makes the limit a speed bump", d.Result)
	}
	if !d.SetHardLocked || d.SetLocked {
		t.Fatalf("setHardLocked=%v setLocked=%v, want hard only", d.SetHardLocked, d.SetLocked)
	}
	if !d.JustLocked {
		t.Fatal("justLocked must be set — this is what texts the sender")
	}
}

func TestReceiverAuthCorrectCodeClearsEverything(t *testing.T) {
	// Mid-episode: two wrong already, and a grant banked. Getting it
	// right has to wipe both, or the next episode silently starts with
	// a five-try budget.
	d := decideReceiverAuth(2, ReceiverAuthExtraAttempts, false, false, true)
	if d.Result != ReceiverAuthPassed {
		t.Fatalf("got %s, want PASSED", d.Result)
	}
	if !d.ClearCounters {
		t.Fatal("a pass must clear the counters")
	}
	if d.NewAttempts != 0 {
		t.Fatalf("attempts = %d, want 0", d.NewAttempts)
	}
	if d.SetLocked || d.SetHardLocked || d.JustLocked {
		t.Fatal("a pass must not set any lock")
	}
}

func TestReceiverAuthCorrectCodeOnTheLastTryStillPasses(t *testing.T) {
	// The boundary that matters most to a real person: they have one
	// try left and they get it right. Ordering the match check after the
	// ceiling check would lock them out on a correct code.
	d := decideReceiverAuth(ReceiverAuthMaxAttempts-1, 0, false, false, true)
	if d.Result != ReceiverAuthPassed {
		t.Fatalf("got %s, want PASSED — a correct code on the final try must never lock", d.Result)
	}
}

func TestReceiverAuthLockedParcelDoesNotAdvanceItsCounter(t *testing.T) {
	// A locked page gets reloaded. If each reload counted, the number
	// staff read would describe the reloading rather than the guessing,
	// and a soft lock would drift into a hard one on its own.
	for _, tc := range []struct {
		name               string
		locked, hardLocked bool
		want               ReceiverAuthResult
	}{
		{"soft locked", true, false, ReceiverAuthLocked},
		{"hard locked", false, true, ReceiverAuthHardLocked},
		{"both set", true, true, ReceiverAuthHardLocked},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Deliberately passing a MATCHING code: even the right code
			// must not open a locked parcel, or the lock is decorative.
			d := decideReceiverAuth(ReceiverAuthMaxAttempts, 0, tc.locked, tc.hardLocked, true)
			if d.Result != tc.want {
				t.Fatalf("got %s, want %s", d.Result, tc.want)
			}
			if d.NewAttempts != ReceiverAuthMaxAttempts {
				t.Fatalf("attempts moved to %d — a reload is not an attempt", d.NewAttempts)
			}
			if d.JustLocked {
				t.Fatal("justLocked on an already-locked parcel would re-alert the dispatch desk on every page refresh")
			}
			if d.ClearCounters || d.SetLocked || d.SetHardLocked {
				t.Fatal("an already-locked parcel must not be rewritten")
			}
		})
	}
}

// The event row is the only record of any of this, and which rows are
// public is the editorial heart of the feature: a stranger holding a
// tracking code must learn that the parcel has stopped, and nothing
// more precise than that.
func TestReceiverAuthEventVisibility(t *testing.T) {
	allowed := ReceiverAuthMaxAttempts

	pass := receiverAuthEvent("p", "", decideReceiverAuth(1, 0, false, false, true), allowed)
	if pass.Kind != "RECEIVER_AUTH_PASSED" {
		t.Fatalf("kind = %s", pass.Kind)
	}
	if pass.PublicLabel != nil {
		t.Fatal("a successful verification must stay staff-only — publishing it tells anyone probing that the code they are working on is live")
	}

	wrong := receiverAuthEvent("p", "", decideReceiverAuth(0, 0, false, false, false), allowed)
	if wrong.Kind != "RECEIVER_AUTH_FAILED" {
		t.Fatalf("kind = %s", wrong.Kind)
	}
	if wrong.PublicLabel != nil {
		t.Fatal("one mistyped code must not appear on the public tracking page")
	}

	locked := receiverAuthEvent("p", "", decideReceiverAuth(ReceiverAuthMaxAttempts-1, 0, false, false, false), allowed)
	if locked.Kind != "RECEIVER_AUTH_LOCKED" || locked.Severity != "WARNING" {
		t.Fatalf("kind = %s severity = %s, want RECEIVER_AUTH_LOCKED/WARNING", locked.Kind, locked.Severity)
	}
	if locked.PublicLabel == nil {
		t.Fatal("a lock must be public — the parcel has visibly stopped and the sender reading the same page needs to know why")
	}

	hard := receiverAuthEvent("p", "",
		decideReceiverAuth(ReceiverAuthMaxAttempts+ReceiverAuthExtraAttempts-1, ReceiverAuthExtraAttempts, false, false, false),
		ReceiverAuthMaxAttempts+ReceiverAuthExtraAttempts)
	if hard.Kind != "RECEIVER_AUTH_HARD_LOCKED" || hard.Severity != "CRITICAL" {
		t.Fatalf("kind = %s severity = %s", hard.Kind, hard.Severity)
	}
	if hard.PublicLabel == nil {
		t.Fatal("a hard lock must be public")
	}
}

// No event row may ever carry a delivery code, current or replaced.
// staffDetail is read by every clerk with console access, which is a
// far wider set than "the receiver" — and the entire control here is
// that only the receiver knows the number.
func TestReceiverAuthEventsNeverCarryTheCode(t *testing.T) {
	const secret = "481902"
	for _, d := range []receiverAuthDecision{
		decideReceiverAuth(1, 0, false, false, true),
		decideReceiverAuth(0, 0, false, false, false),
		decideReceiverAuth(ReceiverAuthMaxAttempts-1, 0, false, false, false),
	} {
		ev := receiverAuthEvent("p", "", d, ReceiverAuthMaxAttempts)
		if strings.Contains(ev.StaffDetail, secret) {
			t.Fatalf("staffDetail leaked the code: %q", ev.StaffDetail)
		}
		if ev.PublicLabel != nil && strings.Contains(*ev.PublicLabel, secret) {
			t.Fatalf("publicLabel leaked the code: %q", *ev.PublicLabel)
		}
	}
}

// Attempt budgets are a product decision, not an implementation
// detail: three is chosen against five for the courier-side throttle
// on purpose (a clerk has the customer standing there to correct them;
// whoever types here may be anyone who photographed the label). A
// silent bump would weaken the whole escalation with nothing to catch
// it, and the panel copy on the web tells receivers these exact
// numbers.
func TestReceiverAuthBudgetsAreDeliberate(t *testing.T) {
	if ReceiverAuthMaxAttempts != 3 {
		t.Fatalf("ReceiverAuthMaxAttempts = %d, want 3 — the tracking page tells receivers 'three tries' in so many words",
			ReceiverAuthMaxAttempts)
	}
	if ReceiverAuthExtraAttempts != 2 {
		t.Fatalf("ReceiverAuthExtraAttempts = %d, want 2 — both consoles offer 'Allow two more tries'",
			ReceiverAuthExtraAttempts)
	}
	if ReceiverAuthMaxAttempts >= DeliveryCodeMaxAttempts {
		t.Fatalf("the guest budget (%d) must stay below the counter-staff one (%d): a clerk reading a code off the customer's own phone has help a stranger with a photographed label does not",
			ReceiverAuthMaxAttempts, DeliveryCodeMaxAttempts)
	}
}

// codIsOutstanding is shared by CanReceiverSelfConfirm (which decides
// whether to OFFER the button) and DeliverParcel (which decides whether
// to honour it). They were once two separate expressions, and they
// disagreed in exactly the case below: a COD parcel whose cash the
// courier had already taken on an earlier leg. The button was hidden;
// the write would have gone through. Sharing the predicate is the fix,
// and this is what stops it being unshared again.
func TestCodOutstandingTracksTheStatusNotJustTheAmount(t *testing.T) {
	amount := "3500.00"
	empty := ""

	for _, tc := range []struct {
		name   string
		amount *string
		status string
		want   bool
	}{
		{"no COD at all", nil, "NOT_APPLICABLE", false},
		{"empty amount", &empty, "NOT_APPLICABLE", false},
		{"buyer still owes it", &amount, "PENDING", true},
		// The case the two implementations disagreed about. The money is
		// in the rider's pocket already; nothing is owed at the counter,
		// so this is an ordinary parcel for self-confirm purposes.
		{"already collected", &amount, "COLLECTED", false},
		{"remitted to Esoqo", &amount, "REMITTED", false},
		{"settled to the seller", &amount, "SETTLED", false},
		// An unrecognised status must read as "money outstanding". A new
		// COD state added later should block a self-confirm until
		// somebody has thought about it, not be waved through.
		{"unknown future status", &amount, "SOMETHING_NEW", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := codIsOutstanding(tc.amount, tc.status); got != tc.want {
				t.Fatalf("codIsOutstanding(%v, %q) = %v, want %v", tc.amount, tc.status, got, tc.want)
			}
		})
	}
}
