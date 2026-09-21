package httpapi

import (
	"net/http"
	"testing"
)

func TestLuggageErrorStatusMapping(t *testing.T) {
	for code, want := range map[string]int{
		"NOT_FOUND": http.StatusNotFound,
		"DENIED":    http.StatusForbidden,
		// All three are "you did nothing wrong, the world moved" — a crew
		// screen has to tell them apart from "you typed the code wrong"
		// without reading the sentence.
		"TRIP_CLOSED":         http.StatusConflict,
		"ALREADY_CLAIMED":     http.StatusConflict,
		"LABEL_ALREADY_SPENT": http.StatusConflict,
		"BAD_INPUT":           http.StatusBadRequest,
	} {
		if got := luggageErrorStatus(code); got != want {
			t.Errorf("luggageErrorStatus(%q) = %d, want %d", code, got, want)
		}
	}
}

// Shared spelling with the parcel side: an offline client that learns
// to treat LABEL_ALREADY_SPENT as "our earlier attempt got through"
// must get the same answer whichever domain minted the sticker.
func TestSpentLabelIsAConflictInBothDomains(t *testing.T) {
	if luggageErrorStatus("LABEL_ALREADY_SPENT") != parcelErrorStatus("LABEL_ALREADY_SPENT") {
		t.Fatal("LABEL_ALREADY_SPENT must map to the same status for luggage and parcels")
	}
}

func TestUnknownLuggageCodeFallsBackToBadRequest(t *testing.T) {
	if got := luggageErrorStatus("NOT_A_MAPPED_CODE"); got != http.StatusBadRequest {
		t.Fatalf("unknown code should fall back to 400, got %d", got)
	}
}
