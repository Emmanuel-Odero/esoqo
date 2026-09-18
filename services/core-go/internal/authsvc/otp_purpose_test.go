package authsvc

import "testing"

// TestPublicOtpPurposesAreClosed is the tripwire for the SMS-pumping fix.
//
// POST /v1/auth/otp is unauthenticated and, before this list existed, cast
// whatever string a caller sent straight to an OtpPurpose — so anyone could
// mint a code for an arbitrary number under a purpose a server-side flow
// treats as trusted (a parcel hand-over, a staff sign-in, a step-up). Every
// purpose that is issued only after the server has resolved the recipient
// from a record of its own must stay off this list.
func TestPublicOtpPurposesAreClosed(t *testing.T) {
	allowed := []OtpPurpose{OtpRegistration, OtpSignIn, OtpPinReset}
	for _, p := range allowed {
		if !IsPublicOtpPurpose(p) {
			t.Errorf("expected %q to be requestable on the public endpoint", p)
		}
	}

	denied := []OtpPurpose{
		OtpStepUp,
		OtpConsentGrant,
		OtpParcelReceipt,
		OtpParcelClaim,
		OtpParcelStaffSignIn,
		OtpParcelDeliveryConfirm,
		"",
		"ARBITRARY",
	}
	for _, p := range denied {
		if IsPublicOtpPurpose(p) {
			t.Errorf("purpose %q must not be requestable on the public endpoint", p)
		}
	}
}
