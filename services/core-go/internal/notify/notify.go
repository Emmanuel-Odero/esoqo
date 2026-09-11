// Package notify composes the actual text of every SMS this service
// sends. One pure function per event, same "compose the string
// separately from deciding when to send it" convention
// packages/domain/src/*-notify.ts already follows on the TS side —
// callers (a handler, a webhook, an admin action) call authsvc.SendSms
// with whatever this package hands back, they never build a message
// string themselves. Kept factual and specific — who/what/where/next
// step — never a bare "status changed" line: that's the whole point of
// this package existing instead of another inline fmt.Sprintf.
//
// This is deliberately not a database-backed template engine (no
// admin-editable copy, no runtime variable substitution beyond normal
// Go string formatting) — nothing here asked for admin-editable
// wording, only for every message to read like it was actually written
// for the event it reports. Extending it to a new event is: add one
// function here, call it from wherever that event is confirmed.
//
// Two hard rules, both because an SMS aggregator bills (and a phone
// displays) per segment, not per message:
//
//  1. GSM-7 only — no em dash (—), no curly quotes/apostrophes, no
//     emoji. A single non-GSM-7 character anywhere in the body forces
//     the *whole* message into UCS-2 encoding, which drops the budget
//     from 160 chars/segment to 70 (and from 153 to 67 once a message
//     needs to concatenate) — silently turning what looks like "one
//     text" into two or three on the recipient's phone, and billing
//     accordingly. Stick to plain ASCII punctuation: hyphen, colon,
//     comma, parentheses, straight quotes.
//  2. Keep every composed message at or under 160 characters with
//     realistic field values. Free-text fields a sender/admin typed
//     (labels, names) are run through trunc() below so one long entry
//     can't silently push a message into a second segment.
package notify

import (
	"fmt"
	"strings"
	"time"
)

// smsFieldMaxLen — a free-text field embedded in a message is cut to
// this length (plus an ASCII "..." marker, itself part of the budget)
// before formatting. Chosen so even a message combining two such
// fields (e.g. ParcelPaymentConfirmed's receiver name + destination)
// still leaves room under the single-segment (160 GSM-7 char) budget
// the doc comment above sets — see TestNoMessageForcesUCS2.
const smsFieldMaxLen = 20

// trunc — defensive truncation for any free-text value (a label, a
// name) interpolated into an SMS body. Most values are well under this
// length; this only bites the rare pathological entry, so a single
// long address never silently pushes a message into a second segment.
// The marker is plain ASCII "..." (not "…") — a single non-GSM-7 rune
// anywhere in the message is exactly the mistake this whole file's
// doc comment warns against.
func trunc(s string) string {
	if len(s) <= smsFieldMaxLen {
		return s
	}
	return s[:smsFieldMaxLen-3] + "..."
}

// OtpCode — replaces the inline fmt.Sprintf that used to live in
// authsvc/otp.go verbatim; same wording, now composed in one place so
// it can be unit-tested and reused if another OTP-sending path ever
// needs it.
func OtpCode(code string) string {
	return fmt.Sprintf("%s is your Esoko code. It expires in 10 minutes. Esoko will never ask you for it.", code)
}

// ContributionConfirmed — replaces handlers_treasury.go's inline
// fmt.Sprintf; same content, now reusable/testable.
func ContributionConfirmed(amountKES, contributorName, orgName, newBalanceKES, reference string) string {
	return fmt.Sprintf("KES %s from %s credited to %s, new balance KES %s - ref %s",
		amountKES, trunc(contributorName), trunc(orgName), newBalanceKES, reference)
}

// ParcelCollectionScheduled — sent to the sender the moment an admin
// assigns a collector, so "someone is coming for it" lands before the
// courier ever shows up. Includes the collector's own phone number —
// previously this message named a collector with no way to actually
// reach them if the sender needed to.
func ParcelCollectionScheduled(code, collectorName, collectorMsisdn, scheduledWindow string) string {
	if collectorMsisdn == "" {
		return fmt.Sprintf(
			"Esoko Logistics: %s will collect parcel %s at %s. Please have it ready.",
			trunc(collectorName), code, scheduledWindow)
	}
	return fmt.Sprintf(
		"Esoko Logistics: %s (%s) will collect parcel %s at %s. Please have it ready.",
		trunc(collectorName), collectorMsisdn, code, scheduledWindow)
}

// ParcelPickupAssigned — sent to the COURIER (not the sender) the
// moment an admin schedules them for a collection, so a fleet driver
// who isn't watching the app's job list still finds out there's a
// parcel waiting on them. Gig couriers who claim jobs via the app
// don't need this — they already know, they just did it themselves.
func ParcelPickupAssigned(code, senderName, originLabel, scheduledWindow string) string {
	return fmt.Sprintf(
		"Esoko Logistics: New pickup. Parcel %s from %s at %s. Collect by %s.",
		code, trunc(senderName), trunc(originLabel), scheduledWindow)
}

// ParcelPickedUp — sent to the sender the moment the parcel is
// actually scanned into a courier's custody (first BOOKED→PICKED_UP
// transition), never at booking or payment time. courierName is empty
// when it can't be resolved (shouldn't happen in practice, since
// ScanHandoff always records who scanned it) — the message still reads
// fine without it.
func ParcelPickedUp(code, destinationLabel, courierName string) string {
	if courierName == "" {
		return fmt.Sprintf(
			"Esoko Logistics: Parcel %s picked up and on its way to %s. We'll text you once delivered.",
			code, trunc(destinationLabel))
	}
	return fmt.Sprintf(
		"Esoko Logistics: Parcel %s picked up by %s and on its way to %s. We'll text you once delivered.",
		code, trunc(courierName), trunc(destinationLabel))
}

// ParcelInTransitToYou — the receiver's side of the same pickup event.
// Carries deliveryCode because the receiver is the only one who can
// hand it to the courier at drop-off (DeliverParcel checks it) — the
// code was previously generated but never sent to anyone who'd
// actually need to produce it, which is why couriers kept hitting
// "wrong code" at the door: the receiver simply never had it.
func ParcelInTransitToYou(code, senderName, originLabel, deliveryCode string) string {
	return fmt.Sprintf(
		"Esoko Logistics: A parcel from %s (%s, from %s) is on its way to you. Give the courier code %s to receive it.",
		trunc(senderName), code, trunc(originLabel), deliveryCode)
}

// ParcelDelivered — sender's side: confirms the drop-off happened.
func ParcelDelivered(code, destinationLabel string, deliveredAt time.Time) string {
	return fmt.Sprintf(
		"Esoko Logistics: Parcel %s was delivered to %s at %s. Thanks for using Esoko.",
		code, trunc(destinationLabel), deliveredAt.Format("15:04 on 2 Jan"))
}

// ParcelReceived — receiver's side of the same delivery event.
func ParcelReceived(code, senderName string, deliveredAt time.Time) string {
	return fmt.Sprintf(
		"Esoko Logistics: You received parcel %s from %s at %s. Thanks for using Esoko.",
		code, trunc(senderName), deliveredAt.Format("15:04 on 2 Jan"))
}

// ParcelCancelled — sent to the sender when an admin cancels a draft
// or not-yet-picked-up parcel. refundNote is empty for an unpaid
// draft; for a paid one it says exactly what happens to the money —
// never leaves the sender to wonder.
func ParcelCancelled(code, reason, refundNote string) string {
	msg := fmt.Sprintf("Esoko Logistics: Parcel %s cancelled: %s.", code, reason)
	if refundNote != "" {
		msg += " " + refundNote
	}
	return msg
}

// ParcelRefunded — sent to the sender once an admin has actually
// processed a cancelled parcel's M-Pesa refund (see
// dbx.MarkParcelRefunded) — closes the loop ParcelCancelled's
// "expect a follow-up" refundNote opened. Includes the amount — the
// one thing a sender waiting on a refund actually wants confirmed.
func ParcelRefunded(code, amountKes string) string {
	return fmt.Sprintf(
		"Esoko Logistics: KES %s refund for parcel %s has been processed to your M-Pesa.",
		amountKes, code)
}

// ParcelPaymentConfirmed — sent to the sender the moment payment for a
// parcel actually lands (inline points settlement, an auto-confirmed
// STK push, or the async M-Pesa callback) — previously the sender only
// ever saw a static in-app screen and heard nothing from us until (and
// unless) a collector was later scheduled. Now names who it's going to
// and where, and quotes the M-Pesa receipt when there is one (points
// payments have none) — a bare "payment received" left the sender with
// no way to match the text to an actual transaction or confirm the
// parcel was headed where they meant it to.
func ParcelPaymentConfirmed(code, priceKes, receiverName, destinationLabel, mpesaReceiptCode string) string {
	if mpesaReceiptCode == "" {
		return fmt.Sprintf(
			"Esoko Logistics: KES %s received for parcel %s to %s, %s. We'll text you once picked up.",
			priceKes, code, trunc(receiverName), trunc(destinationLabel))
	}
	return fmt.Sprintf(
		"Esoko Logistics: KES %s received for parcel %s to %s, %s. M-Pesa ref %s. We'll text you once picked up.",
		priceKes, code, trunc(receiverName), trunc(destinationLabel), mpesaReceiptCode)
}

// ParcelReceiptConfirmed — sent to the sender once the receiver has
// OTP-confirmed they got the parcel and rated its condition (see
// dbx.ConfirmParcelReceipt) — closes the loop past ParcelDelivered,
// which is only ever the courier's own claim of drop-off.
func ParcelReceiptConfirmed(code, receiverName string, rating int) string {
	return fmt.Sprintf(
		"Esoko Logistics: %s confirmed receiving parcel %s and rated its condition %d/5. Thanks for using Esoko.",
		trunc(receiverName), code, rating)
}

// CourierOnboarded — the confirmation text a newly admin-added courier
// gets, the moment dbx.AdminAddCourier creates their account: their own
// Esoko ID (see EnsureEsokoPaymentId), proof their phone number is the
// one actually on file rather than a typo nobody would otherwise
// notice until a dispatch SMS went nowhere.
func CourierOnboarded(name, esokoID string) string {
	return fmt.Sprintf(
		"Esoko: Welcome %s! You've been added to the Esoko courier team. Your Esoko ID is %s. Sign in with this phone number to get started.",
		trunc(name), esokoID)
}

// CourierTeamMemberAdded — sent to a manager or member the moment
// dbx.CreateCourierTeam/AddCourierTeamMember adds them to a named
// team: same "your Esoko ID, and proof this number is right" role
// CourierOnboarded plays for an individual courier, plus which team
// and role they've actually been given, and sets the expectation that
// this number is the one that'll hear about every trip going forward
// (see CourierTripCompleted) — so a member isn't just added and left
// wondering what happens next.
func CourierTeamMemberAdded(name, teamName, role, esokoID string) string {
	return fmt.Sprintf(
		"Esoko: Welcome %s! You've been added to courier team \"%s\" as %s. Your Esoko ID is %s. You'll get full trip and tracking alerts on this number. Sign in to get started.",
		trunc(name), trunc(teamName), roleLabel(role), esokoID)
}

// CourierTeamMemberUpdated — sent whenever a staffer corrects a
// roster entry (see dbx.UpdateCourierTeamMember): a changed phone
// number in particular is exactly the kind of thing someone needs to
// actually see land on their phone to trust it's right, same
// reasoning CourierOnboarded's own comment already gives for a fresh
// add.
func CourierTeamMemberUpdated(name, teamName, role, esokoID string) string {
	return fmt.Sprintf(
		"Esoko: Your details on courier team \"%s\" were updated - name %s, role %s. Your Esoko ID is %s. You'll get full trip and tracking alerts on this number.",
		trunc(teamName), trunc(name), roleLabel(role), esokoID)
}

// CourierTripCompleted — sent to every member of a fleet's team (see
// dbx.GetCourierTripCompletionInfo) the moment a staffer marks that
// fleet's trip complete: the fleet's back and its packages have
// arrived, closing the loop the same way ParcelDelivered closes it for
// an individual parcel's own sender/receiver pair.
func CourierTripCompleted(fleetNumber string, parcelCount int) string {
	if parcelCount == 1 {
		return fmt.Sprintf("Esoko Logistics: Fleet %s's trip is complete - its 1 parcel has arrived.", fleetNumber)
	}
	return fmt.Sprintf("Esoko Logistics: Fleet %s's trip is complete - all %d parcels have arrived.", fleetNumber, parcelCount)
}

// roleLabel lowercases a role string for mid-sentence use ("as
// manager", not "as MANAGER") without a lookup table that would need
// updating for every new role CourierTeamMember.role might ever hold —
// see that column's own comment on why it's a plain string.
func roleLabel(role string) string {
	return strings.ToLower(role)
}
