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
		{"intakeConfirmed", ParcelIntakeConfirmed("PKG-ABC123", nil, "Ngara", "Faith", "+254712345678"), []string{"PKG-ABC123", "Esoqo", "Ngara", "accepted", "Track it here"}},
		{"intakeToReceiver", ParcelIntakeConfirmedToReceiver("PKG-ABC123", "Jane", nil, "7Y3K9Q"), []string{"PKG-ABC123", "Jane", "7Y3K9Q"}},
		{"intakeToReceiverNoCode", ParcelIntakeConfirmedToReceiver("PKG-ABC123", "Jane", nil, ""), []string{"PKG-ABC123", "Jane"}},
		{"dispatchSummary", ParcelOrgDispatchSummary("Dreamline", "PKG-ABC123", 10), []string{"PKG-ABC123", "Dreamline", "10 parcels"}},
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
		"atAgent":          ParcelAtAgent("PKG-ABC123", longLabel, longLabel, longLabel, "7Y3K9Q", nil),
		"returned":         ParcelReturnedToSender("PKG-ABC123", longLabel),
		"codBooked":        ParcelCodBooked("PKG-ABC123", longLabel, longLabel),
		"codCollected":     ParcelCodCollected("PKG-ABC123", "12000", "0", false),
		"codShort":         ParcelCodCollected("PKG-ABC123", "12000", "3500", true),
		"onBus":            ParcelOnBus("PKG-ABC123", "KBZ 123A", longLabel, longLabel),
		"intakeConfirmed":  ParcelIntakeConfirmed("PKG-ABC123", &longLabel, longLabel, longLabel, "+254712345678"),
		"intakeToReceiver": ParcelIntakeConfirmedToReceiver("PKG-ABC123", longLabel, &longLabel, "7Y3K9Q"),
		"dispatchSummary":  ParcelOrgDispatchSummary(longLabel, "PKG-ABC123", 10),
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
		"ParcelAtAgent":           ParcelAtAgent("PKG-ABC123", longLabel, longLabel, longLabel, "7Y3K9Q", nil),
		"ParcelAtAgentNoHours":    ParcelAtAgent("PKG-ABC123", longLabel, longLabel, "", "7Y3K9Q", nil),
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
		"ParcelStaffInvited": ParcelStaffInvited(
			"Swift Riders", "Wanjiku", "MANAGER", "", ""),
		"ParcelStaffInvitedTempPin": ParcelStaffInvited(
			"Swift Riders", "Wanjiku", "MANAGER", "", "482910"),
		"ParcelStaffInvitedTempPinLong": ParcelStaffInvited(
			longLabel, longLabel, "MANAGER", "", "482910"),
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

// TestParcelStaffInvitedCarriesTempPin — a first-time invitee gets
// their first PIN in the text so they can sign in immediately and then
// reset it. The PIN outranks the sign-in link in the single-segment
// budget: a long org name drops the link, never the credential.
func TestParcelStaffInvitedCarriesTempPin(t *testing.T) {
	original := trackingBaseURL
	t.Cleanup(func() { trackingBaseURL = original })

	withPin := ParcelStaffInvited("Swift Riders", "Wanjiku", "MANAGER", "", "482910")
	if !strings.Contains(withPin, "482910") {
		t.Errorf("invite should carry the temporary PIN: %q", withPin)
	}
	if !strings.Contains(withPin, "Change it after you sign in") {
		t.Errorf("invite should tell the recipient to reset the PIN: %q", withPin)
	}

	withoutPin := ParcelStaffInvited("Swift Riders", "Wanjiku", "MANAGER", "", "")
	if strings.Contains(withoutPin, "Temp PIN") {
		t.Errorf("invite without a PIN must not mention one: %q", withoutPin)
	}

	SetTrackingBaseURL("https://esoqo.co.ke")
	// Tiny names leave room for everything: PIN and link together.
	tiny := ParcelStaffInvited("AB", "Jo", "RIDER",
		ParcelStaffInviteURL("ab", "Jo"), "482910")
	if !strings.Contains(tiny, "482910") || !strings.Contains(tiny, "https://") {
		t.Errorf("a tiny invite should carry both the PIN and the link: %q", tiny)
	}
	if len(tiny) > 160 {
		t.Errorf("tiny invite overflowed its segment budget: %d chars: %q", len(tiny), tiny)
	}
	// Typical names: the PIN (the credential) wins and the link drops.
	short := ParcelStaffInvited("Swift Riders", "Wanjiku", "MANAGER",
		ParcelStaffInviteURL("swift-riders", "Wanjiku"), "482910")
	if !strings.Contains(short, "482910") {
		t.Errorf("a typical invite must keep the PIN: %q", short)
	}
	if strings.Contains(short, "https://") {
		t.Errorf("a typical invite should drop the link rather than overflow: %q", short)
	}
	if len(short) > 160 {
		t.Errorf("typical invite overflowed its segment budget: %d chars: %q", len(short), short)
	}

	longLabel := strings.Repeat("x", 80)
	long := ParcelStaffInvited(longLabel, longLabel, "MANAGER",
		ParcelStaffInviteURL(longLabel, longLabel), "482910")
	if !strings.Contains(long, "482910") {
		t.Errorf("a long invite must keep the PIN even when the link is dropped: %q", long)
	}
	if strings.Contains(long, "https://") {
		t.Errorf("a long invite should drop the link rather than overflow: %q", long)
	}
	if len(long) > 160 {
		t.Errorf("long invite overflowed its segment budget: %d chars: %q", len(long), long)
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

// TestReceiverAlwaysGetsTheDeliveryCode — the receiver's intake message
// is the only SMS they get before a courier knocks, so it is the only
// place the delivery code can reach the one person DeliverParcel
// expects to produce it.
//
// This regression is worth its own test because dropping the code broke
// nothing loudly: the message still sent, still named the sender, still
// looked right in a console log. It only surfaced at the door, as a
// courier hitting "that delivery code doesn't match" on every single
// parcel, because the receiver had never been told a code at all.
func TestReceiverAlwaysGetsTheDeliveryCode(t *testing.T) {
	carrier := "Dreamline"
	for name, msg := range map[string]string{
		"esoqoOperated": ParcelIntakeConfirmedToReceiver("PKG-ABC123", "Jane", nil, "7Y3K9Q"),
		"viaCarrier":    ParcelIntakeConfirmedToReceiver("PKG-ABC123", "Jane", &carrier, "7Y3K9Q"),
	} {
		if !strings.Contains(msg, "7Y3K9Q") {
			t.Errorf("%s: receiver was not given the delivery code they must hand the courier: %q", name, msg)
		}
	}

	// The carrier is named when there is one, and "Esoqo" stands in when
	// dispatch is our own — same convention courierCompanyLabel applies
	// across the intake pair.
	if msg := ParcelIntakeConfirmedToReceiver("PKG-ABC123", "Jane", &carrier, "7Y3K9Q"); !strings.Contains(msg, "Dreamline") {
		t.Errorf("expected the carrying company to be named: %q", msg)
	}

	// No code on file is a real state, and must read as a coherent
	// message rather than printing an empty slot where a code belongs.
	noCode := ParcelIntakeConfirmedToReceiver("PKG-ABC123", "Jane", nil, "")
	if strings.Contains(noCode, "code  ") || strings.HasSuffix(strings.TrimSpace(noCode), "code") {
		t.Errorf("a missing delivery code should change the sentence, not leave a blank: %q", noCode)
	}
}

// TestParcelIntakeConfirmedPromisesOnlyWhatWeSend — the sender's intake
// message once said "we'll text you when we dispatch it", which no code
// path ever did: the dispatch scan texts the carrying company's own desk
// (ParcelOrgDispatchSummary), never the sender. The next thing a sender
// actually hears is ParcelDelivered.
func TestParcelIntakeConfirmedPromisesOnlyWhatWeSend(t *testing.T) {
	msg := ParcelIntakeConfirmed("PKG-ABC123", nil, "Ngara", "Faith", "+254712345678")
	if strings.Contains(msg, "dispatch") {
		t.Errorf("sender is promised a dispatch SMS that nothing sends: %q", msg)
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

// TestGsmSafeFoldsToASCII — every real-world character that would
// otherwise force UCS-2 (or reach a gateway as a mangled escape) folds
// to its ASCII twin, or is dropped when nothing sensible maps. This is
// the guarantee authsvc.SendSms's last-line-of-defence call relies on.
func TestGsmSafeFoldsToASCII(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"emDash", "a\u2014b", "a-b"},
		{"enDash", "a\u2013b", "a-b"},
		{"curlyApostrophe", "it\u2019s", "it's"},
		{"curlyDoubleQuote", "\u201chi\u201d", "\"hi\""},
		{"ellipsis", "wait\u2026", "wait..."},
		{"nbsp", "a\u00a0b", "a b"},
		{"zeroWidth", "a\u200bb", "ab"},
		{"trademark", "Esoqo\u2122", "Esoqo(TM)"},
		{"bullet", "a\u2022b", "a-b"},
		{"accentedLatin", "Caf\u00e9", "Cafe"},
		{"umlaut", "M\u00fcller", "Muller"},
		{"backtick", "a`b", "ab"},
		{"emoji", "hi\U0001F600", "hi"},
		{"euro", "\u20ac5", "5"},
		{"tab", "a\tb", "ab"},
		{"doubleSpace", "a  b", "a b"},
	}
	for _, tc := range cases {
		got := GsmSafe(tc.in)
		if got != tc.want {
			t.Errorf("%s: GsmSafe(%q) = %q, want %q", tc.name, tc.in, got, tc.want)
		}
		for _, r := range got {
			if r > 127 {
				t.Errorf("%s: GsmSafe leaked non-ASCII rune %q from %q: %q", tc.name, r, tc.in, got)
				break
			}
		}
	}
}

// TestTruncFoldsBeforeBudgeting — trunc's free-text budget is only
// worth anything if the string it measures is already GSM-7, or one
// pasted accent in an otherwise-short name silently doubles the
// message. Folding must keep the base letter, not drop it.
func TestTruncFoldsBeforeBudgeting(t *testing.T) {
	if got := trunc("Jos\u00e9"); got != "Jose" {
		t.Errorf("trunc should keep the base letter of an accented name: %q", got)
	}
	long := "Jos\u00e9 " + strings.Repeat("x", 40)
	got := trunc(long)
	if len(got) > smsFieldMaxLen {
		t.Errorf("trunc(%q) = %q is %d chars, over the %d budget", long, got, len(got), smsFieldMaxLen)
	}
	for _, r := range got {
		if r > 127 {
			t.Errorf("trunc leaked non-ASCII rune %q: %q", r, got)
			break
		}
	}
}

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

// ── Receiver self-authentication ─────────────────────────────────────

// TestReceiverAuthMessagesAddressTheRightPerson pins the one genuinely
// non-obvious choice in this group: a HARD lock texts the SENDER, not
// the receiver.
//
// That is deliberate and it is the sort of thing a later edit would
// "fix" without realising. By the time five attempts have failed we no
// longer believe whoever has been typing is the receiver. Texting the
// receiver's number would either tell an impostor how far they got, or
// tell a genuine receiver something they can do nothing about. The
// sender holds the original code, knows who they sent it to, and is
// the only person able to say "that is not them" or "ring them, it's
// 4821".
func TestReceiverAuthMessagesAddressTheRightPerson(t *testing.T) {
	desk := ParcelReceiverAuthLocked("PKG-ABC123")
	if !strings.Contains(desk, "PKG-ABC123") {
		t.Errorf("the desk must be told which parcel: %q", desk)
	}
	// A message that only reports a problem generates a phone call to
	// Esoqo. This one has to name the two things the desk can do.
	if !strings.Contains(desk, "2 more") || !strings.Contains(strings.ToLower(desk), "new code") {
		t.Errorf("the desk alert must name both remedies (allow more tries / issue a new code): %q", desk)
	}

	sender := ParcelReceiverAuthHardLocked("PKG-ABC123", "Otis Baraka")
	if !strings.Contains(sender, "Otis Baraka") {
		t.Errorf("the sender must be told WHO failed — they are being asked to vouch for a person: %q", sender)
	}
	if strings.Contains(strings.ToLower(sender), "try again") {
		t.Errorf("a hard lock offers no more tries; the message must not imply one: %q", sender)
	}
}

// Both parties get the replacement. A reissue usually happens because
// the receiver's SMS is the thing that failed in the first place, so
// the sender relaying it by voice is frequently the only path that
// works — and relaying the code is what the sender has always done
// here (ListMyParcels returns deliveryCode to the sender's own list
// for exactly this reason).
func TestReissuedCodeReachesBothParties(t *testing.T) {
	const newCode = "481902"

	toReceiver := ParcelDeliveryCodeReissued("PKG-ABC123", newCode)
	if !strings.Contains(toReceiver, newCode) {
		t.Errorf("the receiver must actually be given the new code: %q", toReceiver)
	}
	// Without this, a receiver holding two texts tries the first one
	// they find and burns an attempt on a dead code.
	if !strings.Contains(strings.ToLower(toReceiver), "no longer works") {
		t.Errorf("the receiver must be told the old code is dead: %q", toReceiver)
	}

	toSender := ParcelDeliveryCodeReissuedToSender("PKG-ABC123", newCode, "Otis Baraka")
	if !strings.Contains(toSender, newCode) {
		t.Errorf("the sender must be given the new code to relay: %q", toSender)
	}
	if !strings.Contains(toSender, "Otis Baraka") {
		t.Errorf("the sender must be told who to pass it to: %q", toSender)
	}
}

// Every one of these is billed per segment and must survive the GSM-7
// rule this whole package is written against — including with the
// pathological free-text values trunc() exists to absorb.
func TestReceiverAuthMessagesFitOneSegment(t *testing.T) {
	long := strings.Repeat("Bartholomew Wanjiku-Kiprotich ", 4)
	for name, msg := range map[string]string{
		"locked":           ParcelReceiverAuthLocked("PKG-ABC123"),
		"hardLocked":       ParcelReceiverAuthHardLocked("PKG-ABC123", long),
		"reissuedReceiver": ParcelDeliveryCodeReissued("PKG-ABC123", "481902"),
		"reissuedSender":   ParcelDeliveryCodeReissuedToSender("PKG-ABC123", "481902", long),
	} {
		if len(msg) > smsSegmentBudget {
			t.Errorf("%s: %d chars, over the %d-char single-segment budget — this silently doubles the cost of every send: %q",
				name, len(msg), smsSegmentBudget, msg)
		}
		for _, r := range msg {
			if r > 127 {
				t.Errorf("%s: non-ASCII %q forces UCS-2 and cuts the segment to 70 chars: %q", name, r, msg)
				break
			}
		}
	}
}
