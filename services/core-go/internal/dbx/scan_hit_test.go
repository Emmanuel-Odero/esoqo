package dbx

import "testing"

// Every ScanKind must carry its payload somewhere.
//
// This exists because the luggage kind shipped with a resolver, a
// prefix registration and a projection — and no field on ScanHit. It
// resolved as kind "luggage" with the body silently dropped, which
// compiles, passes vet, and looks fine until someone scans a real tag.
// A kind that routes but carries nothing is the failure mode this
// guards, and it is invisible to the type system because hit()'s switch
// simply has no case for it.
func TestEveryScanKindCarriesItsPayload(t *testing.T) {
	cases := []struct {
		kind    string
		payload any
		read    func(*ScanHit) bool
	}{
		{ScanKindVoucher, &VoucherPublic{}, func(h *ScanHit) bool { return h.Voucher != nil }},
		{ScanKindFare, &PublicFareProof{}, func(h *ScanHit) bool { return h.Fare != nil }},
		{ScanKindProduct, &ProductHit{}, func(h *ScanHit) bool { return h.Product != nil }},
		{ScanKindStore, &StoreHit{}, func(h *ScanHit) bool { return h.Store != nil }},
		{ScanKindTable, &TableHit{}, func(h *ScanHit) bool { return h.Table != nil }},
		{ScanKindTicket, &TicketHit{}, func(h *ScanHit) bool { return h.Ticket != nil }},
		{ScanKindOrder, &OrderHit{}, func(h *ScanHit) bool { return h.Order != nil }},
		{ScanKindParty, &PartyHit{}, func(h *ScanHit) bool { return h.Party != nil }},
		{ScanKindCertificate, &CertificateHit{}, func(h *ScanHit) bool { return h.Certificate != nil }},
		{ScanKindParcel, &ParcelStatusView{}, func(h *ScanHit) bool { return h.Parcel != nil }},
		{ScanKindLuggage, &LuggageScanInfo{}, func(h *ScanHit) bool { return h.Luggage != nil }},
	}
	for _, tc := range cases {
		h := hit(tc.kind, tc.payload)
		if h.Kind != tc.kind {
			t.Errorf("hit(%q) set Kind = %q", tc.kind, h.Kind)
		}
		if !tc.read(h) {
			t.Errorf("hit(%q) dropped its payload — add a case to hit()'s switch", tc.kind)
		}
		if h.Action == "" {
			t.Errorf("hit(%q) has no action for the scanner UI to dispatch on", tc.kind)
		}
	}
}

// A LUG- code must route to the luggage kind and nothing else. The
// prefix table is what stops a bag tag resolving as a voucher; this
// pins that it is registered at all.
func TestLuggagePrefixIsRegistered(t *testing.T) {
	var found bool
	for _, reg := range shortCodePrefixes {
		if reg.prefix == "LUG-" {
			found = true
			if reg.kind != ScanKindLuggage {
				t.Errorf("LUG- routes to %q, want %q", reg.kind, ScanKindLuggage)
			}
			// Checked, because a luggage code is typed by hand off a paper
			// stub more than any other code in the product.
			if reg.checkedLen != 6 {
				t.Errorf("LUG- should pre-reject checksum typos (checkedLen = %d)", reg.checkedLen)
			}
		}
	}
	if !found {
		t.Fatal("LUG- is not in the short-code prefix table")
	}
}

func TestLuggageScanActionIsTrack(t *testing.T) {
	// Whoever scans a stub is asking "where is my bag", not trying to
	// verify or check in anything — crew actions live behind the
	// capability-gated luggage desk, not this public resolver.
	if got := actionForKind(ScanKindLuggage); got != ActionTrack {
		t.Fatalf("luggage scan action = %q, want %q", got, ActionTrack)
	}
}
