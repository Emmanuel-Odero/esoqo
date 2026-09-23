package httpapi

import (
	"net/http"
	"testing"
)

// The parcel error codes are a client contract, not an internal detail:
// the offline counter queue in packages/ui/src/parcelOfflineQueue.ts
// branches on LABEL_ALREADY_SPENT to decide that a replayed booking
// already succeeded. Before that code existed the client matched the
// error *sentence* with a regex, which meant a copy-edit in Go could
// silently strand a queued parcel that had in fact shipped. These tests
// exist so the next person to touch the mapping is told what depends on
// it.

func TestLabelAlreadySpentIsAConflict(t *testing.T) {
	if got := parcelErrorStatus("LABEL_ALREADY_SPENT"); got != http.StatusConflict {
		t.Fatalf("LABEL_ALREADY_SPENT should be 409 (the caller did nothing wrong — the\n"+
			"parcel already exists, which is how an offline replay learns it\n"+
			"succeeded); got %d", got)
	}
}

func TestParcelErrorStatusMapping(t *testing.T) {
	for code, want := range map[string]int{
		"NOT_FOUND":           http.StatusNotFound,
		"FORBIDDEN":           http.StatusForbidden,
		"INSUFFICIENT_POINTS": http.StatusPaymentRequired,
		"ALREADY_SETTLED":     http.StatusConflict,
		"ALREADY_DELIVERED":   http.StatusConflict,
		"LABEL_ALREADY_SPENT": http.StatusConflict,
		"BAD_INPUT":           http.StatusBadRequest,
		"FOREIGN_LABEL":       http.StatusBadRequest,
	} {
		if got := parcelErrorStatus(code); got != want {
			t.Errorf("parcelErrorStatus(%q) = %d, want %d", code, got, want)
		}
	}
}

// An unregistered code must fall back to 400 rather than 500: a new
// ParcelError added in dbx without a mapping here is a missing-status
// bug, and answering it as a bad request keeps the client's error
// handling working while it gets noticed.
func TestUnknownParcelErrorCodeFallsBackToBadRequest(t *testing.T) {
	if got := parcelErrorStatus("SOMETHING_NOBODY_MAPPED_YET"); got != http.StatusBadRequest {
		t.Fatalf("unknown code should fall back to 400, got %d", got)
	}
}
