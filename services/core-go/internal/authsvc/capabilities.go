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
	ParcelOrgID  string
	IP           string
	Verified     bool
	// ExpiresAt — unix millis this session's own TTL runs out, carried
	// straight through from SessionData so a client-facing "your
	// session expires in Xh Ym" countdown never has to be derived
	// separately from the same fact the server already enforces. Zero
	// for a session minted before this field existed.
	ExpiresAt int64
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
// mobile gating (EsoqoProfile.has) render from one catalogue.
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

// ParcelOrgCapabilities — the courier-company grants. Org-scoped via
// Ctx.ParcelOrgID for AGENT sessions, exactly as the ticketing grants
// above are via Ctx.TicketOrgID.
//
// Deliberately a separate vocabulary from the parcels.* names the Esoqo
// admin console uses (parcels.read, parcels.assign, parcels.cancel…).
// Those mean "across every parcel on the platform"; these mean "within
// this one company". Sharing the strings would make a dispatcher at one
// courier firm indistinguishable, at the capability layer, from Esoqo
// ops staff — and the whole point of tenancy is that they are not.
const (
	CapParcelOrgRead     = "parcelorg.read"
	CapParcelOrgWrite    = "parcelorg.write"
	CapParcelOrgStaff    = "parcelorgstaff.write"
	CapParcelOrgStations = "parcelorgstation.write"
	CapParcelOrgDispatch = "parcelorg.dispatch"
	// CapParcelOrgCarry — take custody, record an attempt, drop at an
	// agent, close at the door. The rider bundle's whole content.
	CapParcelOrgCarry      = "parcelorg.carry"
	CapParcelOrgEarnings   = "parcelorg.earnings"
	CapParcelOrgIntake     = "parcelorg.intake"
	CapParcelOrgArrival    = "parcelorg.arrival"
	CapParcelOrgCollection = "parcelorg.collection"
)

// ParcelStaffCapabilities — one bundle per role a parcel company issues
// a PIN for. An AGENT session's list IS the grant (same contract
// TicketingStaffCapabilities documents): scoping is the ParcelOrgID
// match, not a qualifier on the name.
//
// RIDER is deliberately the narrowest thing that still does the job: a
// rider needs to carry parcels and close them, and needs to read the
// company's parcels to find the one in their hand — but has no business
// reassigning work or seeing what the company earned.
var ParcelStaffCapabilities = map[string][]string{
	"RIDER": {CapParcelOrgRead, CapParcelOrgCarry},
	"DISPATCHER": {
		CapParcelOrgRead, CapParcelOrgCarry, CapParcelOrgDispatch, CapParcelOrgArrival,
	},
	"STATION_MANAGER":  {CapParcelOrgRead, CapParcelOrgCarry, CapParcelOrgDispatch, CapParcelOrgStaff, CapParcelOrgStations, CapParcelOrgIntake, CapParcelOrgArrival, CapParcelOrgCollection},
	"INTAKE_CLERK":     {CapParcelOrgRead, CapParcelOrgIntake},
	"ARRIVAL_CLERK":    {CapParcelOrgRead, CapParcelOrgArrival},
	"COLLECTION_CLERK": {CapParcelOrgRead, CapParcelOrgCollection},
	"MANAGER": {
		CapParcelOrgRead, CapParcelOrgCarry, CapParcelOrgDispatch,
		CapParcelOrgWrite, CapParcelOrgStaff, CapParcelOrgStations, CapParcelOrgEarnings,
	},
}

// parcelOwnerRoleAliases — free-text titles that plainly mean "this
// person runs the company", resolved to the MANAGER bundle above.
//
// The admin console offers MANAGER/DISPATCHER/RIDER plus an "Other…"
// that is only a title and floors at RIDER. That floor is right for an
// invented label, but a company that types "CEO" or "Owner" means
// someone who runs the place, and handing them a rider's access made a
// company founder unable to see their own team or earnings. Kept as an
// explicit allowlist (not a substring/regex match) so an unknown title
// still cannot widen itself, which is the property the RIDER floor was
// protecting.
var parcelOwnerRoleAliases = map[string]string{
	"OWNER":      "MANAGER",
	"CEO":        "MANAGER",
	"FOUNDER":    "MANAGER",
	"DIRECTOR":   "MANAGER",
	"PROPRIETOR": "MANAGER",
	"ADMIN":      "MANAGER",
}

// ParcelStaffCapabilitiesForRole — the single place that decides which
// free-text role maps to which capability bundle: an explicit override
// (a custom role's hand-picked permissions) wins, then an exact preset,
// then an owner-title alias, then the RIDER floor. Returns a copy so a
// caller can't mutate the shared preset slice.
func ParcelStaffCapabilitiesForRole(role string, explicit []string) []string {
	if caps := SanitizeParcelCapabilities(explicit); len(caps) > 0 {
		return caps
	}
	r := strings.ToUpper(strings.TrimSpace(role))
	if caps, ok := ParcelStaffCapabilities[r]; ok {
		return append([]string(nil), caps...)
	}
	if alias, ok := parcelOwnerRoleAliases[r]; ok {
		return append([]string(nil), ParcelStaffCapabilities[alias]...)
	}
	return append([]string(nil), ParcelStaffCapabilities["RIDER"]...)
}

// AllParcelOrgCapabilities — every capability a courier-company staff
// session may hold. This is the allowlist a custom role's permissions
// are filtered against: a free-text role must not be able to smuggle in
// a capability from another domain (a store or fleet grant) or the `*`
// wildcard. Order is the order the UI renders the checkboxes in.
var AllParcelOrgCapabilities = []string{
	CapParcelOrgRead, CapParcelOrgCarry, CapParcelOrgDispatch,
	CapParcelOrgIntake, CapParcelOrgArrival, CapParcelOrgCollection,
	CapParcelOrgStations, CapParcelOrgStaff, CapParcelOrgWrite, CapParcelOrgEarnings,
}

// knownParcelOrgCapability — set form of the list above, for the filter.
var knownParcelOrgCapability = func() map[string]bool {
	m := make(map[string]bool, len(AllParcelOrgCapabilities))
	for _, c := range AllParcelOrgCapabilities {
		m[c] = true
	}
	return m
}()

// SanitizeParcelCapabilities dedupes explicit and keeps only known
// parcel-org capabilities, in the canonical order. Returns nil when
// nothing valid remains, which ParcelStaffCapabilitiesForRole treats as
// "no override — fall back to the role". A caller can therefore hand it
// raw request input without a separate validation step.
func SanitizeParcelCapabilities(explicit []string) []string {
	if len(explicit) == 0 {
		return nil
	}
	want := make(map[string]bool, len(explicit))
	for _, c := range explicit {
		if knownParcelOrgCapability[c] {
			want[c] = true
		}
	}
	if len(want) == 0 {
		return nil
	}
	out := make([]string, 0, len(want))
	for _, c := range AllParcelOrgCapabilities {
		if want[c] {
			out = append(out, c)
		}
	}
	return out
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
