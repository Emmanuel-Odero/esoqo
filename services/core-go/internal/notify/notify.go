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
	"math"
	"net/url"
	"strconv"
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

// smsSegmentBudget — the single-GSM-7-segment ceiling this package's
// doc comment sets, named so withTrack can enforce it rather than
// restate it.
const smsSegmentBudget = 160

// trackingBaseURL is set once at boot from config.PublicTrackingBaseURL
// (see SetTrackingBaseURL). A process-wide constant rather than a
// parameter threaded through all twenty-odd composer functions: it is
// configuration, identical for every message this process ever sends,
// and the same shape SMS_SENDER_ID already has.
var trackingBaseURL string

// SetTrackingBaseURL is called once from main, before the server
// starts. Empty (the default) disables tracking links entirely, which
// is what keeps a misconfigured deploy from texting people a broken
// "https:///t/PKG-XXXX" instead of simply omitting the link.
func SetTrackingBaseURL(base string) {
	trackingBaseURL = strings.TrimRight(base, "/")
}

// TrackingURL — the public page for a parcel code, or "" when no base
// URL is configured. Exported because the web/admin surfaces want the
// identical string for a copy-link button; nothing should be
// reconstructing this path by hand.
func TrackingURL(code string) string {
	if trackingBaseURL == "" {
		return ""
	}
	return trackingBaseURL + "/t/" + code
}

// withTrack appends a tracking link to [msg] — but only if the result
// still fits in one SMS segment.
//
// The conditional is the whole point. An aggregator bills per segment,
// so a base URL longer than the room left in a message would silently
// double the cost of every notification that hit it, and nothing in a
// test suite would catch it because the overflow depends on runtime
// configuration and on how long a particular sender's name happened to
// be. Degrading to the code-only message (which is exactly what every
// one of these said before links existed) is strictly better than
// quietly paying twice: the recipient still has the code, and the code
// is what the tracking page asks for anyway.
func withTrack(msg, code string) string {
	url := TrackingURL(code)
	if url == "" {
		return msg
	}
	withLink := msg + " Track: " + url
	if len(withLink) > smsSegmentBudget {
		return msg
	}
	return withLink
}

// ParcelStaffInviteURL — the link an admin-invited courier-company
// staffer gets, pointing at the public tracking page's OTP staff panel
// (see httpapi.handleRequestParcelStaffOtp's own comment on why that
// panel, not the dedicated /parcel-co/<slug> portal, is where an
// OTP-only login lives) with orgSlug/name pre-filled so the only thing
// left for them to do is tap "Send code". "" when no base URL is
// configured, same degrade-gracefully rule TrackingURL follows —
// nothing here should text someone a broken link.
func ParcelStaffInviteURL(orgSlug, name string) string {
	if trackingBaseURL == "" {
		return ""
	}
	return trackingBaseURL + "/send-parcel/track?orgSlug=" + url.QueryEscape(orgSlug) + "&name=" + url.QueryEscape(name)
}

// ParcelStaffInvited — sent the moment an admin invites a courier
// company staffer by phone number (see
// httpapi.handleAdminUpsertParcelOrgStaff), instead of the out-of-band
// "here's your PIN" conversation that flow otherwise requires. Omits
// the link entirely rather than risk a second segment, same
// conditional-append reasoning withTrack already gives for a tracking
// link — the org name and their own name still tell them who this is
// from and what they were invited to be.
func ParcelStaffInvited(orgName, name, role, inviteURL string) string {
	msg := fmt.Sprintf("Esoqo: %s, %s invited you to sign in as %s.", trunc(name), trunc(orgName), roleLabel(role))
	if inviteURL == "" {
		return msg
	}
	withLink := msg + " " + inviteURL
	if len(withLink) > smsSegmentBudget {
		return msg
	}
	return withLink
}

// OtpCode — replaces the inline fmt.Sprintf that used to live in
// authsvc/otp.go verbatim; same wording, now composed in one place so
// it can be unit-tested and reused if another OTP-sending path ever
// needs it.
func OtpCode(code string) string {
	return fmt.Sprintf("%s is your Esoqo code. It expires in 10 minutes. Esoqo will never ask you for it.", code)
}

// KES formats an amount the way every message here quotes money:
// whole shillings with thousand separators, no decimals. Cents on a
// notification are noise, and ".00" is three wasted characters on every
// send — the same rule (and the same output) as smsKes in
// packages/domain/src/sms.ts, so a member cannot tell from the text
// whether their treasurer used the app or the web.
func KES(amount float64) string {
	whole := int64(math.Round(amount))
	neg := whole < 0
	if neg {
		whole = -whole
	}
	digits := strconv.FormatInt(whole, 10)
	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	if neg {
		return "KES -" + b.String()
	}
	return "KES " + b.String()
}

// ContributionConfirmed — replaces handlers_treasury.go's inline
// fmt.Sprintf; same content, now reusable/testable.
//
// newBalanceKES is nil when the balance could not be read. The clause
// is then dropped rather than filled with a zero or a "?": this message
// is about somebody's money, and a wrong balance is far worse than no
// balance — the rest of the sentence (who paid what, and the reference)
// is still true and still worth sending.
func ContributionConfirmed(amountKES float64, contributorName, orgName string, newBalanceKES *float64, reference string) string {
	if newBalanceKES == nil {
		return fmt.Sprintf("%s from %s credited to %s - ref %s",
			KES(amountKES), trunc(contributorName), trunc(orgName), reference)
	}
	return fmt.Sprintf("%s from %s credited to %s, new balance %s - ref %s",
		KES(amountKES), trunc(contributorName), trunc(orgName), KES(*newBalanceKES), reference)
}

// ContributionDeclared — the contributor's own immediate receipt for a
// DECLARED (not-yet-confirmed) contribution: manual/cash declarations
// sit until an officer confirms them, which could be a while, so this
// is what tells the member "we got it" before that happens. Separate
// from ContributionConfirmed, which broadcasts to every active member
// once money is actually credited — this one is contributor-only and
// fires at declare time instead.
func ContributionDeclared(amountKES float64, method, reference string) string {
	return fmt.Sprintf("Esoqo: your %s contribution (%s) was recorded - ref %s. You'll get a text once it's confirmed.",
		KES(amountKES), strings.ToLower(method), reference)
}

// VoucherLoaded — value has actually landed on a card.
//
// Quotes the new balance, not just what went on: a top-up someone makes
// to cover a fare they are about to pay is only useful information if it
// answers "can I now pay for it", and that is the balance. Names the
// card too, because a person can hold several (fare, rent, shopping)
// and "your voucher was loaded" is useless when three of them exist.
//
// method is the plain word for how it was paid ("M-Pesa", "points") —
// this package formats messages, it does not decide what a payment
// method is called.
func VoucherLoaded(amountKES float64, cardLabel, shortCode string, newBalanceKES float64, method string) string {
	return fmt.Sprintf("Esoqo: %s loaded to your %s card (%s) by %s. New balance %s.",
		KES(amountKES), trunc(cardLabel), shortCode, method, KES(newBalanceKES))
}

// VoucherGifted — someone else loaded a card and put it in your name.
//
// A separate message from VoucherLoaded because the recipient did not
// do anything and may not know Esoqo at all: it has to say who it came
// from and what the card is for, or it reads like a scam text about
// money appearing from nowhere. giftedByName is empty when the giver
// can't be resolved, which still leaves an honest message.
func VoucherGifted(amountKES float64, giftedByName, cardLabel, shortCode string) string {
	if giftedByName == "" {
		return fmt.Sprintf("Esoqo: you have been sent a %s voucher card, %s (%s). Sign in with this number to spend it.",
			KES(amountKES), trunc(cardLabel), shortCode)
	}
	return fmt.Sprintf("Esoqo: %s sent you a %s voucher card, %s (%s). Sign in with this number to spend it.",
		trunc(giftedByName), KES(amountKES), trunc(cardLabel), shortCode)
}

// ParcelCollectionScheduled — sent to the sender the moment an admin
// assigns a collector, so "someone is coming for it" lands before the
// courier ever shows up. Includes the collector's own phone number —
// previously this message named a collector with no way to actually
// reach them if the sender needed to.
func ParcelCollectionScheduled(code, collectorName, collectorMsisdn, scheduledWindow string) string {
	if collectorMsisdn == "" {
		return fmt.Sprintf(
			"Esoqo Logistics: %s will collect parcel %s at %s. Please have it ready.",
			trunc(collectorName), code, scheduledWindow)
	}
	return fmt.Sprintf(
		"Esoqo Logistics: %s (%s) will collect parcel %s at %s. Please have it ready.",
		trunc(collectorName), collectorMsisdn, code, scheduledWindow)
}

// ParcelPickupAssigned — sent to the COURIER (not the sender) the
// moment an admin schedules them for a collection, so a fleet driver
// who isn't watching the app's job list still finds out there's a
// parcel waiting on them. Gig couriers who claim jobs via the app
// don't need this — they already know, they just did it themselves.
func ParcelPickupAssigned(code, senderName, originLabel, scheduledWindow string) string {
	return fmt.Sprintf(
		"Esoqo Logistics: New pickup. Parcel %s from %s at %s. Collect by %s.",
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
		return withTrack(fmt.Sprintf(
			"Esoqo Logistics: Parcel %s picked up and on its way to %s.",
			code, trunc(destinationLabel)), code)
	}
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: Parcel %s picked up by %s and on its way to %s.",
		code, trunc(courierName), trunc(destinationLabel)), code)
}

// ParcelInTransitToYou — the receiver's side of the same pickup event.
// Carries deliveryCode because the receiver is the only one who can
// hand it to the courier at drop-off (DeliverParcel checks it) — the
// code was previously generated but never sent to anyone who'd
// actually need to produce it, which is why couriers kept hitting
// "wrong code" at the door: the receiver simply never had it.
//
// carrierName is empty for Esoqo-operated dispatch (the historical
// default); when a partner company is carrying it, naming them is the
// difference between "someone is sending you something" and a message
// that reads like every other delivery text a receiver already trusts.
func ParcelInTransitToYou(code, senderName, originLabel, deliveryCode, carrierName string) string {
	if carrierName == "" {
		return withTrack(fmt.Sprintf(
			"Esoqo Logistics: A parcel from %s (%s, from %s) is on its way to you. Give the courier code %s to receive it.",
			trunc(senderName), code, trunc(originLabel), deliveryCode), code)
	}
	// Drops the origin clause rather than the carrier name when both
	// would overflow the budget: a receiver who knows a courier company
	// is bringing it something and has the code to claim it can still
	// receive the parcel; "from Westlands" is the one clause that isn't
	// load-bearing for that.
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: A parcel from %s (%s) is on its way to you via %s. Code %s to receive it.",
		trunc(senderName), code, trunc(carrierName), deliveryCode), code)
}

// ParcelDeliveryAttemptFailed — the receiver's side of a failed
// doorstep attempt (see dbx.RecordDeliveryAttempt). This message is the
// entire reason FAILED_DELIVERY exists as a status: before it, a
// receiver who was out simply never heard anything, the courier kept
// carrying the parcel, and the first anyone knew of a problem was a
// complaint days later.
//
// attemptText is the domain's own phrasing of the reason code (see
// dbx.AttemptReasonText) — this package formats messages, it doesn't
// decide what a reason code means.
func ParcelDeliveryAttemptFailed(code, attemptText string, attempts int) string {
	if attempts >= 3 {
		// Third strike changes the ask: at this point the parcel is
		// about to be returned, so the message has to say so rather than
		// promise another attempt nobody has committed to.
		return withTrack(fmt.Sprintf(
			"Esoqo Logistics: We tried %d times to deliver %s - %s. Call us today or it goes back to the sender.",
			attempts, code, attemptText), code)
	}
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: We tried to deliver %s but %s. We'll try again - reply or call to arrange a time.",
		code, attemptText), code)
}

// ParcelAtAgent — the receiver's "it's waiting for you, here" message.
// Carries the shop's own location text and phone because a status of
// "at a pickup point" is useless without them, and carries the delivery
// code because that is still what the agent checks at the counter.
func ParcelAtAgent(code, agentName, locationHint, openingHours, deliveryCode string) string {
	msg := fmt.Sprintf(
		"Esoqo Logistics: Parcel %s is ready at %s (%s). Bring code %s.",
		code, trunc(agentName), trunc(locationHint), deliveryCode)
	// Hours are the first thing dropped when the budget is tight: a
	// receiver who knows where to go and what to bring can find out the
	// hours by walking there or calling, but a receiver who never got
	// the shop name has nothing at all.
	if openingHours != "" {
		withHours := fmt.Sprintf(
			"Esoqo Logistics: Parcel %s is ready at %s (%s), open %s. Bring code %s.",
			code, trunc(agentName), trunc(locationHint), trunc(openingHours), deliveryCode)
		if len(withHours) <= smsSegmentBudget {
			msg = withHours
		}
	}
	return withTrack(msg, code)
}

// ParcelCodBooked — the seller's confirmation that a cash-on-delivery
// booking is live.
//
// Deliberately NOT ParcelPaymentConfirmed: nothing has been paid. A
// seller told their money arrived when it hasn't is the single worst
// thing this vertical could get wrong, so the wording says what is
// actually true — the job is accepted, the cash comes at the door.
func ParcelCodBooked(code, receiverName, destinationLabel string) string {
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: Parcel %s to %s, %s is booked. Your buyer pays the rider on delivery.",
		code, trunc(receiverName), trunc(destinationLabel)), code)
}

// ParcelCodCollected — the seller's "your buyer paid" message.
//
// The short branch exists because a buyer turning up with less than
// they owe is common, and a seller who only finds out at settlement has
// already lost the chance to chase it while the buyer is still standing
// there. goodsKes is the seller's own share, never the gross — quoting
// a number that includes Esoqo's delivery fee would set up a dispute at
// every single settlement.
func ParcelCodCollected(code, goodsKes, shortfallKes string, short bool) string {
	if short {
		return withTrack(fmt.Sprintf(
			"Esoqo Logistics: Your buyer paid KES %s for parcel %s - KES %s short. We'll settle the %s to you.",
			goodsKes, code, shortfallKes, goodsKes), code)
	}
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: Your buyer paid in full for parcel %s. KES %s will be settled to you.",
		code, goodsKes), code)
}

// ParcelCodSettled — money actually sent. Names the parcel count so a
// seller can reconcile the payment against their own records without
// opening anything.
func ParcelCodSettled(paidKes string, parcels int, sellerName string) string {
	return fmt.Sprintf(
		"Esoqo Logistics: KES %s settled to you for %d cash-on-delivery %s. Thanks for using Esoqo.",
		paidKes, parcels, plural(parcels, "parcel", "parcels"))
}

// plural — the smallest possible helper, here because "1 parcels" in a
// message about somebody's money reads as carelessness with it.
func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// ParcelOnBus — the message this whole feature exists to send.
//
// A plate number turns "somewhere in transit" into something a person
// can picture and, uniquely here, go and stand next to. Named stop
// included when there is one, because "it comes off at Ngara" is the
// difference between meeting a bus and missing it.
func ParcelOnBus(code, plate, routeName, stageName string) string {
	if stageName != "" {
		return withTrack(fmt.Sprintf(
			"Esoqo Logistics: Parcel %s is on bus %s (%s), coming off at %s.",
			code, plate, trunc(routeName), trunc(stageName)), code)
	}
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: Parcel %s is on bus %s (%s), riding to the last stop.",
		code, plate, trunc(routeName)), code)
}

// CourierPaid — a courier's earnings actually sent.
//
// Quotes the reference when there is one, because a courier
// reconciling a transfer against their own count needs something to
// match it to, and "we paid you" with no handle is the message that
// generates the phone call this is meant to prevent.
func CourierPaid(amountKes string, reference *string) string {
	if reference != nil && *reference != "" {
		return fmt.Sprintf(
			"Esoqo Logistics: KES %s paid out for your deliveries. Ref %s. Thanks for riding with Esoqo.",
			amountKes, trunc(*reference))
	}
	return fmt.Sprintf(
		"Esoqo Logistics: KES %s paid out for your deliveries. Thanks for riding with Esoqo.",
		amountKes)
}

// ParcelReturnedToSender — closes the unhappy path for the sender. Says
// plainly that the journey is over and the parcel is coming back, which
// is the one thing a sender chasing a stalled delivery needs to hear.
func ParcelReturnedToSender(code, reason string) string {
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: Parcel %s could not be delivered (%s) and is on its way back to you.",
		code, trunc(reason)), code)
}

// ParcelDelivered — sender's side: confirms the drop-off happened.
// The tracking link matters more here than anywhere else: it is where
// the delivery photo and the name of whoever signed for it live (see
// Parcel.podPhotoUrl), which is exactly what a sender asks for when a
// "delivered" text doesn't match what they expected.
func ParcelDelivered(code, destinationLabel string, deliveredAt time.Time) string {
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: Parcel %s was delivered to %s at %s.",
		code, trunc(destinationLabel), deliveredAt.Format("15:04 on 2 Jan")), code)
}

// ParcelReceived — receiver's side of the same delivery event.
func ParcelReceived(code, senderName string, deliveredAt time.Time) string {
	return fmt.Sprintf(
		"Esoqo Logistics: You received parcel %s from %s at %s. Thanks for using Esoqo.",
		code, trunc(senderName), deliveredAt.Format("15:04 on 2 Jan"))
}

// ParcelCancelled — sent to the sender when an admin cancels a draft
// or not-yet-picked-up parcel. refundNote is empty for an unpaid
// draft; for a paid one it says exactly what happens to the money —
// never leaves the sender to wonder.
func ParcelCancelled(code, reason, refundNote string) string {
	msg := fmt.Sprintf("Esoqo Logistics: Parcel %s cancelled: %s.", code, reason)
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
		"Esoqo Logistics: KES %s refund for parcel %s has been processed to your M-Pesa.",
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
		return withTrack(fmt.Sprintf(
			"Esoqo Logistics: KES %s received for parcel %s to %s, %s.",
			priceKes, code, trunc(receiverName), trunc(destinationLabel)), code)
	}
	return withTrack(fmt.Sprintf(
		"Esoqo Logistics: KES %s received for parcel %s to %s, %s. M-Pesa ref %s.",
		priceKes, code, trunc(receiverName), trunc(destinationLabel), mpesaReceiptCode), code)
}

// ParcelReceiptConfirmed — sent to the sender once the receiver has
// OTP-confirmed they got the parcel and rated its condition (see
// dbx.ConfirmParcelReceipt) — closes the loop past ParcelDelivered,
// which is only ever the courier's own claim of drop-off.
func ParcelReceiptConfirmed(code, receiverName string, rating int) string {
	return fmt.Sprintf(
		"Esoqo Logistics: %s confirmed receiving parcel %s and rated its condition %d/5. Thanks for using Esoqo.",
		trunc(receiverName), code, rating)
}

// CourierOnboarded — the confirmation text a newly admin-added courier
// gets, the moment dbx.AdminAddCourier creates their account: their own
// Esoqo ID (see EnsureEsoqoPaymentId), proof their phone number is the
// one actually on file rather than a typo nobody would otherwise
// notice until a dispatch SMS went nowhere.
func CourierOnboarded(name, esoqoID string) string {
	return fmt.Sprintf(
		"Esoqo: Welcome %s! You've been added to the Esoqo courier team. Your Esoqo ID is %s. Sign in with this phone number to get started.",
		trunc(name), esoqoID)
}

// CourierTeamMemberAdded — sent to a manager or member the moment
// dbx.CreateCourierTeam/AddCourierTeamMember adds them to a named
// team: same "your Esoqo ID, and proof this number is right" role
// CourierOnboarded plays for an individual courier, plus which team
// and role they've actually been given, and sets the expectation that
// this number is the one that'll hear about every trip going forward
// (see CourierTripCompleted) — so a member isn't just added and left
// wondering what happens next.
func CourierTeamMemberAdded(name, teamName, role, esoqoID string) string {
	return fmt.Sprintf(
		"Esoqo: Welcome %s! You've been added to courier team \"%s\" as %s. Your Esoqo ID is %s. You'll get full trip and tracking alerts on this number. Sign in to get started.",
		trunc(name), trunc(teamName), roleLabel(role), esoqoID)
}

// CourierTeamMemberUpdated — sent whenever a staffer corrects a
// roster entry (see dbx.UpdateCourierTeamMember): a changed phone
// number in particular is exactly the kind of thing someone needs to
// actually see land on their phone to trust it's right, same
// reasoning CourierOnboarded's own comment already gives for a fresh
// add.
func CourierTeamMemberUpdated(name, teamName, role, esoqoID string) string {
	return fmt.Sprintf(
		"Esoqo: Your details on courier team \"%s\" were updated - name %s, role %s. Your Esoqo ID is %s. You'll get full trip and tracking alerts on this number.",
		trunc(teamName), trunc(name), roleLabel(role), esoqoID)
}

// CourierTripCompleted — sent to every member of a fleet's team (see
// dbx.GetCourierTripCompletionInfo) the moment a staffer marks that
// fleet's trip complete: the fleet's back and its packages have
// arrived, closing the loop the same way ParcelDelivered closes it for
// an individual parcel's own sender/receiver pair.
func CourierTripCompleted(fleetNumber string, parcelCount int) string {
	if parcelCount == 1 {
		return fmt.Sprintf("Esoqo Logistics: Fleet %s's trip is complete - its 1 parcel has arrived.", fleetNumber)
	}
	return fmt.Sprintf("Esoqo Logistics: Fleet %s's trip is complete - all %d parcels have arrived.", fleetNumber, parcelCount)
}

// CourierParcelsLeftBehind — the manager-only exception alert once a
// handler says "done checking" and something assigned to the trip never
// got a boarding scan (see dbx.CheckTripDispatched). Deliberately
// terse: this SMS's job is "go look", not "here is everything" — full
// per-parcel detail (destination, item, sender) lives on the dashboard
// the manager opens next, not squeezed into a 160-char segment. Only
// ever sent when the left-behind list is non-empty; a clean run gets
// CourierTripDeparted instead, never both.
func CourierParcelsLeftBehind(fleetNumber string, count int, sampleCodes []string) string {
	sample := strings.Join(sampleCodes, ", ")
	more := count - len(sampleCodes)
	if more > 0 {
		return fmt.Sprintf(
			"Esoqo Logistics: Fleet %s left %d %s unboarded - %s and %d more. Check the app before it departs.",
			fleetNumber, count, plural(count, "parcel", "parcels"), sample, more)
	}
	return fmt.Sprintf(
		"Esoqo Logistics: Fleet %s left %d %s unboarded - %s. Check the app before it departs.",
		fleetNumber, count, plural(count, "parcel", "parcels"), sample)
}

// CourierTripDeparted — the whole team's "we left clean" confirmation,
// sent instead of CourierParcelsLeftBehind when every assigned parcel
// got a boarding scan before dispatch was checked. Whole-team fan-out,
// same reach CourierTripCompleted already uses for a milestone everyone
// genuinely needs to see, as opposed to an exception that needs one
// accountable person.
func CourierTripDeparted(fleetNumber string, boardedCount int) string {
	return fmt.Sprintf(
		"Esoqo Logistics: Fleet %s has left with all %d %s boarded and accounted for.",
		fleetNumber, boardedCount, plural(boardedCount, "parcel", "parcels"))
}

// roleLabel lowercases a role string for mid-sentence use ("as
// manager", not "as MANAGER") without a lookup table that would need
// updating for every new role CourierTeamMember.role might ever hold —
// see that column's own comment on why it's a plain string.
func roleLabel(role string) string {
	return strings.ToLower(role)
}
