package dbx

import (
	"testing"
	"time"
)

// The pre-intake reduction is the control that stands between an
// unauthenticated endpoint and a stranger's parcel: who is collecting it,
// from which shop's phone number, and where a courier left it. It is also
// the control most likely to be quietly undone — by a new field added to
// the view, or by a second caller that forgets to call it. These tests
// pin the behaviour rather than the field list, so both failures show up
// here.

func fullUnintakenView() *ParcelStatusView {
	at := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	return &ParcelStatusView{
		Code:               "PKG-ABC123",
		Status:             "BOOKED",
		OriginLabel:        "Westlands",
		DestinationLabel:   "Karen, off Riverside Drive",
		PriceKes:           strPtr("1200.00"),
		SlaDeadlineAt:      &at,
		IntakeConfirmedAt:  nil,
		Agent:              &ParcelAgentStop{Name: "Kijani Shop", Msisdn: "+254700111222", Lat: -1.28, Lng: 36.81},
		PodPhotoURL:        strPtr("https://cdn.example/pod/1.jpg"),
		PodReceivedByName:  strPtr("Achieng' Otieno"),
		PodMethod:          strPtr("CODE"),
		CancellationReason: strPtr("Receiver refused — wrong contents"),
		CancelledAt:        &at,
		LastAttemptReason:  strPtr("NOBODY_HOME"),
		LastAttemptText:    strPtr("Nobody home"),
		LastAttemptAt:      &at,
		DeliveryAttempts:   3,
		ReceiptConfirmedAt: &at,
		Events:             []ParcelTrackEvent{{Label: "Booked"}, {Label: "Picked up"}},
	}
}

func intakenView() *ParcelStatusView {
	v := fullUnintakenView()
	at := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	v.IntakeConfirmedAt = &at
	return v
}

// The whole point: before intake nothing has been collected and nobody has
// taken the box in, so none of these fields can be true — and pre-intake
// the credential is the serviceTicketNumber, which is what an
// unauthenticated caller actually holds.
func TestReduceStripsEverythingPreIntake(t *testing.T) {
	out := ReduceParcelStatusForUnintaken(fullUnintakenView())

	if out.Code != "" {
		t.Errorf("Code = %q, want empty — GetParcelStatus matches on the ticket number too, so echoing the real tracking code hands back the stronger credential the ticket was substituting for", out.Code)
	}
	if out.Agent != nil {
		t.Errorf("Agent = %+v, want nil — the collection shop's phone number and coordinates are the pickpocket's prize here", out.Agent)
	}
	if out.PodPhotoURL != nil {
		t.Errorf("PodPhotoURL = %v, want nil", out.PodPhotoURL)
	}
	if out.PodReceivedByName != nil {
		t.Errorf("PodReceivedByName = %v, want nil — names whoever actually took the box", out.PodReceivedByName)
	}
	if out.PodMethod != nil {
		t.Errorf("PodMethod = %v, want nil", out.PodMethod)
	}
	if out.DestinationLabel != "" {
		t.Errorf("DestinationLabel = %q, want empty — the receiver's address", out.DestinationLabel)
	}
	if out.CancellationReason != nil {
		t.Errorf("CancellationReason = %v, want nil", out.CancellationReason)
	}
	if out.CancelledAt != nil {
		t.Errorf("CancelledAt = %v, want nil", out.CancelledAt)
	}
	if out.LastAttemptReason != nil || out.LastAttemptText != nil || out.LastAttemptAt != nil {
		t.Errorf("last-attempt fields = %v/%v/%v, want all nil — the timeline is custody history", out.LastAttemptReason, out.LastAttemptText, out.LastAttemptAt)
	}
	if out.DeliveryAttempts != 0 {
		t.Errorf("DeliveryAttempts = %d, want 0", out.DeliveryAttempts)
	}
	if out.ReceiptConfirmedAt != nil {
		t.Errorf("ReceiptConfirmedAt = %v, want nil", out.ReceiptConfirmedAt)
	}
	if out.Events != nil {
		t.Errorf("Events = %v, want nil", out.Events)
	}
	if out.PriceKes != nil {
		t.Errorf("PriceKes = %v, want nil", out.PriceKes)
	}
	if out.SlaDeadlineAt != nil {
		t.Errorf("SlaDeadlineAt = %v, want nil", out.SlaDeadlineAt)
	}
}

// Once the parcel is physically in, the sender/receiver SMS pair has
// fired and the tracking code IS the credential — the full view is the
// point. A reduction that over-applied here would quietly break the
// feature it protects.
func TestReduceLeavesIntakenViewAlone(t *testing.T) {
	in := intakenView()
	out := ReduceParcelStatusForUnintaken(in)

	if out == in {
		t.Fatal("returned the same pointer; a caller can't tell it wasn't reduced, and a future mutation is silently shared")
	}
	if out.Code != in.Code {
		t.Errorf("Code = %q, want %q — post-intake the tracking code is the credential", out.Code, in.Code)
	}
	if out.Agent == nil {
		t.Error("Agent = nil, want the pickup point — this is the point of the whole feature")
	}
	if out.PodReceivedByName == nil {
		t.Error("PodReceivedByName = nil, want the name of whoever signed for it")
	}
	if len(out.Events) != len(in.Events) {
		t.Errorf("Events = %v, want %v", out.Events, in.Events)
	}
}

// Must not mutate the caller's struct. GetParcelStatus hands back a
// fresh view per call today, but the reduction is exported and the
// next caller may be caching one; blanking fields in place would turn
// their cache into a permanent scrub.
func TestReduceDoesNotMutateInput(t *testing.T) {
	in := fullUnintakenView()
	ReduceParcelStatusForUnintaken(in)

	if in.Code != "PKG-ABC123" {
		t.Errorf("input Code = %q, want it untouched — the reducer copied", in.Code)
	}
	if in.Agent == nil {
		t.Error("input Agent = nil, want untouched")
	}
	if in.DestinationLabel == "" {
		t.Error("input DestinationLabel was blanked in place")
	}
}

func TestReduceHandlesNil(t *testing.T) {
	if got := ReduceParcelStatusForUnintaken(nil); got != nil {
		t.Errorf("got %+v, want nil", got)
	}
}
