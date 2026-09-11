// Package authsvc ports packages/auth (OTP, PIN, session) and
// packages/db/src/capabilities.ts (Ctx/requireCapability/ROLE_PRESETS) to
// Go, 1:1, so authorization behaviour stays identical to the TypeScript
// call path during the transition. See docs/adr/0005-mobile-api-in-go.md.
package authsvc

import "strings"

// ActorType mirrors packages/db/src/capabilities.ts's ActorType.
type ActorType string

const (
	ActorSubject ActorType = "SUBJECT"
	ActorStaff   ActorType = "STAFF"
	ActorAgent   ActorType = "AGENT"
	ActorSystem  ActorType = "SYSTEM"
	ActorIssuer  ActorType = "ISSUER"
)

// Ctx mirrors packages/db/src/capabilities.ts's Ctx. Verified is the Go
// stand-in for the TS `readonly __verified: true` marker — only
// CtxFromToken, SystemCtx and AnonCtx may set it true.
type Ctx struct {
	ActorType    ActorType
	ActorID      string // Party id for a subject, StaffUser id for staff
	Capabilities []string
	PartyID      string
	OrgID        string
	StoreID      string
	TicketOrgID  string
	IP           string
	Verified     bool
}

// AuthorisationError mirrors the TS AuthorisationError (HTTP 403).
type AuthorisationError struct {
	Capability string
	ActorType  ActorType
	ActorID    string
}

func (e *AuthorisationError) Error() string { return "Denied: " + e.Capability }

// SystemCtx — for migrations, workers and seeds only. Never from a request.
func SystemCtx(reason string) Ctx {
	return Ctx{ActorType: ActorSystem, ActorID: "system:" + reason, Capabilities: []string{"*"}, Verified: true}
}

// AnonCtx — has nothing. Public reads only.
func AnonCtx(ip string) Ctx {
	return Ctx{ActorType: ActorSystem, Capabilities: []string{}, IP: ip, Verified: true}
}

func matches(held, wanted string, ctx Ctx, opts map[string]string) bool {
	if held == "*" || held == wanted {
		return true
	}

	hRes, hRest, _ := strings.Cut(held, ".")
	wRes, wRest, _ := strings.Cut(wanted, ".")
	if hRes != wRes {
		return false
	}

	hAct, hQual, hHasQual := strings.Cut(hRest, ":")
	wAct, wQual, _ := strings.Cut(wRest, ":")
	if hAct != wAct && hAct != "*" {
		return false
	}

	// No qualifier held → unrestricted for that action.
	if !hHasQual || hQual == "" {
		return true
	}

	if hQual == "own" {
		target := opts["partyId"]
		if target == "" {
			target = opts["subjectId"]
		}
		return target != "" && target == ctx.PartyID
	}

	if k, v, ok := strings.Cut(hQual, "="); ok {
		return opts[k] == v
	}

	return hQual == wQual
}

// RequireCapability — deny by default. Every handler calls this first; if
// it returns an error, no query runs.
func RequireCapability(ctx Ctx, capability string, opts map[string]string) error {
	if !ctx.Verified {
		return &AuthorisationError{Capability: capability, ActorType: ActorSystem}
	}
	for _, held := range ctx.Capabilities {
		if matches(held, capability, ctx, opts) {
			return nil
		}
	}
	return &AuthorisationError{Capability: capability, ActorType: ctx.ActorType, ActorID: ctx.ActorID}
}

// Can — boolean wrapper around RequireCapability.
func Can(ctx Ctx, capability string, opts map[string]string) bool {
	return RequireCapability(ctx, capability, opts) == nil
}

// RoleName mirrors packages/db/src/capabilities.ts's RoleName.
type RoleName string

const RoleSubject RoleName = "SUBJECT"

// TicketingCapabilities — ports the Ticketing group of
// packages/db/src/capabilities.ts's CAPABILITY_CATALOGUE. Same
// scoping contract as the fleet grants below.
const (
	CapTicketOrgRead     = "ticketorg.read"
	CapTicketOrgWrite    = "ticketorg.write"
	CapTicketOrgModerate = "ticketorg.moderate"
	CapTicketOrgStaff    = "ticketorgstaff.write"
	CapVenueWrite        = "venue.write"
	CapRouteWrite        = "route.write"
	CapListingWrite      = "listing.write"
	CapListingPublish    = "listing.publish"
	CapTicketClassWrite  = "ticketclass.write"
	CapScheduleWrite     = "schedule.write"
	CapBookingRead       = "booking.read"
	CapBookingCreate     = "booking.create"
	CapBookingCancel     = "booking.cancel"
	CapBookingRefund     = "booking.refund"
	CapTicketCheckin     = "ticket.checkin"
)

// FleetCapabilities — short-routes / town-service grants. Org-scoped
// via Ctx.TicketOrgID for AGENT sessions (crew, managers); owners hold
// the same names with the :own qualifier (enterprise party match, same
// as ticketorg.write:own). Kept as plain strings so the admin UI and
// mobile gating (EsokoProfile.has) render from one catalogue.
const (
	CapFleetRead         = "fleet.read"
	CapFleetWrite        = "fleet.write"
	CapCrewRead          = "crew.read"
	CapCrewWrite         = "crew.write"
	CapTripRead          = "trip.read"
	CapTripWrite         = "trip.write"
	CapVehicleTrack      = "vehicle.track"
	CapFarePay           = "fare.pay"
	CapFareRead          = "fare.read"
	CapFareVerify        = "fare.verify"
	CapCollectionDeclare = "collection.declare"
	CapCollectionRead    = "collection.read"
	// CapTripCloseOwn — narrower than CapTripWrite: a CREW session may
	// close a trip only when TicketOrgStaff.crewMemberId (resolved from
	// ctx.ActorID) matches that trip's own driverId/conductorId — see
	// dbx.CloseTrip. Exact-match capability like CapFareVerify/
	// CapCollectionDeclare above, not the generic SUBJECT ':own'
	// qualifier (that mechanism is PartyID-based and AGENT sessions
	// bypass it entirely per AssertOwnsOrg) — the ':own' in the name
	// documents intent, matches() short-circuits on it via plain string
	// equality either way.
	CapTripCloseOwn = "trip.close:own"

	CapVoucherCreate = "voucher.create"
	CapVoucherRead   = "voucher.read"
	CapVoucherSpend  = "voucher.spend"
	CapVoucherFreeze = "voucher.freeze"
	CapLoyaltyRead   = "loyalty.read"
)

// TicketingStaffCapabilities ports TICKETING_STAFF_CAPABILITIES from
// packages/db/src/capabilities.ts. An AGENT session's list IS the grant —
// scoping is the ctx.TicketOrgID match in dbx.AssertOwnsOrg, not a
// qualifier. CREW (driver/conductor PIN login) is the new least-privilege
// bundle: declare today's cash + ping position + see own trip's fares.
var TicketingStaffCapabilities = map[string][]string{
	"SCANNER": {"ticket.checkin", "ticketorg.read", CapFareVerify, CapFareRead},
	"MANAGER": {"ticket.checkin", "listing.write", "listing.publish", "ticketclass.write",
		"schedule.write", "venue.write", "route.write",
		"booking.read", "booking.cancel", "booking.refund", "ticketorg.read",
		CapFleetRead, CapCrewRead, CapTripRead, CapFareRead, CapFareVerify, CapCollectionRead, CapVehicleTrack,
		CapVoucherRead, CapVoucherFreeze, CapLoyaltyRead},
	"ADMIN": {"ticket.checkin", "listing.write", "listing.publish", "ticketclass.write",
		"schedule.write", "venue.write", "route.write",
		"booking.read", "booking.cancel", "booking.refund",
		"ticketorg.read", "ticketorg.write", "ticketorgstaff.write",
		CapFleetRead, CapFleetWrite, CapCrewRead, CapCrewWrite,
		CapTripRead, CapTripWrite, CapFareRead, CapFarePay,
		CapCollectionRead, CapCollectionDeclare, CapVehicleTrack},
	// CapCollectionRead added alongside CapTripCloseOwn: a crew member
	// declaring cash has to be able to see the running tally they're
	// declaring against (fares confirmed vs cash counted) — the whole
	// point of collection.declare existing on this bundle. Same
	// org-wide scope collection.declare already has for CREW (not
	// restricted to the caller's own trip; ownership is the trip match
	// at declare time, not the read), so this isn't a new precedent.
	"CREW": {CapCollectionDeclare, CapCollectionRead, CapVehicleTrack, CapFareRead, CapFareVerify, CapTripCloseOwn, "ticketorg.read"},
}

// RolePresets — convenience bundles only; the model is the capability list
// on the account. SUBJECT is re-derived per request in
// SessionService.CtxFromToken; AGENT lists are frozen at staff sign-in.
var RolePresets = map[RoleName][]string{
	RoleSubject: {
		"entity.read:own", "entity.write:own", "consent.read:own", "consent.write:own",
		"document.read:own", "document.write:own", "wallet.read:own",
		"store.read", "store.write:own", "product.write:own",
		"order.read:own", "order.fulfil:own", "pos.sell:own",
		"inventory.write:own", "customer.read:own", "customer.write:own",
		"cashier.write:own", "shift.write:own", "receipt.write:own",
		"group.create:own",
		"membership.write:own",
		"treasury.read:own", "treasury.contribute:own", "treasury.confirm:own",
		"treasury.meeting.write:own", "attendance.write:own",
		"treasury.withdraw.request:own", "treasury.withdraw.sign:own",
		"treasury.policy.write:own", "paymentid.issue:own", "portfolio.read:own",
		"ticketorg.read:own", "ticketorg.write:own", "ticketorgstaff.write:own", "venue.write:own",
		"route.write:own", "listing.write:own", "listing.publish:own",
		"ticketclass.write:own", "schedule.write:own",
		"booking.read:own", "booking.create:own", "booking.cancel:own",
		"mall.read", "mall.write:own",
		"warehouse.read", "warehouse.write:own",
		"fleet.read:own", "fleet.write:own", "crew.read:own", "crew.write:own",
		"trip.read:own", "trip.write:own", "vehicle.track:own",
		"fare.pay:own", "fare.read:own", "collection.declare:own", "collection.read:own",
		"voucher.create:own", "voucher.read:own", "voucher.spend:own", "voucher.freeze:own", "loyalty.read:own",
	},
}

func CapabilitiesForRole(role RoleName) []string {
	out := make([]string, len(RolePresets[role]))
	copy(out, RolePresets[role])
	return out
}
