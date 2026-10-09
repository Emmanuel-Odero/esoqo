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

	"golang.org/x/text/unicode/norm"
)

// smsFieldMaxLen — a free-text field embedded in a message is cut to
// this length (plus an ASCII "..." marker, itself part of the budget)
// before formatting. Chosen so even a message combining two such
// fields (e.g. ParcelPaymentConfirmed's receiver name + destination)
// still leaves room under the single-segment (160 GSM-7 char) budget
// the doc comment above sets — see TestNoMessageForcesUCS2.
const smsFieldMaxLen = 20

// gsmTransliterations — the typographic characters a tenant's org name,
// a destination label, or anyone's own name actually arrives with in
// practice (an em dash, a curly quote pasted from a phone keyboard)
// mapped to their plain-ASCII twin. Adapted from
// packages/domain/src/sms.ts's TRANSLITERATIONS table and carrying the
// same symbols. One deliberate difference from the TS sibling: that
// gsmSafe keeps GSM-7's own non-ASCII letters (é, ü, €) as-is, while
// this one emits pure ASCII — an accented Latin letter is decomposed to
// its base letter in GsmSafe below, and € is dropped like any other
// non-ASCII rune, so the result stays byte-clean for trunc()'s
// byte-oriented budget. Both must still fold every character outside
// GSM-7: a single one left in forces the whole message into UCS-2 (160
// chars/segment drops to 70), and several real-world SMS gateways (this
// file's own callers dial Celcom Africa) mangle a raw non-GSM-7 byte
// into a visible "%E2%80%94"-style escape on the recipient's phone
// instead of transcoding it cleanly.
var gsmTransliterations = map[rune]string{
	// Dashes: hyphen, non-breaking hyphen, figure/en/em dash, horizontal
	// bar, minus sign.
	'\u2010': "-", '\u2011': "-", '\u2012': "-", '\u2013': "-", '\u2014': "-",
	'\u2015': "-", '\u2212': "-",
	// Single quotes/apostrophes, including the prime often pasted for one.
	'\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'",
	// Double quotes, including guillemets and the double prime.
	'\u201c': "\"", '\u201d': "\"", '\u201e': "\"", '\u201f': "\"",
	'\u2033': "\"", '\u00ab': "\"", '\u00bb': "\"",
	// Spaces that are not U+0020: NBSP, en/em/thin/hair quads, narrow NBSP.
	'\u00a0': " ", '\u2002': " ", '\u2003': " ", '\u2007': " ", '\u2009': " ",
	'\u200a': " ", '\u202f': " ",
	// Zero-width characters and the BOM: no width, no GSM-7 twin, no loss.
	'\u200b': "", '\u200c': "", '\u200d': "", '\ufeff': "",
	// Bullets.
	'\u2022': "-", '\u00b7': "-", '\u2043': "-",
	// Ellipsis.
	'\u2026': "...",
	// Symbols with a conventional ASCII spelling.
	'\u2122': "(TM)", '\u00ae': "(R)", '\u00a9': "(C)",
	'\u00b0': " deg", '\u00d7': "x", '\u00f7': "/", '\u2044': "/",
	'\u2190': "<-", '\u2192': "->", '\u21d2': "=>",
}

// gsm7Byte reports whether a rune can ride a GSM-7 message as-is while
// keeping this package's output pure ASCII. All printable ASCII is
// GSM-7 (a handful — ^ { } [ ~ ] | \ — are the extension table's
// two-septet forms, which is fine), except the backtick, which GSM
// 03.38 has no representation for at all and which the old `r < 0x80`
// test let straight through to force UCS-2. \n and \r are GSM-7; other
// control characters (a lone tab, say) are not. Every non-ASCII rune is
// transliterated, decomposed, or dropped by GsmSafe — never passed
// through — so a caller can trust the result encodes as GSM-7.
func gsm7Byte(r rune) bool {
	if r == '\n' || r == '\r' {
		return true
	}
	return r >= 0x20 && r < 0x7f && r != '`'
}

// GsmSafe folds text into the GSM-7 alphabet this package sends so it
// can never be the reason a message doubles in billed segments or
// arrives on the recipient's phone as a literal percent-escape.
// Characters with a known ASCII twin are substituted (see
// gsmTransliterations); an accented Latin letter is decomposed and its
// base letter kept (Müller -> Muller, not a dropped "Mller"); anything
// left over — an emoji, a CJK glyph — is dropped rather than risk the
// gateway mangling it. A missing emoji costs nothing, a message that
// silently splits into two or renders as "%E2%80%94" costs real trust.
func GsmSafe(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case gsm7Byte(r):
			b.WriteRune(r)
		default:
			if sub, ok := gsmTransliterations[r]; ok {
				b.WriteString(sub)
				continue
			}
			// Decompose accented Latin to its base letter: NFD splits
			// "é" into "e" + a combining mark, and only the base survives
			// gsm7Byte, so a pasted accent no longer costs the letter.
			for _, d := range norm.NFD.String(string(r)) {
				if gsm7Byte(d) {
					b.WriteRune(d)
				}
			}
		}
	}
	return collapseSpaces(b.String())
}

// collapseSpaces folds a run of spaces — what several NBSPs/typographic
// spaces in a row, now all mapped to U+0020, can leave behind — to one,
// the same trailing normalisation sms.ts's gsmSafe applies. A doubled
// space costs a septet on every send and reads as noise on the phone.
func collapseSpaces(s string) string {
	if !strings.Contains(s, "  ") {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range s {
		if r == ' ' {
			if prevSpace {
				continue
			}
			prevSpace = true
		} else {
			prevSpace = false
		}
		b.WriteRune(r)
	}
	return b.String()
}

// trunc — defensive truncation for any free-text value (a label, a
// name) interpolated into an SMS body. Most values are well under this
// length; this only bites the rare pathological entry, so a single
// long address never silently pushes a message into a second segment.
// Folded through GsmSafe first so a pasted em dash or curly quote in a
// tenant's own name can't force the whole message into UCS-2 (or get
// mangled by the gateway) before it's even truncated. The marker is
// plain ASCII "..." (not "…") for the same reason.
func trunc(s string) string {
	s = GsmSafe(s)
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

// ReceiptURL — TrackingURL's payment-facing sibling, same base URL and
// same "" when unconfigured. A separate path (/r/, not /t/) because the
// two pages answer to different handlers and different data (see
// dbx.GetParcelReceipt): a receipt only exists once the parcel's been
// paid for, tracking doesn't require that at all.
func ReceiptURL(code string) string {
	if trackingBaseURL == "" {
		return ""
	}
	return trackingBaseURL + "/r/" + code
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

// withGenericTrack is withTrack's counterpart for a message covering
// many parcels at once (a trip dispatch summary, not one parcel's own
// event) — points at the staff lookup page (search-by-code) rather
// than a single /t/<code>, since there is no one code this message is
// about. Same degrade-gracefully rule: omitted rather than truncating
// the message into a second billed segment.
func withGenericTrack(msg string) string {
	if trackingBaseURL == "" {
		return msg
	}
	withLink := msg + " Track: " + trackingBaseURL + "/parcels/track"
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
	return trackingBaseURL + "/parcels/track?orgSlug=" + url.QueryEscape(orgSlug) + "&name=" + url.QueryEscape(name)
}

// ParcelStaffInvited — sent the moment an admin invites a courier
// company staffer by phone number (see
// httpapi.handleAdminUpsertParcelOrgStaff), instead of the out-of-band
// "here's your PIN" conversation that flow otherwise requires.
//
// tempPin is the invitee's first PIN — either the one the admin typed
// or a freshly minted temporary one — and rides in the text so they can
// sign in immediately and then reset it. It outranks the link in the
// single-segment budget: the PIN is the credential, the link is a
// convenience, so a long org name drops the link, never the PIN. The
// org name and their own name still tell them who this is from and what
// they were invited to be.
func ParcelStaffInvited(orgName, name, role, inviteURL, tempPin string) string {
	// The role is free text (up to 40 chars) — truncated like every
	// other embedded field so one long job title can't push this into a
	// second segment on its own.
	msg := fmt.Sprintf("Esoqo: %s, %s invited you to sign in as %s.", trunc(name), trunc(orgName), trunc(roleLabel(role)))
	if tempPin != "" {
		msg += fmt.Sprintf(" Temp PIN: %s. Change it after you sign in.", tempPin)
	}
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
			"ESOQO PARCEL: %s will collect parcel %s at %s. Please have it ready.",
			trunc(collectorName), code, scheduledWindow)
	}
	return fmt.Sprintf(
		"ESOQO PARCEL: %s (%s) will collect parcel %s at %s. Please have it ready.",
		trunc(collectorName), collectorMsisdn, code, scheduledWindow)
}

// ParcelPickupAssigned — sent to the COURIER (not the sender) the
// moment an admin schedules them for a collection, so a fleet driver
// who isn't watching the app's job list still finds out there's a
// parcel waiting on them. Gig couriers who claim jobs via the app
// don't need this — they already know, they just did it themselves.
func ParcelPickupAssigned(code, senderName, originLabel, scheduledWindow string) string {
	return fmt.Sprintf(
		"ESOQO PARCEL: New pickup. Parcel %s from %s at %s. Collect by %s.",
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
			"ESOQO PARCEL: Parcel %s picked up and on its way to %s.",
			code, trunc(destinationLabel)), code)
	}
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: Parcel %s picked up by %s and on its way to %s.",
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
			"ESOQO PARCEL: A parcel from %s (%s, from %s) is on its way to you. Give the courier code %s to receive it.",
			trunc(senderName), code, trunc(originLabel), deliveryCode), code)
	}
	// Drops the origin clause rather than the carrier name when both
	// would overflow the budget: a receiver who knows a courier company
	// is bringing it something and has the code to claim it can still
	// receive the parcel; "from Westlands" is the one clause that isn't
	// load-bearing for that.
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: A parcel from %s (%s) is on its way to you via %s. Code %s to receive it.",
		trunc(senderName), code, trunc(carrierName), deliveryCode), code)
}

// courierCompanyLabel — "Esoqo" for Esoqo-operated dispatch
// (CarrierOrgName nil), the partner's own name otherwise. Every
// intake-confirmation message names who's actually holding the
// parcel, same "carrierName empty means us" convention
// ParcelInTransitToYou/ParcelPickedUp already follow.
//
// trunc'd like every other caller-supplied field in this file. A
// company name is tenant-controlled free text, so an unbounded one was
// the single field that could push an otherwise-fine message past the
// 160-char segment budget — silently doubling the per-message cost of
// every notification that named that tenant.
func courierCompanyLabel(carrierOrgName *string) string {
	if carrierOrgName == nil || *carrierOrgName == "" {
		return "Esoqo"
	}
	return trunc(*carrierOrgName)
}

// ParcelIntakeConfirmed — the sender's text the moment staff confirms
// physical custody (see dbx.ConfirmParcelIntake), not at booking:
// a self-service submission or a clerk typing a walk-in's details in
// both only ever describe a parcel, neither proves anyone has it in
// hand yet. Names the receiver (and their phone) so the sender can see
// at a glance who this is bound for, matching what BookParcel's own
// response already showed them.
// Promises only what a code path actually delivers: the sender hears
// again at ParcelDelivered, and nowhere in between. It used to say
// "we'll text you when we dispatch it" as well, which was never true —
// the dispatch scan texts the carrying company's own desk
// (ParcelOrgDispatchSummary), never the sender.
func ParcelIntakeConfirmed(code string, carrierOrgName *string, officeLabel, receiverName, receiverMsisdn string) string {
	full := fmt.Sprintf(
		"ESOQO PARCEL: Your parcel %s was accepted by %s at %s. Track it here.",
		code, courierCompanyLabel(carrierOrgName), trunc(officeLabel))
	if len(full) <= smsSegmentBudget {
		return withTrack(full, code)
	}
	// Same clause-dropping degradation ParcelInTransitToYou documents,
	// applied to the one clause that isn't load-bearing here: the sender
	// was physically standing in that office when they handed the box
	// over, so naming it back to them is the least valuable thing in the
	// sentence. Who has it and who it's going to both stay.
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: Your parcel %s was accepted by %s at %s. Track it here.",
		code, courierCompanyLabel(carrierOrgName), trunc(officeLabel)), code)
}

// ParcelIntakeConfirmedToReceiver — the receiver's side of the same
// confirmation, and the one message that puts deliveryCode in the hands
// of the only person who can produce it at the door.
//
// It deliberately carries the code even though the parcel is only just
// in hand, because this is now the sole SMS the receiver gets before a
// courier knocks: the intake scan replaced ParcelInTransitToYou as the
// first-custody trigger, and that older message was where the code used
// to ride. Dropping it here left DeliverParcel's codeMatches branch
// unreachable on the ordinary doorstep path — the receiver had no code
// to give, so every delivery fell through to an OTP or a staff
// override. Same reasoning ParcelInTransitToYou's own comment gives for
// carrying it in the first place.
func ParcelIntakeConfirmedToReceiver(code, senderName string, carrierOrgName *string, deliveryCode string) string {
	// No code on file is a real state (a pre-printed label claimed
	// before a deliveryCode was minted) — say less rather than print a
	// blank where a code should be.
	if deliveryCode == "" {
		return withTrack(fmt.Sprintf(
			"ESOQO PARCEL: Parcel %s from %s via %s is being prepared for delivery. Track it here.",
			code, trunc(senderName), courierCompanyLabel(carrierOrgName)), code)
	}
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: Parcel %s from %s via %s is being prepared for delivery. Delivery code: %s. Track it here.",
		code, trunc(senderName), courierCompanyLabel(carrierOrgName), deliveryCode), code)
}

// withTrackAndReceipt tries to append both the tracking and receipt
// links, falls back to withTrack's own single-link behaviour when both
// don't fit in one SMS segment, and degrades to the bare message when
// even that doesn't — the receipt link is the one worth dropping first,
// since the tracking page carries everything the receipt does except
// the payment facts.
func withTrackAndReceipt(msg, code string) string {
	trackURL := TrackingURL(code)
	receiptURL := ReceiptURL(code)
	if trackURL != "" && receiptURL != "" {
		withBoth := msg + " Track: " + trackURL + " Receipt: " + receiptURL
		if len(withBoth) <= smsSegmentBudget {
			return withBoth
		}
	}
	return withTrack(msg, code)
}

// ParcelCounterPaymentConfirmed — the sender's "paid" text once a
// counter settlement actually clears (cash in hand, the M-Pesa webhook,
// or a clerk's manually entered M-Pesa code — see
// dbx.SettleCounterParcel / ConfirmCounterSettlementByCheckoutID /
// ConfirmCounterSettlementByManualCode, all three of which trigger
// this), not at intake: a sender already heard "accepted" via
// ParcelIntakeConfirmed when the clerk took the box into custody at the
// desk. This is the separate "and here's what you paid, and where it's
// headed" message the counter flow calls for, tied to money clearing.
func ParcelCounterPaymentConfirmed(code string, carrierOrgName *string, officeLabel, destinationLabel string) string {
	company := courierCompanyLabel(carrierOrgName)
	// A counter ticket's own originLabel is the company's name itself —
	// there's no separate station entity at that layer yet (see
	// dbx.BookParcelFromCounterTicket) — so naming it again here would
	// read as "accepted at Acme Acme". Said once is enough; a company
	// with real sub-stations wired up still gets both names distinctly.
	at := company
	if !strings.EqualFold(strings.TrimSpace(officeLabel), strings.TrimSpace(company)) {
		at = company + " " + trunc(officeLabel)
	}
	base := fmt.Sprintf(
		"Parcel Esoqo: Your parcel has been accepted at %s and is scheduled for dispatch to %s. Your parcel code and tracking number is %s.",
		at, trunc(destinationLabel), code)
	return withTrackAndReceipt(base, code)
}

// ParcelCounterPaymentConfirmedToReceiver — the receiver's side of the
// same payment confirmation, naming who sent it and where it's headed
// so the one SMS stands on its own.
func ParcelCounterPaymentConfirmedToReceiver(code, senderName string, carrierOrgName *string, destinationLabel string) string {
	base := fmt.Sprintf(
		"Parcel Esoqo: %s has sent you a parcel %s via %s, scheduled to arrive %s.",
		trunc(senderName), code, courierCompanyLabel(carrierOrgName), trunc(destinationLabel))
	return withTrackAndReceipt(base, code)
}

// ParcelOrgDispatchSummary — sent to a courier company's dispatch desk
// (see dbx.ListOrgDispatchDeskMsisdns) when one of their parcels leaves
// the station: the first genuine handoff scan out of BOOKED (see
// handleScanParcelHandoff's own wasFirstPickup gate), same trigger the
// sender/receiver confirmation pair fires on.
//
// Not per-parcel noise: the caller only sends this on a cadence (see
// httpapi's dispatchSummaryEvery), so dispatchedToday reads as "here's
// where we are" and the desk gets a handful of messages a day rather
// than one per box. Riders are not on the list at all — a departure
// summary is a dispatcher's tool.
//
// Esoqo-operated dispatch has no equivalent — there's no "team" to
// summarize a departure to outside a courier company's own roster,
// which is why this is never called for a nil ParcelOrgID (see
// ParcelNotifyInfo.ParcelOrgID's own comment).
func ParcelOrgDispatchSummary(orgName, code string, dispatchedToday int) string {
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: %s dispatched from %s - %d %s sent today.",
		code, trunc(orgName), dispatchedToday, plural(dispatchedToday, "parcel", "parcels")), code)
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
			"ESOQO PARCEL: We tried %d times to deliver %s - %s. Call us today or it goes back to the sender.",
			attempts, code, attemptText), code)
	}
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: We tried to deliver %s but %s. We'll try again - reply or call to arrange a time.",
		code, attemptText), code)
}

// ParcelAtAgent — the receiver's "it's waiting for you, here" message.
// Carries the shop's own location text and phone because a status of
// "at a pickup point" is useless without them, and carries the delivery
// code because that is still what the agent checks at the counter.
func ParcelAtAgent(code, agentName, locationHint, openingHours, deliveryCode string, carrierOrgName *string) string {
	msg := fmt.Sprintf(
		"ESOQO PARCEL: Parcel %s via %s is ready at %s (%s). Bring code %s.",
		code, courierCompanyLabel(carrierOrgName), trunc(agentName), trunc(locationHint), deliveryCode)
	// Hours are the first thing dropped when the budget is tight: a
	// receiver who knows where to go and what to bring can find out the
	// hours by walking there or calling, but a receiver who never got
	// the shop name has nothing at all.
	if openingHours != "" {
		withHours := fmt.Sprintf(
			"ESOQO PARCEL: Parcel %s via %s is ready at %s (%s), open %s. Bring code %s.",
			code, courierCompanyLabel(carrierOrgName), trunc(agentName), trunc(locationHint), trunc(openingHours), deliveryCode)
		if len(withHours) <= smsSegmentBudget {
			msg = withHours
		}
	}
	return withTrack(msg, code)
}

// ── Receiver self-authentication ─────────────────────────────────────
//
// The four messages around a receiver failing to prove, from their own
// phone, that they are the receiver (see dbx.VerifyReceiverCode).
//
// None of them carries a tracking link for the two locked states. The
// link is useless to the person who is stuck — they have just come from
// that page — and these two go to a dispatch desk and a sender, neither
// of whom needs to be sent back to the guest tracking view to act.

// ParcelReceiverAuthLocked goes to the carrying company's dispatch
// desk, which is the only party that can do anything about it. Says
// what happened and what the desk's options are, because a message
// that only reports a problem generates a phone call to Esoqo.
func ParcelReceiverAuthLocked(code string) string {
	return fmt.Sprintf(
		"ESOQO PARCEL: Parcel %s is locked - the receiver failed to verify 3 times. Allow 2 more tries or issue a new code in your console.",
		code)
}

// ParcelReceiverAuthHardLocked goes to the SENDER, not the receiver.
//
// Deliberate, and the sharpest choice in this group: at a hard lock we
// no longer believe whoever has been typing is the receiver. Texting
// the receiver's number would either tell an impostor how far they got,
// or tell a genuine receiver something they can do nothing about. The
// sender holds the original code, knows who they sent it to, and is the
// one person able to say "that is not them" or "ring them, it's 4821".
func ParcelReceiverAuthHardLocked(code, receiverName string) string {
	return fmt.Sprintf(
		"ESOQO PARCEL: %s could not verify the delivery code for parcel %s. Please contact them. A new code must be issued by the courier.",
		trunc(receiverName), code)
}

// ParcelDeliveryCodeReissued goes to the receiver with the replacement.
// Says the old one is dead, because a receiver holding two codes will
// otherwise try the first one they find and burn an attempt on it.
func ParcelDeliveryCodeReissued(code, newDeliveryCode string) string {
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: New delivery code for parcel %s is %s. Your previous code no longer works.",
		code, newDeliveryCode), code)
}

// ParcelDeliveryCodeReissuedToSender gives the sender the same new code.
//
// Both parties, because relaying the code is what the sender has always
// done here (ListMyParcels returns deliveryCode to the sender's own
// list for exactly this reason) and because a reissue usually happens
// precisely when the receiver's SMS is what failed in the first place.
func ParcelDeliveryCodeReissuedToSender(code, newDeliveryCode, receiverName string) string {
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: Parcel %s has a new delivery code: %s. Pass it to %s - their old code no longer works.",
		code, newDeliveryCode, trunc(receiverName)), code)
}

// ParcelPickupReminder is sent only from the collection queue. The count is
// included so repeated reminders remain auditable to the receiver and staff.
func ParcelPickupReminder(code string, reminderCount int) string {
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: Parcel %s is waiting for collection. Reminder %d. Bring your delivery code.",
		code, reminderCount), code)
}

func ParcelRejectedAtDropoff(code, reason string) string {
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: We could not accept parcel %s at drop-off. Reason: %s. Please collect it from the counter.",
		code, trunc(reason)), code)
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
		"ESOQO PARCEL: Parcel %s to %s, %s is booked. Your buyer pays the rider on delivery.",
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
			"ESOQO PARCEL: Your buyer paid KES %s for parcel %s - KES %s short. We'll settle the %s to you.",
			goodsKes, code, shortfallKes, goodsKes), code)
	}
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: Your buyer paid in full for parcel %s. KES %s will be settled to you.",
		code, goodsKes), code)
}

// ParcelCodSettled — money actually sent. Names the parcel count so a
// seller can reconcile the payment against their own records without
// opening anything.
func ParcelCodSettled(paidKes string, parcels int, sellerName string) string {
	return fmt.Sprintf(
		"ESOQO PARCEL: KES %s settled to you for %d cash-on-delivery %s. Thanks for using Esoqo.",
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
			"ESOQO PARCEL: Parcel %s is on bus %s (%s), coming off at %s.",
			code, plate, trunc(routeName), trunc(stageName)), code)
	}
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: Parcel %s is on bus %s (%s), riding to the last stop.",
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
		"ESOQO PARCEL: Parcel %s could not be delivered (%s) and is on its way back to you.",
		code, trunc(reason)), code)
}

// ParcelDelivered — sender's side: confirms the drop-off happened.
// The tracking link matters more here than anywhere else: it is where
// the delivery photo and the name of whoever signed for it live (see
// Parcel.podPhotoUrl), which is exactly what a sender asks for when a
// "delivered" text doesn't match what they expected.
func ParcelDelivered(code, destinationLabel string, deliveredAt time.Time) string {
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: Parcel %s was delivered to %s at %s.",
		code, trunc(destinationLabel), deliveredAt.Format("15:04 on 2 Jan")), code)
}

// ParcelReceived — receiver's side of the same delivery event: the
// final confirmation that this parcel reached them, specifically.
// Carries the tracking link like every other courier message here (see
// withTrack) — previously written but never called from a handler, so
// a receiver's own successful collection went unacknowledged even
// though the sender got ParcelDelivered for the identical event.
func ParcelReceived(code, senderName string, deliveredAt time.Time) string {
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: You received parcel %s from %s at %s. Thanks for using Esoqo.",
		code, trunc(senderName), deliveredAt.Format("15:04 on 2 Jan")), code)
}

// ParcelCancelled — sent to the sender when an admin cancels a draft
// or not-yet-picked-up parcel. refundNote is empty for an unpaid
// draft; for a paid one it says exactly what happens to the money —
// never leaves the sender to wonder.
func ParcelCancelled(code, reason, refundNote string) string {
	msg := fmt.Sprintf("ESOQO PARCEL: Parcel %s cancelled: %s.", code, reason)
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
		"ESOQO PARCEL: KES %s refund for parcel %s has been processed to your M-Pesa.",
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
			"ESOQO PARCEL: KES %s received for parcel %s to %s, %s.",
			priceKes, code, trunc(receiverName), trunc(destinationLabel)), code)
	}
	return withTrack(fmt.Sprintf(
		"ESOQO PARCEL: KES %s received for parcel %s to %s, %s. M-Pesa ref %s.",
		priceKes, code, trunc(receiverName), trunc(destinationLabel), mpesaReceiptCode), code)
}

// ParcelReceiptConfirmed — sent to the sender once the receiver has
// OTP-confirmed they got the parcel and rated its condition (see
// dbx.ConfirmParcelReceipt) — closes the loop past ParcelDelivered,
// which is only ever the courier's own claim of drop-off.
func ParcelReceiptConfirmed(code, receiverName string, rating int) string {
	return fmt.Sprintf(
		"ESOQO PARCEL: %s confirmed receiving parcel %s and rated its condition %d/5. Thanks for using Esoqo.",
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
	return withGenericTrack(fmt.Sprintf(
		"Esoqo Logistics: Fleet %s has left with all %d %s boarded and accounted for.",
		fleetNumber, boardedCount, plural(boardedCount, "parcel", "parcels")))
}

// roleLabel lowercases a role string for mid-sentence use ("as
// manager", not "as MANAGER") without a lookup table that would need
// updating for every new role CourierTeamMember.role might ever hold —
// see that column's own comment on why it's a plain string.
func roleLabel(role string) string {
	return strings.ToLower(role)
}
