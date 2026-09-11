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
	if !strings.Contains(msg, "Esoko") {
		t.Errorf("OtpCode message should identify Esoko: %q", msg)
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
		{"inTransit", ParcelInTransitToYou("PKG-ABC123", "Jane", "CBD", "7Y3K9Q"), []string{"PKG-ABC123", "Jane", "CBD", "7Y3K9Q"}},
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

// TestNoMessageForcesUCS2 — a single non-GSM-7 character (an em dash is
// the one that snuck in before) silently drops the per-segment budget
// from 160 to 70 chars. Every composed message must stay plain ASCII
// punctuation — see this package's own doc comment.
func TestNoMessageForcesUCS2(t *testing.T) {
	deliveredAt := time.Date(2026, 9, 10, 14, 5, 0, 0, time.UTC)
	longLabel := strings.Repeat("x", 80)
	messages := map[string]string{
		"OtpCode":                   OtpCode("123456"),
		"ContributionConfirmed":     ContributionConfirmed("1,000", "Jane Doe", "Amani Chama", "5,000", "TXN123"),
		"ParcelCollectionScheduled": ParcelCollectionScheduled("PKG-ABC123", "Jane", "+254712345678", "10:00 on 10 Sep"),
		"ParcelPickupAssigned":      ParcelPickupAssigned("PKG-ABC123", longLabel, longLabel, "10:00 on 10 Sep"),
		"ParcelPickedUp":            ParcelPickedUp("PKG-ABC123", longLabel, "John"),
		"ParcelInTransitToYou":      ParcelInTransitToYou("PKG-ABC123", "Jane", longLabel, "7Y3K9Q"),
		"ParcelDelivered":           ParcelDelivered("PKG-ABC123", longLabel, deliveredAt),
		"ParcelReceived":            ParcelReceived("PKG-ABC123", "Jane", deliveredAt),
		"ParcelCancelled":           ParcelCancelled("PKG-ABC123", "Sender requested cancellation", "Your M-Pesa payment will be refunded separately."),
		"ParcelRefunded":            ParcelRefunded("PKG-ABC123", "7700.00"),
		"ParcelPaymentConfirmed":    ParcelPaymentConfirmed("PKG-ABC123", "585", longLabel, longLabel, "TGH7X8Y9Z0"),
		"ParcelReceiptConfirmed":    ParcelReceiptConfirmed("PKG-ABC123", "Faith", 5),
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
