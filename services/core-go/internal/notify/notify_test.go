package notify

import (
	"strings"
	"testing"
	"time"
)

func TestOtpCodeIncludesCode(t *testing.T) {
	msg := OtpCode("123456")
	if !strings.Contains(msg, "123456") {
		t.Errorf("OtpCode message missing the code: %q", msg)
	}
	if !strings.Contains(msg, "Esoqo") {
		t.Errorf("OtpCode message should identify Esoqo: %q", msg)
	}
}

func TestParcelMessagesAreSpecificNotGeneric(t *testing.T) {
	deliveredAt := time.Date(2026, 9, 10, 14, 5, 0, 0, time.UTC)
	cases := []struct {
		name string
		msg  string
		want []string
	}{
		{"scheduled", ParcelCollectionScheduled("PKG-ABC123", "Jane", "+254712345678", "10:00 on 10 Sep"), []string{"PKG-ABC123", "Jane", "+254712345678", "10:00 on 10 Sep"}},
		{"scheduledNoPhone", ParcelCollectionScheduled("PKG-ABC123", "Jane", "", "10:00 on 10 Sep"), []string{"PKG-ABC123", "Jane", "10:00 on 10 Sep"}},
		{"pickupAssigned", ParcelPickupAssigned("PKG-ABC123", "Jane", "Westlands", "10:00 on 10 Sep"), []string{"PKG-ABC123", "Jane", "Westlands", "10:00 on 10 Sep"}},
		{"pickedUp", ParcelPickedUp("PKG-ABC123", "Westlands", "John"), []string{"PKG-ABC123", "Westlands", "John", "picked up"}},
		{"pickedUpNoCourier", ParcelPickedUp("PKG-ABC123", "Westlands", ""), []string{"PKG-ABC123", "Westlands", "picked up"}},
		{"inTransit", ParcelInTransitToYou("PKG-ABC123", "Jane", "CBD", "7Y3K9Q", ""), []string{"PKG-ABC123", "Jane", "CBD", "7Y3K9Q"}},
		{"delivered", ParcelDelivered("PKG-ABC123", "Westlands", deliveredAt), []string{"PKG-ABC123", "Westlands", "delivered"}},
		{"received", ParcelReceived("PKG-ABC123", "Jane", deliveredAt), []string{"PKG-ABC123", "Jane"}},
		{"paymentConfirmedWithReceipt", ParcelPaymentConfirmed("PKG-ABC123", "585", "Faith", "Nyayo House", "TGH7X8Y9Z0"), []string{"PKG-ABC123", "585", "Faith", "Nyayo House", "TGH7X8Y9Z0"}},
		{"paymentConfirmedPoints", ParcelPaymentConfirmed("PKG-ABC123", "585", "Faith", "Nyayo House", ""), []string{"PKG-ABC123", "585", "Faith", "Nyayo House"}},
		{"refunded", ParcelRefunded("PKG-ABC123", "7700.00"), []string{"PKG-ABC123", "7700.00", "refund"}},
	}
	for _, tc := range cases {
		for _, want := range tc.want {
			if !strings.Contains(tc.msg, want) {
				t.Errorf("%s message missing %q: %q", tc.name, want, tc.msg)
			}
		}
		if strings.Contains(tc.msg, "status changed") {
			t.Errorf("%s message reads like a generic status line: %q", tc.name, tc.msg)
		}
	}
}

// TestTrackingLinkFitsOrIsOmitted — withTrack's whole contract. An
// aggregator bills per segment, so a link that pushes a message over
// 160 chars silently doubles the cost of every notification that hits
// it. Dropping the link (back to the code-only message these all were
// before links existed) is the correct degradation: the recipient still
// has the code, which is what the tracking page asks for anyway.
func TestTrackingLinkFitsOrIsOmitted(t *testing.T) {
	original := trackingBaseURL
	t.Cleanup(func() { trackingBaseURL = original })

	longLabel := strings.Repeat("x", 80)
	deliveredAt := time.Date(2026, 9, 10, 14, 5, 0, 0, time.UTC)

	SetTrackingBaseURL("https://esoqo.co.ke/")
	if got := TrackingURL("PKG-ABC123"); got != "https://esoqo.co.ke/t/PKG-ABC123" {
		t.Errorf("TrackingURL should trim the trailing slash and append /t/<code>, got %q", got)
	}
	if msg := ParcelPickedUp("PKG-ABC123", "Westlands", "John"); !strings.Contains(msg, "Track: https://esoqo.co.ke/t/PKG-ABC123") {
		t.Errorf("a short message should carry the tracking link: %q", msg)
	}

	// Every message must still fit in one segment with a realistic base
	// URL configured and pathological field values — the combination
	// that would otherwise only show up on a production bill.
	linked := map[string]string{
		"pickedUp":         ParcelPickedUp("PKG-ABC123", longLabel, longLabel),
		"inTransit":        ParcelInTransitToYou("PKG-ABC123", longLabel, longLabel, "7Y3K9Q", ""),
		"delivered":        ParcelDelivered("PKG-ABC123", longLabel, deliveredAt),
		"paymentConfirmed": ParcelPaymentConfirmed("PKG-ABC123", "585", longLabel, longLabel, "TGH7X8Y9Z0"),
		"attemptFailed":    ParcelDeliveryAttemptFailed("PKG-ABC123", "nobody was there to receive it", 1),
		"atAgent":          ParcelAtAgent("PKG-ABC123", longLabel, longLabel, longLabel, "7Y3K9Q"),
		"returned":         ParcelReturnedToSender("PKG-ABC123", longLabel),
		"codBooked":        ParcelCodBooked("PKG-ABC123", longLabel, longLabel),
		"codCollected":     ParcelCodCollected("PKG-ABC123", "12000", "0", false),
		"codShort":         ParcelCodCollected("PKG-ABC123", "12000", "3500", true),
		"onBus":            ParcelOnBus("PKG-ABC123", "KBZ 123A", longLabel, longLabel),
	}
	for name, msg := range linked {
		if len(msg) > 160 {
			t.Errorf("%s is %d chars with a tracking link, over the single-segment budget: %q", name, len(msg), msg)
		}
	}

	// A base URL long enough to never fit must leave the message intact
	// rather than push it into a second segment.
	SetTrackingBaseURL("https://" + strings.Repeat("a", 150) + ".example.com")
	msg := ParcelPickedUp("PKG-ABC123", "Westlands", "John")
	if strings.Contains(msg, "Track:") {
		t.Errorf("an oversized tracking link should be omitted, not appended: %q", msg)
	}
	if len(msg) > 160 {
		t.Errorf("message overflowed its segment budget: %d chars", len(msg))
	}

	// Unconfigured stays exactly as it was before links existed.
	SetTrackingBaseURL("")
	if strings.Contains(ParcelPickedUp("PKG-ABC123", "Westlands", "John"), "Track:") {
		t.Error("no tracking link should appear when no base URL is configured")
	}
}

// TestNoMessageForcesUCS2 — a single non-GSM-7 character (an em dash is
// the one that snuck in before) silently drops the per-segment budget
// from 160 to 70 chars. Every composed message must stay plain ASCII
// punctuation — see this package's own doc comment.
func TestNoMessageForcesUCS2(t *testing.T) {
	deliveredAt := time.Date(2026, 9, 10, 14, 5, 0, 0, time.UTC)
	longLabel := strings.Repeat("x", 80)
	messages := map[string]string{
		"OtpCode":                        OtpCode("123456"),
		"ContributionConfirmed":          ContributionConfirmed(1000, "Jane Doe", "Amani Chama", ptrF(5000), "TXN123"),
		"ContributionConfirmedNoBalance": ContributionConfirmed(9_999_999, longLabel, longLabel, nil, "TXN123"),
		"ContributionDeclared":           ContributionDeclared(9_999_999, "MPESA", "TXN123"),
		"VoucherLoaded":                  VoucherLoaded(9_999_999, longLabel, "VCH-7K3H92", 9_999_999, "M-Pesa"),
		"VoucherGifted":                  VoucherGifted(9_999_999, longLabel, longLabel, "VCH-7K3H92"),
		"VoucherGiftedNoGiver":           VoucherGifted(9_999_999, "", longLabel, "VCH-7K3H92"),
		"ParcelCollectionScheduled":      ParcelCollectionScheduled("PKG-ABC123", "Jane", "+254712345678", "10:00 on 10 Sep"),
		"ParcelPickupAssigned":           ParcelPickupAssigned("PKG-ABC123", longLabel, longLabel, "10:00 on 10 Sep"),
		"ParcelPickedUp":                 ParcelPickedUp("PKG-ABC123", longLabel, "John"),
		"ParcelInTransitToYou":           ParcelInTransitToYou("PKG-ABC123", "Jane", longLabel, "7Y3K9Q", ""),
		"ParcelDelivered":                ParcelDelivered("PKG-ABC123", longLabel, deliveredAt),
		"ParcelReceived":                 ParcelReceived("PKG-ABC123", "Jane", deliveredAt),
		"ParcelCancelled":                ParcelCancelled("PKG-ABC123", "Sender requested cancellation", "Your M-Pesa payment will be refunded separately."),
		"ParcelRefunded":                 ParcelRefunded("PKG-ABC123", "7700.00"),
		"ParcelPaymentConfirmed":         ParcelPaymentConfirmed("PKG-ABC123", "585", longLabel, longLabel, "TGH7X8Y9Z0"),
		"ParcelReceiptConfirmed":         ParcelReceiptConfirmed("PKG-ABC123", "Faith", 5),
		"ParcelDeliveryAttemptFailed": ParcelDeliveryAttemptFailed(
			"PKG-ABC123", "nobody was there to receive it", 1),
		"ParcelDeliveryAttemptFailedFinal": ParcelDeliveryAttemptFailed(
			"PKG-ABC123", "nobody was there to receive it", 3),
		"ParcelAtAgent":           ParcelAtAgent("PKG-ABC123", longLabel, longLabel, longLabel, "7Y3K9Q"),
		"ParcelAtAgentNoHours":    ParcelAtAgent("PKG-ABC123", longLabel, longLabel, "", "7Y3K9Q"),
		"ParcelReturnedToSender":  ParcelReturnedToSender("PKG-ABC123", longLabel),
		"ParcelCodBooked":         ParcelCodBooked("PKG-ABC123", longLabel, longLabel),
		"ParcelCodCollected":      ParcelCodCollected("PKG-ABC123", "12000", "0", false),
		"ParcelCodCollectedShort": ParcelCodCollected("PKG-ABC123", "12000", "3500", true),
		"ParcelCodSettled":        ParcelCodSettled("120000", 7, longLabel),
		"ParcelCodSettledOne":     ParcelCodSettled("2000", 1, longLabel),
		"ParcelOnBus":             ParcelOnBus("PKG-ABC123", "KBZ 123A", longLabel, longLabel),
		"ParcelOnBusNoStage":      ParcelOnBus("PKG-ABC123", "KBZ 123A", longLabel, ""),
		"CourierPaid":             CourierPaid("12500", &longLabel),
		"CourierPaidNoRef":        CourierPaid("12500", nil),
		"ParcelInTransitToYouViaCarrier": ParcelInTransitToYou(
			"PKG-ABC123", "Jane", longLabel, "7Y3K9Q", longLabel),
		"CourierParcelsLeftBehind": CourierParcelsLeftBehind(
			"FLEET-99", 999, []string{"PKG-ABCDEF", "PKG-GHIJKL"}),
		"CourierParcelsLeftBehindOneSample": CourierParcelsLeftBehind(
			"FLEET-1", 1, []string{"PKG-ABCDEF"}),
		"CourierTripDeparted": CourierTripDeparted("FLEET-99", 42),
	}
	for name, msg := range messages {
		for _, r := range msg {
			if r > 127 {
				t.Errorf("%s contains a non-ASCII rune %q, forces UCS-2 encoding (70 chars/segment instead of 160): %q", name, r, msg)
			}
		}
		if len(msg) > 160 {
			t.Errorf("%s is %d chars, over the single-GSM-7-segment budget of 160: %q", name, len(msg), msg)
		}
	}
}

// TestParcelInTransitToYouNamesCarrier — the "via Dreamline" addition:
// present only when a carrier is actually named, absent for
// Esoqo-operated dispatch (empty string), so the historical wording is
// untouched for every parcel that isn't carried by a partner company.
func TestParcelInTransitToYouNamesCarrier(t *testing.T) {
	withCarrier := ParcelInTransitToYou("PKG-ABC123", "Jane", "CBD", "7Y3K9Q", "Dreamline")
	if !strings.Contains(withCarrier, "via Dreamline") {
		t.Errorf("expected the carrier to be named: %q", withCarrier)
	}
	withoutCarrier := ParcelInTransitToYou("PKG-ABC123", "Jane", "CBD", "7Y3K9Q", "")
	if strings.Contains(withoutCarrier, "via") {
		t.Errorf("Esoqo-operated dispatch should not mention a carrier: %q", withoutCarrier)
	}
}

// TestCourierParcelsLeftBehind — the team-facing exception alert names
// the fleet, the count and a taster of codes, and says "and N more"
// only once the sample is truncated.
func TestCourierParcelsLeftBehind(t *testing.T) {
	msg := CourierParcelsLeftBehind("FLEET-99", 5, []string{"PKG-AAA111", "PKG-BBB222"})
	for _, want := range []string{"FLEET-99", "5", "PKG-AAA111", "PKG-BBB222", "3 more"} {
		if !strings.Contains(msg, want) {
			t.Errorf("left-behind message missing %q: %q", want, msg)
		}
	}
	exact := CourierParcelsLeftBehind("FLEET-1", 1, []string{"PKG-AAA111"})
	if strings.Contains(exact, "more") {
		t.Errorf("a fully-sampled list should not say 'more': %q", exact)
	}
}

func TestCourierTripDeparted(t *testing.T) {
	msg := CourierTripDeparted("FLEET-99", 12)
	for _, want := range []string{"FLEET-99", "12", "left"} {
		if !strings.Contains(msg, want) {
			t.Errorf("departed message missing %q: %q", want, msg)
		}
	}
}

func ptrF(v float64) *float64 { return &v }

// TestKESFormatting — the money format every composer here quotes, and
// the thing that has to match smsKes in packages/domain/src/sms.ts
// character for character: the same event notified from the web and
// from the mobile API must not read differently.
func TestKESFormatting(t *testing.T) {
	cases := map[float64]string{
		0:       "KES 0",
		99.6:    "KES 100",
		2500:    "KES 2,500",
		1234567: "KES 1,234,567",
		-2500:   "KES -2,500",
		999.4:   "KES 999",
	}
	for in, want := range cases {
		if got := KES(in); got != want {
			t.Errorf("KES(%v) = %q, want %q", in, got, want)
		}
	}
}

// TestVoucherGiftedNamesTheSender — a card someone else paid for is the
// one voucher message whose recipient did nothing to trigger it, so it
// has to say where it came from or it reads like a scam.
func TestVoucherGiftedNamesTheSender(t *testing.T) {
	msg := VoucherGifted(2000, "Mama Njeri", "Fare", "VCH-7K3H92")
	for _, want := range []string{"Mama Njeri", "KES 2,000", "VCH-7K3H92"} {
		if !strings.Contains(msg, want) {
			t.Errorf("gift message %q is missing %q", msg, want)
		}
	}
}

// TestVoucherLoadedQuotesTheNewBalance — the reason someone tops a card
// up is to be able to spend it; "we added 200" without "you now have
// 340" does not answer the question they actually have.
func TestVoucherLoadedQuotesTheNewBalance(t *testing.T) {
	msg := VoucherLoaded(200, "Fare", "VCH-7K3H92", 340, "M-Pesa")
	if !strings.Contains(msg, "New balance KES 340") {
		t.Errorf("top-up message should quote the new balance: %q", msg)
	}
}
