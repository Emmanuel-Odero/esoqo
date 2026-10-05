// Package httpapi is the Gin HTTP layer: router wiring, middleware, and
// the Phase 0 auth handlers (OTP, PIN sign-in, session, /me).
package httpapi

import (
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/config"
	"github.com/esoqo/core-go/internal/phone"
	"github.com/esoqo/core-go/internal/storage"
)

type Server struct {
	Cfg   config.Config
	Pool  *pgxpool.Pool
	Redis *redis.Client
	// NotifyPool — a connection pool built from cfg.DirectDatabaseURL,
	// used only for Postgres LISTEN (the counter ticket queue's live
	// push; see streamCounterTicketEvents). Kept separate from Pool
	// because Pool may run through a transaction-mode connection pooler
	// (dev's pgbouncer) that silently breaks LISTEN — see
	// config.Config.DirectDatabaseURL's own comment.
	NotifyPool *pgxpool.Pool
	OTP        *authsvc.OtpService
	Session    *authsvc.SessionService
	OrgCtx     *authsvc.OrgContextService

	// StaffLockout bounds PIN guesses on ticket-staff sign-in, which has
	// no per-account failure column of its own.
	StaffLockout *authsvc.Lockout

	// Storage backs field-captured images — today, proof-of-delivery
	// photos. See internal/storage for why the provider gating mirrors
	// packages/db/src/storage.ts exactly rather than inventing a second
	// policy for this side.
	Storage storage.Store
}

func NewServer(cfg config.Config, pool, notifyPool *pgxpool.Pool, rdb *redis.Client) *Server {
	return &Server{
		Cfg:        cfg,
		Pool:       pool,
		NotifyPool: notifyPool,
		Redis:      rdb,
		OTP:        authsvc.NewOtpService(rdb, cfg.OTPPepper, cfg.OTPDailySpendCapKES, cfg.OTPRateLimitPerHour),
		Session:    authsvc.NewSessionService(rdb),
		OrgCtx:     authsvc.NewOrgContextService(rdb, time.Duration(cfg.OrgContextActivationDays)*24*time.Hour),
		// 10 tries an hour: comfortably above a tired operator fumbling a
		// PIN at the start of a shift, far below anything that makes
		// guessing a 4-digit secret worthwhile.
		StaffLockout: authsvc.NewLockout(rdb, "ticketstaff", 10, time.Hour),
		Storage:      storage.New(cfg),
	}
}

// trustedProxyHops is how many X-Forwarded-For entries were appended by
// infrastructure we control (see clientIP). Process-wide because there
// is one Server per process and clientIP is a free function called from
// every handler; set once in Router, read atomically thereafter.
var trustedProxyHops atomic.Int32

func (s *Server) Router() *gin.Engine {
	r := gin.New()

	// Gin trusts every proxy unless told otherwise, which makes
	// c.ClientIP() return a caller-supplied X-Forwarded-For entry. Turn
	// that off: clientIP does the trusted-hop walk itself.
	_ = r.SetTrustedProxies(nil)
	trustedProxyHops.Store(int32(s.Cfg.TrustedProxyHops))

	r.Use(gin.Recovery(), requestLogger(), s.corsMiddleware())

	r.GET("/health", s.handleHealth)
	r.GET("/ready", s.handleReady)

	v1 := r.Group("/v1")
	{
		// Per-account lockout already bounds guesses against one victim,
		// but nothing bounded the transport: a 4-digit PIN spread thinly
		// across many accounts from one host stayed under every counter.
		auth := v1.Group("/auth")
		auth.POST("/otp", s.rateLimit("auth:otp", 20, time.Hour), s.handleIssueOtp)
		auth.POST("/verify-otp", s.rateLimit("auth:verify", 30, time.Hour), s.handleVerifyOtp)
		auth.POST("/sign-in", s.rateLimit("auth:signin", 30, time.Hour), s.handleSignIn)
		auth.POST("/pin/reset", s.rateLimit("auth:pinreset", 20, time.Hour), s.handleResetPin)
		auth.POST("/pin/set-without-code", s.rateLimit("auth:pinreset", 20, time.Hour), s.handleSetPinWithoutCode)
		auth.POST("/set-pin", s.authRequired(), s.handleSetPin)
		auth.POST("/sign-out", s.authRequired(), s.handleSignOut)

		v1.GET("/me", s.authRequired(), s.handleMe)
		v1.PATCH("/me", s.authRequired(), s.handleUpdateMe)
		v1.GET("/me/history", s.authRequired(), s.handleHistory)
		// One endpoint for every signed-in party — customer, admin
		// staff, or parcel-org staff all resolve to the same
		// ctx.PartyID (see the handler's own comment).
		v1.GET("/me/parcel-activity", s.authRequired(), s.handleGetPartyParcelActivity)
		v1.GET("/me/points", s.authRequired(), s.handlePoints)

		v1.GET("/stores", s.handleListStores)
		v1.GET("/stores/nearby", s.handleListStoresNearby)
		v1.GET("/stores/:slug", s.handleGetStore)
		v1.GET("/stores/:slug/products", s.handleListStoreProducts)
		v1.GET("/stores/:slug/usual", s.handleGetUsualProduct)
		v1.GET("/products/:id", s.handleGetProduct)
		v1.POST("/orders", s.rateLimit("pay:order", 30, time.Hour), s.handleCreateOrder)
		v1.GET("/orders/:id",
			s.rateLimit("pay:orderread", 60, time.Hour), s.handleGetOrder)
		v1.GET("/me/orders", s.authRequired(), s.handleListMyOrders)
		v1.GET("/me/saved-stores", s.authRequired(), s.handleListSavedStores)
		v1.POST("/me/saved-stores/:storeId", s.authRequired(), s.handleSaveStore)
		v1.DELETE("/me/saved-stores/:storeId", s.authRequired(), s.handleUnsaveStore)
		v1.POST("/stores/orders/:id/ready", s.authRequired(), s.handleMarkOrderReady)
		v1.POST("/stores/orders/:id/collect", s.authRequired(), s.handleConfirmOrderCollected)
		v1.POST("/stores/orders/:id/dine-in-status", s.authRequired(), s.handleUpdateDineInStatus)
		v1.POST("/orders/:id/tip",
			s.rateLimit("pay:ordertip", 20, time.Hour), s.handleAddTip)
		v1.GET("/stores/:slug/tables", s.authRequired(), s.handleListTableOrders)
		v1.POST("/stores/:slug/tables/:table/assign", s.authRequired(), s.handleAssignTable)
		v1.GET("/stores/:slug/cashiers", s.authRequired(), s.handleListCashiers)
		v1.POST("/stores/:slug/cashiers", s.authRequired(), s.handleCreateCashier)
		v1.POST("/stores/:slug/exit-code/resolve", s.authRequired(), s.handleResolveExitCode)

		v1.GET("/listings", s.handleListListings)
		v1.GET("/listings/:id", s.handleGetListing)
		v1.GET("/schedules/:id/seats", s.handleListScheduleSeats)
		v1.POST("/bookings", s.rateLimit("pay:booking", 30, time.Hour), s.handleCreateBooking)
		v1.POST("/bookings/installment", s.rateLimit("pay:installment", 30, time.Hour), s.handleOpenInstallmentPlan)
		v1.POST("/bookings/:id/balance", s.rateLimit("pay:balance", 30, time.Hour), s.handlePayBookingBalance)
		v1.GET("/bookings/:id",
			s.rateLimit("pay:bookingread", 60, time.Hour), s.handleGetBooking)
		v1.GET("/me/tickets", s.authRequired(), s.handleListMyBookings)
		v1.GET("/me/orgs", s.authRequired(), s.handleListMyAllOrgs)
		v1.GET("/me/org-grants", s.authRequired(), s.handleListMyOrgGrants)
		// The subject-side counterpart to /me/orgs (ticketing companies
		// they own): the courier companies they are staff of, so a
		// shipping company an admin added them to actually shows up on
		// their dashboard instead of only in an invite text.
		v1.GET("/me/parcel-orgs", s.authRequired(), s.handleListMyParcelOrgs)
		// One-click entry: mints the company-scoped session from the
		// person's own, after checking they hold an active staff row on
		// that company.
		v1.POST("/me/parcel-orgs/activate", s.authRequired(), s.handleActivateParcelOrg)

		// Generic org portal data endpoints (for /org/[type]/[id])
		v1.GET("/orgs/:orgId/portal", s.authRequired(), s.handleGetOrgPortalData)
		v1.GET("/orgs/:orgId/metadata", s.authRequired(), s.handleListOrgMetadata)
		v1.PATCH("/orgs/:orgId/metadata", s.authRequired(), s.handleUpdateOrgMetadata)

		// Generic staff sign-in and sign-out (all org types)
		v1.POST("/orgs/staff/signin", s.rateLimit("auth:orgstaff", 20, time.Hour), s.handleOrgStaffSignIn)
		v1.POST("/orgs/me/signout", s.authRequired(), s.handleSignOutOrg)

		// Generic org me endpoint (for unified portal layout)
		v1.GET("/orgs/:orgId/me", s.authRequired(), s.handleGetOrgMe)
		v1.GET("/orgs/me/staff", s.authRequired(), s.handleListGenericOrgStaff)
		v1.GET("/orgs/me/config/:configKey", s.authRequired(), s.handleGetOrgConfig)
		v1.GET("/orgs/me/configs", s.authRequired(), s.handleListOrgConfigs)

		// Hotel org type routes
		v1.GET("/hotels/:orgId/dashboard", s.authRequired(), s.handleGetHotelDashboard)
		v1.GET("/hotels/:orgId/rooms", s.authRequired(), s.handleListHotelRooms)
		v1.POST("/hotels/:orgId/rooms", s.authRequired(), s.handleCreateHotelRoom)
		v1.PATCH("/hotels/:orgId/rooms/:number/status", s.authRequired(), s.handleUpdateHotelRoomStatus)
		v1.GET("/hotels/:orgId/reservations", s.authRequired(), s.handleListHotelReservations)
		v1.POST("/hotels/:orgId/reservations", s.authRequired(), s.handleCreateHotelReservation)
		v1.POST("/hotels/:orgId/reservations/:reservationId/checkin", s.authRequired(), s.handleCheckInGuest)
		v1.POST("/hotels/:orgId/reservations/:reservationId/checkout", s.authRequired(), s.handleCheckOutGuest)
		v1.GET("/hotels/:orgId/staff", s.authRequired(), s.handleListHotelStaff)

		v1.POST("/org-context/activate/request", s.authRequired(), s.handleOrgContextActivateRequest)
		v1.POST("/org-context/activate/verify", s.authRequired(), s.handleOrgContextActivateVerify)
		v1.POST("/org-context/deactivate", s.authRequired(), s.handleOrgContextDeactivate)
		v1.GET("/org-context/status", s.authRequired(), s.handleOrgContextStatus)
		v1.GET("/fleet/active-trips", s.handleListPublicActiveTrips)

		v1.POST("/ticket-staff/sign-in", s.rateLimit("auth:staff", 20, time.Hour), s.handleTicketStaffSignIn)

		v1.POST("/ticketorgs", s.authRequired(), s.handleCreateTicketOrg)
		v1.GET("/ticketorgs/by-slug/:slug", s.handleGetTicketOrgBySlug)
		v1.GET("/ticketorgs/:id", s.authRequired(), s.handleGetTicketOrg)
		v1.GET("/ticketorgs/:id/listings", s.authRequired(), s.handleListOrgListings)
		v1.POST("/ticketorgs/:id/listings", s.authRequired(), s.handleCreateListing)
		v1.GET("/ticketorgs/:id/listings/:listingId", s.authRequired(), s.handleGetOrgListing)
		v1.GET("/ticketorgs/:id/venues-routes", s.authRequired(), s.handleListVenuesRoutes)
		v1.POST("/ticketorgs/:id/venues", s.authRequired(), s.handleCreateVenue)
		v1.POST("/ticketorgs/:id/routes", s.authRequired(), s.handleCreateOrgRoute)
		v1.GET("/ticketorgs/:id/staff", s.authRequired(), s.handleListOrgStaff)
		v1.POST("/ticketorgs/:id/staff", s.authRequired(), s.handleCreateOrgStaff)
		v1.GET("/ticketorgs/:id/staff-grants", s.authRequired(), s.handleListOrgStaffGrants)
		v1.POST("/ticketorgs/:id/staff-grants", s.authRequired(), s.handleCreateOrgStaffGrant)
		v1.POST("/ticketorgs/:id/staff-grants/:partyId/suspend", s.authRequired(), s.handleSuspendOrgStaffGrant)
		v1.POST("/ticketorgs/:id/staff-grants/:partyId/reinstate", s.authRequired(), s.handleReinstateOrgStaffGrant)
		v1.GET("/ticketorgs/:id/bookings", s.authRequired(), s.handleListOrgBookings)
		v1.POST("/ticketorgs/:id/checkin", s.authRequired(), s.handleCheckInTicket)

		v1.POST("/org-listings/:id/publish", s.authRequired(), s.handlePublishListing)
		v1.POST("/org-listings/:id/classes", s.authRequired(), s.handleCreateTicketClass)
		v1.POST("/org-listings/:id/schedules", s.authRequired(), s.handleCreateSchedule)
		v1.GET("/org-listings/:id/seatmap", s.authRequired(), s.handleGetSeatMap)
		v1.PUT("/org-listings/:id/seatmap", s.authRequired(), s.handleSaveSeatMap)
		v1.POST("/org-listings/:id/addons", s.authRequired(), s.handleCreateAddon)
		v1.POST("/org-staff/:id/active", s.authRequired(), s.handleSetOrgStaffActive)

		v1.POST("/bookings/:id/cancel", s.authRequired(), s.handleCancelBooking)
		v1.POST("/bookings/:id/retry", s.authRequired(), s.handleRetryBookingPayment)
		v1.GET("/bookings/:id/status",
			s.rateLimit("pay:bookingstatus", 60, time.Hour), s.handleGetBookingStatus)
		v1.GET("/bookings/:id/balance-view",
			s.rateLimit("pay:bookingbalanceview", 60, time.Hour), s.handleGetBookingBalanceView)
		v1.GET("/me/bookings", s.authRequired(), s.handleListMyBookingsRich)

		v1.GET("/admin/ticketorgs", s.authRequired(), s.handleAdminListTicketOrgs)
		v1.GET("/admin/ticketorgs/counts", s.authRequired(), s.handleAdminTicketOrgCounts)
		v1.POST("/admin/ticketorgs/:id/status", s.authRequired(), s.handleAdminSetTicketOrgStatus)

		v1.POST("/fleet/vehicles", s.authRequired(), s.handleCreateVehicle)
		v1.GET("/fleet/orgs/:orgId/vehicles", s.authRequired(), s.handleListVehicles)
		v1.POST("/fleet/vehicles/:id/status", s.authRequired(), s.handleSetVehicleStatus)

		v1.POST("/fleet/crew", s.authRequired(), s.handleCreateCrew)
		v1.GET("/fleet/orgs/:orgId/crew", s.authRequired(), s.handleListCrew)
		v1.POST("/fleet/crew/:id/active", s.authRequired(), s.handleSetCrewActive)

		v1.POST("/fleet/short-routes", s.authRequired(), s.handleCreateShortRoute)
		v1.GET("/fleet/orgs/:orgId/short-routes", s.authRequired(), s.handleListShortRoutes)

		v1.POST("/fleet/trips", s.authRequired(), s.handleCreateTrip)
		v1.GET("/fleet/orgs/:orgId/trips", s.authRequired(), s.handleListTrips)
		v1.POST("/fleet/trips/:id/close", s.authRequired(), s.handleCloseTrip)
		v1.POST("/fleet/trips/:id/pings", s.authRequired(), s.handlePostPing)
		v1.GET("/fleet/orgs/:orgId/positions", s.authRequired(), s.handleLatestPositions)
		// The manager console's header + live map: one overview roll-up,
		// and the ordered recent pings behind the map's route lines.
		v1.GET("/fleet/orgs/:orgId/overview", s.authRequired(), s.handleFleetOverview)
		v1.GET("/fleet/orgs/:orgId/trails", s.authRequired(), s.handleActiveTrails)
		v1.POST("/fleet/trips/:id/declare", s.authRequired(), s.handleDeclare)
		v1.GET("/fleet/trips/:id/collections", s.authRequired(), s.handleTripCollections)
		v1.GET("/fleet/my-trip", s.authRequired(), s.handleMyActiveTrip)

		// Passenger luggage. Under /fleet/ because a bag belongs to a
		// vehicle run, not to the parcel network — see
		// handlers_luggage.go's header and LuggageTag's schema comment on
		// why these are not parcel routes.
		v1.POST("/fleet/luggage", s.authRequired(), s.handleTagLuggage)
		v1.POST("/fleet/luggage/:code/board", s.authRequired(), s.handleBoardLuggage)
		v1.POST("/fleet/luggage/:code/claim", s.authRequired(), s.handleClaimLuggage)
		v1.GET("/fleet/trips/:id/luggage", s.authRequired(), s.handleListTripLuggage)

		v1.POST("/fares", s.rateLimit("pay:fare", 40, time.Hour), s.handleCreateFare)
		v1.GET("/fares/:id", s.handleGetFare)
		v1.GET("/fares/:id/status", s.handleFareStatus)
		v1.POST("/fares/verify", s.authRequired(), s.handleVerifyFare)
		v1.GET("/trips/resolve", s.rateLimit("resolve:trip", 60, time.Hour), s.handleResolveTrip)
		v1.GET("/scan/resolve", s.rateLimit("scan:resolve", 60, time.Hour), s.handleResolveScan)
		v1.GET("/fleet/trips/:id/qr", s.authRequired(), s.handleTripQr)
		v1.GET("/me/fares", s.authRequired(), s.handleListMyFares)

		v1.POST("/vouchers", s.authRequired(), s.handleCreateVoucher)
		v1.POST("/vouchers/:id/load", s.rateLimit("pay:voucherload", 30, time.Hour), s.authRequired(), s.handleLoadVoucher)
		v1.GET("/vouchers/:id/status", s.authRequired(), s.handleVoucherStatus)
		v1.GET("/vouchers/resolve", s.rateLimit("resolve:voucher", 60, time.Hour), s.handleResolveVoucher)
		v1.GET("/me/vouchers", s.authRequired(), s.handleListMyVouchers)
		v1.POST("/vouchers/:id/freeze", s.authRequired(), s.handleFreezeVoucher)
		v1.POST("/vouchers/:id/pay-business", s.rateLimit("pay:voucherbusiness", 30, time.Hour), s.authRequired(), s.handleSpendVoucherAtBusiness)
		v1.GET("/me/loyalty", s.authRequired(), s.handleMyLoyalty)

		v1.GET("/admin/fraud/summary", s.authRequired(), s.handleFraudSummary)

		v1.POST("/groups", s.authRequired(), s.handleCreateGroup)
		v1.POST("/groups/:id/join", s.authRequired(), s.handleJoinGroup)
		v1.GET("/groups/search", s.authRequired(), s.handleSearchGroups)
		v1.GET("/me/groups", s.authRequired(), s.handleListMyGroups)
		v1.GET("/groups/:id", s.authRequired(), s.handleGetGroup)

		v1.GET("/groups/:id/policy", s.authRequired(), s.handleGetTreasuryPolicy)
		v1.POST("/groups/:id/contributions", s.rateLimit("pay:contribution", 30, time.Hour), s.authRequired(), s.handleDeclareContribution)
		v1.POST("/groups/:id/contributions/:cid/confirm", s.authRequired(), s.handleConfirmContribution)
		v1.GET("/groups/:id/contributions", s.authRequired(), s.handleListContributions)
		v1.GET("/groups/:id/balance", s.authRequired(), s.handleGetGroupBalance)
		v1.POST("/groups/:id/withdrawals", s.authRequired(), s.handleRequestWithdrawal)
		v1.GET("/groups/:id/withdrawals", s.authRequired(), s.handleListWithdrawals)
		v1.POST("/withdrawals/:id/sign", s.authRequired(), s.handleSignWithdrawal)
		v1.GET("/withdrawals/:id", s.authRequired(), s.handleGetWithdrawal)
		v1.GET("/groups/:id/timeline", s.authRequired(), s.handleGroupTimeline)

		v1.POST("/me/bills", s.authRequired(), s.handleCreateBill)
		v1.GET("/me/bills", s.authRequired(), s.handleListMyBills)
		v1.POST("/me/bills/:id/pay", s.authRequired(), s.handleMarkBillPaid)
		v1.PATCH("/me/bills/:id", s.authRequired(), s.handleUpdateBill)
		v1.DELETE("/me/bills/:id", s.authRequired(), s.handleArchiveBill)
		v1.GET("/bills/:id/funding", s.handleGetBillFunding)
		v1.GET("/bills/:id/contributions", s.handleListBillContributions)
		v1.POST("/bills/:id/contributions", s.rateLimit("pay:billcontrib", 30, time.Hour), s.handleContributeToBill)

		v1.POST("/me/voucher-batches", s.rateLimit("pay:voucherbatch", 20, time.Hour), s.authRequired(), s.handleIssueAllowanceBatch)
		v1.GET("/me/voucher-batches", s.authRequired(), s.handleListVoucherBatches)

		// Unauthenticated by design (ADR-0003: sending a parcel never
		// requires an account), and until now unlimited as well — the
		// only public write in this file with no bucket at all. Limited
		// now that the web form is a single screen a guest can submit in
		// seconds: making booking faster for a sender makes it equally
		// faster for anyone minting junk rows. Generous enough that a
		// shop booking a morning's parcels from one connection never
		// notices.
		v1.POST("/parcels", s.rateLimit("book:parcel", 20, time.Hour), s.handleBookParcel)
		v1.GET("/parcels/pricing", s.handleGetParcelPricing)
		v1.GET("/parcels/zones", s.handleListParcelZones)
		// Public for the same reason pricing and zones are: the booking
		// form needs a pickup point and a cover quote before the sender
		// has signed in, let alone paid.
		v1.GET("/parcels/agents", s.handleListParcelAgents)
		// Same boundary, origin side: a sender choosing "I'm dropping
		// this off myself" needs to see which companies accept a
		// walk-in before booking, let alone signing in.
		v1.GET("/parcels/stations", s.handleListWalkInStations)
		// Same boundary again, one level deeper: once a sender has
		// named which company's office they're standing in, this lets
		// them search that SAME company's own branches as a destination
		// — still public, still before anyone has signed in.
		v1.GET("/parcels/org-stations", s.handleListPublicOrgStations)
		// Walk-in counter tickets. Public — same boundary as booking and
		// the station picker above: a kiosk, a counter-QR web form and
		// the app all mint/poll these before anyone has signed in. Rate
		// limited on create only; the id itself is the bearer credential
		// for everything after (see dbx.GetCounterTicket's own comment).
		v1.POST("/parcels/counter-tickets",
			s.rateLimit("book:counterticket", 30, time.Hour), s.handleCreateCounterTicket)
		v1.GET("/parcels/counter-tickets/:id",
			s.rateLimit("counterticket:read", 60, time.Hour), s.handleGetCounterTicket)
		v1.GET("/parcels/counter-tickets/:id/stream",
			s.rateLimit("counterticket:stream", 60, time.Hour), s.handleStreamCounterTicket)
		v1.PATCH("/parcels/counter-tickets/:id/draft",
			s.rateLimit("counterticket:draft", 60, time.Hour), s.handlePatchCounterTicketDraft)
		v1.GET("/parcels/coverage", s.handleListCoverageTiers)
		// Cash on delivery. The policy is public so a booking form knows
		// whether to offer it at all; setting and confirming COD sit on
		// the same guest boundary booking and pricing already do.
		// Parcels riding the passenger fleet. The trip list and its
		// stages are public for the same reason the zone and agent
		// pickers are: a sender chooses a bus before signing in.
		v1.GET("/parcels/trips", s.handleListDepartingTrips)
		v1.GET("/parcels/trips/:tripId/stages", s.handleListTripStages)
		v1.GET("/parcels/trips/:tripId/manifest", s.authRequired(), s.handleGetTripManifest)
		v1.POST("/parcels/:code/board", s.authRequired(), s.handleBoardParcelOnTrip)
		v1.POST("/parcels/:code/drop", s.authRequired(), s.handleDropParcelFromTrip)
		v1.GET("/parcels/cod-policy", s.handleGetCodPolicy)
		// Both COD writes are unauthenticated and keyed on the tracking
		// code alone, so they need a bucket like any other public
		// write — /cod/confirm texts the sender and starts an SLA clock,
		// which makes it an SMS sender anyone holding a code can pull.
		v1.POST("/parcels/:code/cod",
			s.rateLimit("book:parcelcod", 20, time.Hour), s.handleSetParcelCod)
		v1.POST("/parcels/:code/cod/confirm",
			s.rateLimit("book:parcelcodconfirm", 10, time.Hour), s.handleConfirmParcelCodBooking)
		// Collection normally rides inside /deliver — this is the repair
		// path for a hand-over whose payment failed to record.
		v1.POST("/parcels/:code/cod/collect", s.authRequired(), s.handleRecordCodCollection)

		// ── Courier companies (tenants) ──────────────────────────────
		// Public: the staff sign-in page needs the company's name before
		// anyone has authenticated (see handleGetParcelOrgBySlug — name
		// and slug only, never commercial terms).
		v1.GET("/parcel-orgs/by-slug/:slug", s.handleGetParcelOrgBySlug)
		v1.POST("/parcel-orgs/staff/signin",
			s.rateLimit("signin:parcelorgstaff", 20, time.Hour), s.handleParcelStaffSignIn)
		// The hardened, OTP-based alternative for the public tracking
		// page's staff panel — see handleVerifyParcelStaffOtp's own
		// comment on why it's a separate credential from the PIN above.
		v1.POST("/parcel-orgs/staff/otp/request",
			s.rateLimit("otp-req:parcelorgstaff", 20, time.Hour), s.handleRequestParcelStaffOtp)
		v1.POST("/parcel-orgs/staff/otp/verify",
			s.rateLimit("otp-verify:parcelorgstaff", 20, time.Hour), s.handleVerifyParcelStaffOtp)
		// Everything below reads its org from the session, never the
		// request — that is the whole tenancy boundary.
		v1.GET("/parcel-orgs/me", s.authRequired(), s.handleGetMyParcelOrg)
		// The company's own live dispatch: rider dots, parcels needing
		// a rider or running late, stations.
		v1.GET("/parcel-orgs/me/live", s.authRequired(), s.handleGetOrgLive)
		v1.GET("/parcel-orgs/me/parcels", s.authRequired(), s.handleListMyOrgParcels)
		v1.GET("/parcel-orgs/me/trends", s.authRequired(), s.handleParcelOrgTrends)
		// Register a parcel the company already tracks in another system,
		// so it can be managed and tracked here too — see
		// handleImportOrgParcel.
		v1.POST("/parcel-orgs/me/parcels", s.authRequired(), s.handleImportOrgParcel)
		v1.POST("/parcel-orgs/me/parcels/:code/assign", s.authRequired(), s.handleAssignOrgParcel)
		// Resolving a receiver who can't get past the delivery code —
		// the company's own escalation queue. Grant two more tries, or
		// (once that's been burned, or the code is simply gone) mint a
		// replacement and text both parties. Release is the other half
		// of a self-confirmed collection: the courier pay DeliverParcel
		// held rather than accrued.
		v1.POST("/parcel-orgs/me/parcels/:code/receiver-auth/grant-retry",
			s.authRequired(), s.handleOrgGrantReceiverAuthRetry)
		v1.POST("/parcel-orgs/me/parcels/:code/delivery-code/reissue",
			s.authRequired(), s.handleOrgReissueDeliveryCode)
		v1.POST("/parcel-orgs/me/parcels/:code/courier-earnings/release",
			s.authRequired(), s.handleOrgReleaseHeldEarnings)
		v1.POST("/parcel-orgs/me/cod/remit", s.authRequired(), s.handleOrgRemitCod)
		// A company's own label stock — minting, the register, and
		// withdrawing a stolen pad, all scoped to the session's org.
		// "batches" is static and sits above :id, same shape as the
		// admin-side label routes.
		// Stock is issued to a company by Esoqo admin — a company never
		// mints its own. The static "search" segment is load-bearing:
		// see handleAttachOrgLabelInfo's own comment.
		v1.GET("/parcel-orgs/me/labels/search", s.authRequired(), s.handleSearchOrgLabels)
		v1.GET("/parcel-orgs/me/labels", s.authRequired(), s.handleOrgListLabelRegister)
		// The walk-in counter queue: every WAITING ticket for the
		// session's own org, oldest first, plus its live SSE stream and
		// the "Serve" action that claims one. See
		// handlers_parcel_counter_tickets.go.
		v1.GET("/parcel-orgs/me/counter-tickets/queue", s.authRequired(), s.handleListCounterTicketQueue)
		v1.GET("/parcel-orgs/me/counter-tickets/stream", s.authRequired(), s.handleStreamCounterTicketQueue)
		v1.POST("/parcel-orgs/me/counter-tickets/:id/claim", s.authRequired(), s.handleClaimCounterTicket)
		// Scan/lookup a code against the company's own stock, and attach
		// field notes to a printed label. The static "info" segment is
		// load-bearing: see handleAttachOrgLabelInfo's own comment.
		v1.GET("/parcel-orgs/me/labels/resolve", s.authRequired(), s.handleResolveOrgLabel)
		v1.POST("/parcel-orgs/me/labels/info/:code", s.authRequired(), s.handleAttachOrgLabelInfo)
		v1.GET("/parcel-orgs/me/labels/batches", s.authRequired(), s.handleOrgListLabelBatches)
		v1.POST("/parcel-orgs/me/labels/void", s.authRequired(), s.handleOrgVoidLabels)
		v1.POST("/parcel-orgs/me/labels/batches/:id/void", s.authRequired(), s.handleOrgVoidLabelBatch)
		// The company counter — booking against the company's own
		// stock plus the address book that feeds its party fields,
		// both scoped to the session's org.
		v1.POST("/parcel-orgs/me/counter/book", s.authRequired(), s.handleCounterBookParcel)
		v1.GET("/parcel-orgs/me/parties", s.authRequired(), s.handleOrgSearchCounterParties)
		v1.GET("/parcel-orgs/me/staff", s.authRequired(), s.handleListMyOrgStaff)
		v1.POST("/parcel-orgs/me/staff", s.authRequired(), s.handleUpsertMyOrgStaff)
		// A staffer changing their own portal PIN — self-service for the
		// whole roster, not management, so it sits beside staff rather
		// than behind the staff-write capability.
		v1.POST("/parcel-orgs/me/pin", s.authRequired(), s.handleChangeMyOrgPin)
		v1.GET("/parcel-orgs/me/stations", s.authRequired(), s.handleListMyOrgStations)
		v1.POST("/parcel-orgs/me/stations", s.authRequired(), s.handleCreateMyOrgStation)
		v1.GET("/parcel-orgs/me/stations/:id", s.authRequired(), s.handleGetMyOrgStation)
		v1.PATCH("/parcel-orgs/me/stations/:id", s.authRequired(), s.handleUpdateMyOrgStation)
		// Station management: name the member who runs it, and post
		// roster members to it.
		v1.POST("/parcel-orgs/me/stations/:id/manager", s.authRequired(), s.handleSetMyOrgStationManager)
		v1.POST("/parcel-orgs/me/stations/:id/members", s.authRequired(), s.handleAssignMyOrgStationMember)
		v1.GET("/parcel-orgs/me/pricing", s.authRequired(), s.handleListMyOrgPricing)
		v1.POST("/parcel-orgs/me/pricing", s.authRequired(), s.handleUpsertMyOrgPricing)
		// The dispatch board — a company's own runs: vehicle, crew,
		// leg and receiving team. The static segments sit above :id
		// for the same reason the label routes do (see above).
		// The company's own vehicle runs — the manifest side of dispatch.
		// A parcel only reports IN_TRANSIT by being loaded onto one of
		// these (see dbx.LoadParcelOntoOrgShipment), so the counter's
		// "receive and load" has something real to put a box on.
		// ── Runs ──
		//
		// One record since ADR-0006. /me/runs is canonical; the two older
		// prefixes below resolve to the same handlers because a rider's
		// installed PWA may still hold either, and renaming a route by
		// breaking it strands exactly the people who cannot easily update.
		//
		// The two halves were split by what each model happened to own:
		// "shipments" knew the cargo, "dispatch" knew the journey. Both
		// now read parcel_shipment.
		v1.GET("/parcel-orgs/me/runs", s.authRequired(), s.handleListRuns)
		v1.POST("/parcel-orgs/me/runs", s.authRequired(), s.handleCreateRun)
		v1.GET("/parcel-orgs/me/runs/:id", s.authRequired(), s.handleGetRun)
		v1.GET("/parcel-orgs/me/runs/:id/manifest", s.authRequired(), s.handleGetMyOrgShipmentManifest)
		v1.POST("/parcel-orgs/me/runs/:id/load", s.authRequired(), s.handleLoadOntoMyOrgShipment)
		v1.POST("/parcel-orgs/me/runs/:id/start", s.authRequired(), s.handleStartMyOrgShipment)
		v1.POST("/parcel-orgs/me/runs/:id/position", s.authRequired(), s.handleReportRunPosition)
		v1.POST("/parcel-orgs/me/runs/:id/arrive", s.authRequired(), s.handleArriveRun)
		v1.POST("/parcel-orgs/me/runs/:id/cancel", s.authRequired(), s.handleCancelRun)

		// Compatibility aliases. /me/shipments kept the loading picker's
		// shape (handleListMyOrgShipments returns the picker row, not the
		// full run) because the Scanner still reads exactly that.
		v1.GET("/parcel-orgs/me/shipments", s.authRequired(), s.handleListMyOrgShipments)
		v1.POST("/parcel-orgs/me/shipments", s.authRequired(), s.handleCreateMyOrgShipment)
		v1.GET("/parcel-orgs/me/shipments/:id/manifest", s.authRequired(), s.handleGetMyOrgShipmentManifest)
		v1.POST("/parcel-orgs/me/shipments/:id/load", s.authRequired(), s.handleLoadOntoMyOrgShipment)
		v1.POST("/parcel-orgs/me/shipments/:id/start", s.authRequired(), s.handleStartMyOrgShipment)
		v1.GET("/parcel-orgs/me/dispatch", s.authRequired(), s.handleListRuns)
		v1.POST("/parcel-orgs/me/dispatch", s.authRequired(), s.handleCreateRun)
		v1.GET("/parcel-orgs/me/dispatch/:id", s.authRequired(), s.handleGetRun)
		v1.POST("/parcel-orgs/me/dispatch/:id/position", s.authRequired(), s.handleReportRunPosition)
		v1.POST("/parcel-orgs/me/dispatch/:id/arrive", s.authRequired(), s.handleArriveRun)
		v1.POST("/parcel-orgs/me/dispatch/:id/cancel", s.authRequired(), s.handleCancelRun)

		// ── Routes ── the company's own map: which stations, in what order.
		v1.GET("/parcel-orgs/me/routes", s.authRequired(), s.handleListMyOrgRoutes)
		v1.POST("/parcel-orgs/me/routes", s.authRequired(), s.handleSaveMyOrgRoute)
		v1.POST("/parcel-orgs/me/routes/:id", s.authRequired(), s.handleSaveMyOrgRoute)
		v1.DELETE("/parcel-orgs/me/routes/:id", s.authRequired(), s.handleDeleteMyOrgRoute)
		// The third step of the guest booking flow (book, price, pay), and
		// like the other two it is keyed on the tracking code alone. The
		// server-side range check is what stops it being used to set an
		// absurd price; this is what stops it being used to grind the
		// quote against a list of codes.
		v1.POST("/parcels/:code/price",
			s.rateLimit("book:parcelprice", 30, time.Hour), s.handleSetParcelPrice)
		v1.POST("/parcels/:code/settle-counter", s.authRequired(), s.handleSettleCounterParcel)
		v1.POST("/parcels/:code/settle-counter/stk", s.authRequired(), s.handleSettleCounterParcelStk)
		v1.GET("/parcel-orgs/me/parcels/:code/settlement-status", s.authRequired(), s.handleGetCounterSettlementStatus)
		v1.POST("/parcels/:code/pay", s.rateLimit("pay:parcel", 30, time.Hour), s.handlePayParcel)
		v1.PATCH("/parcels/:code", s.authRequired(), s.handleUpdateOwnParcelDetails)
		v1.GET("/parcels/:code/status",
			// Public, code-gated like /position below, and so the most
			// tempting thing on the whole surface to grind: it accepts the
			// serviceTicketNumber as well as the tracking code, is
			// unauthenticated, and answered one code per request.
			s.rateLimit("track:parcel", 60, time.Hour), s.handleGetParcelStatus)
		// Public and code-gated like /status above — the live position
		// is deliberately anonymous (see dbx.CourierPosition).
		v1.GET("/parcels/:code/position",
			s.rateLimit("track:parcelposition", 60, time.Hour), s.handleGetParcelCourierPosition)
		v1.GET("/parcels/:code/label", s.authRequired(), s.handleGetParcelLabel)
		v1.POST("/parcels/:code/handoff", s.authRequired(), s.handleScanParcelHandoff)
		v1.POST("/parcels/:code/deliver", s.authRequired(), s.handleDeliverParcel)
		v1.POST("/parcels/:code/collect", s.authRequired(), s.handleDeliverParcel)
		// The receiver-OTP alternative to the printed delivery code —
		// see dbx.RequestParcelDeliveryOtp's own comment.
		v1.POST("/parcels/:code/deliver/request-otp", s.authRequired(), s.handleRequestParcelDeliveryOtp)
		// Proving you're a party to a parcel, to see more than the
		// guest-safe stub. Rate-limited hard: the response is uniform by
		// design (see the handler), and a uniform response alone is no
		// defence against someone working through a phone book against a
		// code they found on a box.
		v1.POST("/parcels/:code/claim/otp",
			s.rateLimit("claim:parcel", 10, time.Hour), s.handleRequestParcelClaimOtp)
		v1.POST("/parcels/:code/claim/verify",
			s.rateLimit("claim:parcelverify", 20, time.Hour), s.handleVerifyParcelClaim)
		// The other route to the same place, by the code rather than the
		// phone (see handlers_parcel_receiver.go). Public for the same
		// reason the claim pair is: the person standing at an agent's
		// counter has no account and is not going to make one.
		//
		// Rate-limited per IP even though the real gate is the
		// three-attempt counter on the parcel row. The two cover
		// different attacks: the row counter stops guessing at ONE
		// parcel, the IP limit stops one host walking a list of codes
		// photographed off a shelf, which a per-parcel counter cannot see
		// by construction. Confirm is limited harder than verify — there
		// is no honest reason to close more than a handful of parcels
		// from one address in an hour.
		v1.POST("/parcels/:code/receiver/verify",
			s.rateLimit("receiver-auth:parcel", 15, time.Hour), s.handleVerifyReceiverCode)
		v1.POST("/parcels/:code/receiver/confirm",
			s.rateLimit("receiver-confirm:parcel", 10, time.Hour), s.handleReceiverSelfConfirm)
		// Public, same shape as the claim pair: the receiver confirming
		// they got the box has no account and never will. Both routes are
		// rate limited, and the OTP request harder than the confirm —
		// requesting one costs an SMS to a number typed into a booking
		// form, so walking a list of codes would spend other people's
		// airtime and get the platform barred for it.
		v1.POST("/parcels/:code/receipt/otp",
			s.rateLimit("receipt:parcelotp", 5, time.Hour), s.handleRequestParcelReceiptOtp)
		v1.POST("/parcels/:code/receipt/confirm",
			s.rateLimit("receipt:parcelconfirm", 20, time.Hour), s.handleConfirmParcelReceipt)
		v1.GET("/parcels/:code/handoffs", s.authRequired(), s.handleListParcelHandoffs)
		v1.POST("/parcels/:code/claim", s.authRequired(), s.handleClaimParcel)
		// The unhappy-path exits (see handlers_parcel_delivery.go). All
		// custody-gated rather than capability-gated — whoever physically
		// holds the parcel is who can act on it.
		v1.POST("/parcels/:code/attempt", s.authRequired(), s.handleRecordDeliveryAttempt)
		v1.GET("/parcels/:code/attempts", s.authRequired(), s.handleListDeliveryAttempts)
		v1.POST("/parcels/:code/hold-at-agent", s.authRequired(), s.handleHoldParcelAtAgent)
		v1.POST("/parcels/:code/return", s.authRequired(), s.handleReturnParcel)
		v1.POST("/parcels/:code/pod-photo", s.authRequired(), s.handleUploadPodPhoto)
		// Deliberately NOT behind authRequired: the delivery photo is
		// read by whoever holds the tracking code, exactly like
		// /status — the sender and receiver are the two people who need
		// to see where their parcel was left, and the two people the
		// code was ever given to. The bytes are still served through the
		// handler (never a bucket URL) so this check is the only way in.
		v1.GET("/parcels/:code/pod-photo",
			s.rateLimit("track:parcelpod", 30, time.Hour), s.handleGetPodPhoto)
		// Deliberately NOT under /parcels/... — gin's router can't mix a
		// static "couriers" segment with the sibling :code wildcard at
		// the same position in the same method's tree (every other
		// /parcels/:code/... route above already claims that slot).
		v1.POST("/parcel-couriers/me/pings", s.authRequired(), s.handlePostCourierPing)
		v1.GET("/parcel-couriers/me/available-jobs", s.authRequired(), s.handleListAvailableJobs)
		v1.GET("/me/parcels", s.authRequired(), s.handleListMyParcels)
		v1.GET("/me/parcels/holding", s.authRequired(), s.handleListHeldParcels)
		v1.GET("/me/cod-holding", s.authRequired(), s.handleGetMyCodHolding)
		v1.GET("/me/courier-earnings", s.authRequired(), s.handleGetMyEarnings)

		v1.GET("/admin/parcels", s.authRequired(), s.handleAdminListParcels)
		v1.GET("/admin/parcels/stats", s.authRequired(), s.handleAdminParcelStats)
		v1.GET("/admin/parcels/collectors", s.authRequired(), s.handleAdminSearchCollectors)
		// Operational scan workflows live under their own static namespace;
		// this avoids colliding with the existing /admin/parcels/:id routes.
		v1.POST("/admin/parcel-ops/:code/intake", s.authRequired(), s.handleCaptureParcelIntake)
		v1.POST("/admin/parcel-ops/:code/reject", s.authRequired(), s.handleRejectParcelAtDropoff)
		v1.GET("/admin/parcel-ops/queue", s.authRequired(), s.handleListParcelOpsQueue)
		v1.POST("/admin/parcel-ops/shipments", s.authRequired(), s.handleCreateParcelShipment)
		v1.GET("/admin/parcel-ops/shipments/:id", s.authRequired(), s.handleGetParcelShipment)
		v1.POST("/admin/parcel-ops/shipments/:id/start", s.authRequired(), s.handleStartParcelShipment)
		v1.POST("/admin/parcel-ops/shipments/:id/load/:code", s.authRequired(), s.handleLoadParcelToShipment)
		v1.POST("/admin/parcel-ops/shipments/:id/offload/:code", s.authRequired(), s.handleOffloadParcelFromShipment)
		v1.POST("/admin/parcel-ops/shipments/:id/finish", s.authRequired(), s.handleFinishParcelShipment)
		v1.POST("/admin/parcel-ops/:code/pickup-reminder", s.authRequired(), s.handleSendPickupReminder)
		v1.POST("/admin/parcels/:id/assign", s.authRequired(), s.handleAssignParcelCollector)
		// Registered as a sibling of /admin/parcels rather than under
		// :id, for the same gin static-vs-param reason the courier
		// routes below already carry a comment about.
		v1.POST("/admin/parcels/bulk-assign", s.authRequired(), s.handleBulkAssignParcels)
		v1.POST("/admin/parcels/:id/cancel", s.authRequired(), s.handleCancelParcel)
		v1.POST("/admin/parcels/:id/refund", s.authRequired(), s.handleMarkParcelRefunded)
		v1.POST("/admin/parcels/:id/pay-cash", s.authRequired(), s.handleConfirmParcelCashPayment)
		v1.PATCH("/admin/parcels/:id", s.authRequired(), s.handleUpdateParcelDetails)
		v1.POST("/admin/parcels/:id/exception", s.authRequired(), s.handleFlagParcelException)
		v1.POST("/admin/parcels/:id/exception/clear", s.authRequired(), s.handleClearParcelException)
		v1.GET("/admin/parcels/:id/handoffs", s.authRequired(), s.handleAdminListParcelHandoffs)
		// The same three receiver-auth resolutions the company console
		// has, as a superset: admin can unstick any carrier's parcel,
		// including an Esoqo-operated one that has no company console to
		// act from. Keyed on the parcel uuid because the admin app works
		// in ids throughout.
		v1.POST("/admin/parcels/:id/receiver-auth/grant-retry",
			s.authRequired(), s.handleAdminGrantReceiverAuthRetry)
		v1.POST("/admin/parcels/:id/delivery-code/reissue",
			s.authRequired(), s.handleAdminReissueDeliveryCode)
		v1.POST("/admin/parcels/:id/courier-earnings/release",
			s.authRequired(), s.handleAdminReleaseHeldEarnings)

		v1.GET("/admin/parcels/couriers/candidates", s.authRequired(), s.handleAdminSearchOnboardCandidates)
		v1.GET("/admin/parcels/couriers", s.authRequired(), s.handleAdminListCouriers)
		v1.POST("/admin/parcels/couriers", s.authRequired(), s.handleOnboardCourier)
		// A sibling of /admin/parcels/couriers, not nested under it —
		// couriers/:id/status below already claims that tree position
		// for POST, and gin's router panics on a static segment and a
		// param segment sharing one (see this file's other comment on
		// the near-identical /parcels/labels/generate vs
		// /parcels/labels/info/:code clash).
		v1.POST("/admin/parcels/courier-team", s.authRequired(), s.handleAdminAddCourier)
		v1.POST("/admin/parcels/couriers/:id/status", s.authRequired(), s.handleSetCourierStatus)
		v1.GET("/admin/parcels/couriers/:id/performance", s.authRequired(), s.handleGetCourierPerformance)

		// Courier teams — a dispatch-planning layer on top of the
		// individual-courier routes above (see handlers_courier_teams.go).
		// "courier-teams" (plural), not "courier-team" — that singular
		// path above is a different, older action (AdminAddCourier);
		// kept apart rather than reusing to avoid conflating the two.
		v1.POST("/admin/parcels/courier-teams", s.authRequired(), s.handleCreateCourierTeam)
		v1.GET("/admin/parcels/courier-teams", s.authRequired(), s.handleListCourierTeams)
		v1.GET("/admin/parcels/courier-teams/:id", s.authRequired(), s.handleGetCourierTeam)
		v1.PATCH("/admin/parcels/courier-teams/:id", s.authRequired(), s.handleUpdateCourierTeam)
		v1.POST("/admin/parcels/courier-teams/:id/members", s.authRequired(), s.handleAddCourierTeamMember)
		v1.PATCH("/admin/parcels/courier-teams/:id/members/:partyId", s.authRequired(), s.handleUpdateCourierTeamMember)
		v1.POST("/admin/parcels/courier-teams/:id/fleets", s.authRequired(), s.handleAddCourierFleet)
		v1.POST("/admin/parcels/fleets/:id/assign", s.authRequired(), s.handleAssignParcelsToFleet)
		// The scan confirmation assignment alone never had — see
		// dbx.BoardParcelOntoTrip's own comment.
		v1.POST("/admin/parcels/trips/:id/board", s.authRequired(), s.handleBoardParcelOntoTrip)
		v1.POST("/admin/parcels/trips/:id/checked", s.authRequired(), s.handleCheckTripDispatched)
		v1.POST("/admin/parcels/trips/:id/complete", s.authRequired(), s.handleCompleteCourierTrip)
		// The dispatcher's printed run sheet. Sibling of the crew-only
		// /parcels/trips/:tripId/manifest — see that handler on why the
		// two authorise separately rather than one widening.
		v1.GET("/admin/parcels/trips/:id/manifest", s.authRequired(), s.handleAdminGetTripManifest)

		v1.GET("/admin/parcels/zones", s.authRequired(), s.handleAdminListParcelZones)
		v1.POST("/admin/parcels/zones", s.authRequired(), s.handleAdminCreateParcelZone)
		v1.PATCH("/admin/parcels/zones/:id", s.authRequired(), s.handleAdminUpdateParcelZone)
		// Esoqo admin onboarding the courier companies themselves, and
		// seeding each one's first manager so somebody there can sign in
		// and create the rest of the team.
		v1.GET("/admin/parcels/orgs", s.authRequired(), s.handleAdminListParcelOrgs)
		v1.GET("/admin/parcels/orgs/:id", s.authRequired(), s.handleAdminGetParcelOrg)
		v1.GET("/admin/parcels/enterprises", s.authRequired(), s.handleAdminSearchEnterprises)
		v1.POST("/admin/parcels/enterprises", s.authRequired(), s.handleAdminCreateEnterprise)
		// People picker for a company's team — "add an existing person".
		v1.GET("/admin/parcels/people", s.authRequired(), s.handleAdminSearchPeople)
		v1.POST("/admin/parcels/orgs", s.authRequired(), s.handleAdminCreateParcelOrg)
		v1.POST("/admin/parcels/:id/org", s.authRequired(), s.handleAdminAssignParcelOrg)
		v1.PATCH("/admin/parcels/orgs/:id", s.authRequired(), s.handleAdminUpdateParcelOrg)
		v1.GET("/admin/parcels/orgs/:id/staff", s.authRequired(), s.handleAdminListParcelOrgStaff)
		// Payouts no automatic rail could clear — bank destinations (no
		// disbursement integration yet) and anything stuck FAILED long
		// enough that finance should look rather than let the retry
		// worker keep trying.
		v1.GET("/admin/parcels/payouts/manual", s.authRequired(), s.handleAdminListManualParcelOrgPayouts)
		v1.POST("/admin/parcels/payouts/:id/mark-paid", s.authRequired(), s.handleAdminMarkParcelOrgPayoutPaid)
		v1.POST("/admin/parcels/orgs/:id/staff", s.authRequired(), s.handleAdminUpsertParcelOrgStaff)
		v1.POST("/admin/parcels/orgs/:id/staff/:staffId/issue-id", s.authRequired(), s.handleAdminIssueParcelOrgStaffID)
		// Pickup points and the coverage rate card — siblings of zones
		// above, same parcels.read/parcels.edit split.
		v1.GET("/admin/parcels/agents", s.authRequired(), s.handleAdminListParcelAgents)
		v1.POST("/admin/parcels/agents", s.authRequired(), s.handleAdminCreateParcelAgent)
		v1.PATCH("/admin/parcels/agents/:id", s.authRequired(), s.handleAdminUpdateParcelAgent)
		v1.GET("/admin/parcels/couriers/owed", s.authRequired(), s.handleAdminListCouriersOwed)
		v1.POST("/admin/parcels/couriers/payout", s.authRequired(), s.handleAdminPayCourier)
		v1.GET("/admin/parcels/couriers/tariff", s.authRequired(), s.handleAdminGetCourierTariff)
		v1.POST("/admin/parcels/couriers/tariff", s.authRequired(), s.handleAdminSetCourierTariff)
		v1.GET("/admin/parcels/cod/policy", s.authRequired(), s.handleAdminGetCodPolicy)
		v1.POST("/admin/parcels/cod/policy", s.authRequired(), s.handleAdminSetCodPolicy)
		v1.POST("/admin/parcels/cod/remit", s.authRequired(), s.handleAdminRemitCod)
		v1.GET("/admin/parcels/cod/sellers", s.authRequired(), s.handleAdminListSellersOwedCod)
		v1.POST("/admin/parcels/cod/settle", s.authRequired(), s.handleAdminSettleSellerCod)
		v1.GET("/admin/parcels/coverage", s.authRequired(), s.handleAdminListCoverageTiers)
		v1.POST("/admin/parcels/coverage", s.authRequired(), s.handleAdminUpsertCoverageTier)
		v1.GET("/admin/parcels/distance-rate", s.authRequired(), s.handleAdminGetDistanceRate)
		v1.POST("/admin/parcels/distance-rate", s.authRequired(), s.handleAdminSetDistanceRate)
		v1.GET("/admin/parcels/live", s.authRequired(), s.handleAdminGetLiveDispatch)

		v1.POST("/admin/parcels/labels/generate", s.authRequired(), s.handleAdminGenerateParcelLabels)
		v1.GET("/admin/parcels/labels", s.authRequired(), s.handleAdminListParcelLabelStock)
		// info/:code, not :code/info — gin's router panics on a static
		// segment ("generate") and a param segment (":code") sharing
		// the same tree position (see this file's own comment on the
		// near-identical /me/parcels vs /parcels/:code clash above).
		// Putting the static "info" segment first avoids the conflict.
		v1.POST("/admin/parcels/labels/info/:code", s.authRequired(), s.handleAttachParcelLabelInfo)
		// The read half — an edit form has to load before it saves,
		// because the POST above overwrites rather than merges.
		v1.GET("/admin/parcels/labels/info/:code", s.authRequired(), s.handleGetParcelLabelInfo)
		// Batches — the pads rather than the stickers. Static
		// "batches" segment sits alongside "generate" and "info" under
		// labels/, all three static, so no wildcard collision.
		// The counter's address book, derived from past parcels.
		v1.GET("/admin/parcels/parties", s.authRequired(), s.handleAdminSearchCounterParties)
		v1.GET("/admin/parcels/labels/register", s.authRequired(), s.handleAdminListParcelLabelRegister)
		v1.GET("/admin/parcels/labels/batches", s.authRequired(), s.handleAdminListParcelLabelBatches)
		v1.GET("/admin/parcels/routes", s.authRequired(), s.handleAdminListParcelRoutes)
		v1.POST("/admin/parcels/labels/void", s.authRequired(), s.handleVoidParcelLabels)
		v1.POST("/admin/parcels/labels/batches/:id/void", s.authRequired(), s.handleVoidParcelLabelBatch)
		v1.DELETE("/admin/parcels/labels", s.authRequired(), s.handleDeleteParcelLabels)
		v1.DELETE("/admin/parcels/labels/batches/:id", s.authRequired(), s.handleDeleteParcelLabelBatch)
	}

	// Two routes, one handler. Daraja publishes no signature, HMAC or
	// documented source-IP range, so the callback is authenticated by
	// being at a URL only Safaricom was ever handed: MPESA_CALLBACK_URL
	// ends in MPESA_CALLBACK_SECRET. The bare path stays registered so a
	// callback that arrives without it can be logged and rejected rather
	// than silently 404ing — and so console/dev setups keep working.
	r.POST("/webhooks/mpesa/stk-callback", s.handleMpesaStkCallback)
	r.POST("/webhooks/mpesa/stk-callback/:token", s.handleMpesaStkCallback)

	// Result callbacks for courier-partner payouts (dispatchParcelOrgPayout) —
	// same bare-path-stays-registered reasoning as the STK callback above.
	r.POST("/webhooks/mpesa/b2c-result", s.handleMpesaB2CResultCallback)
	r.POST("/webhooks/mpesa/b2c-result/:token", s.handleMpesaB2CResultCallback)
	r.POST("/webhooks/mpesa/b2b-result", s.handleMpesaB2BResultCallback)
	r.POST("/webhooks/mpesa/b2b-result/:token", s.handleMpesaB2BResultCallback)

	return r
}

// corsMiddleware exists only for the Flutter *web* target — native
// iOS/Android builds never send an Origin header, so CORS is a no-op for
// them either way. Dev defaults to allowing any origin (this is a
// mobile-first API with no cookies to leak — the bearer token lives in
// the client's own storage, not an ambient credential a hostile page
// could ride on); production requires CORS_ALLOWED_ORIGINS to be set
// explicitly, same dev-safe-by-default pattern as the SMS/M-Pesa
// provider gating elsewhere in this service.
func (s *Server) corsMiddleware() gin.HandlerFunc {
	origins := s.Cfg.CORSAllowedOrigins
	if len(origins) == 0 {
		if config.CurrentAppEnv() == config.AppEnvDevelopment {
			origins = []string{"*"}
		} else {
			return func(c *gin.Context) { c.Next() } // no cross-origin access until configured
		}
	}
	cfg := cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PATCH", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: false, // bearer token, not a cookie — nothing ambient to protect
		MaxAge:           12 * time.Hour,
	}
	if len(origins) == 1 && origins[0] == "*" {
		cfg.AllowOrigins = nil
		cfg.AllowAllOrigins = true
	}
	return cors.New(cfg)
}

// requestLogger emits one line per request.
//
// This returned an empty string for the whole of Phase 0, which meant
// core-go logged nothing at all: no way to see a spike of 401s, a
// payment route erroring, or which endpoint was slow during an outage.
// Diagnosing production without it means guessing.
//
// Deliberately excluded: query strings and request bodies. Those carry
// OTP codes, PINs and MSISDNs on exactly the routes most worth logging,
// and platform logs are broadly readable and long-retained. The path,
// status, latency and a masked client address answer the operational
// questions without turning the log into a credential store.
// Hand-rolled rather than gin.LoggerWithFormatter: that formatter's
// Path field is the raw request URI, query string and all, so using it
// would write OTP codes, PINs and parcel codes straight into the log.
// c.FullPath() is the matched route pattern ("/v1/parcels/:code/pay"),
// which is what an operator actually needs.
func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "(no route)" // 404s — never echo the URI the caller sent
		}

		fmt.Fprintf(gin.DefaultWriter, "%s %s %d %s %s%s\n",
			start.UTC().Format(time.RFC3339),
			c.Request.Method,
			c.Writer.Status(),
			time.Since(start).Round(time.Millisecond),
			route,
			errorNote(c.Errors.ByType(gin.ErrorTypePrivate).String()),
		)
	}
}

func errorNote(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return ""
	}
	return " err=" + strings.ReplaceAll(msg, "\n", " ")
}

// clientIP resolves the caller's address for rate limiting and audit.
//
// Gin's own ClientIP trusts every proxy by default, which means it hands
// back X-Forwarded-For[0] — a value the caller chose. Any per-IP limit
// built on that is no limit at all: rotate the header, get a fresh
// bucket. SetTrustedProxies(nil) in Router() turns that off, so
// c.ClientIP() is now the direct peer (the platform edge), and the real
// client is read here from the right of the chain instead.
//
// TrustedProxyHops says how many entries were appended by infrastructure
// we control; counting from the right skips anything prepended by the
// caller. Returns "" when nothing can be trusted — callers treat that as
// "no IP dimension", never as a shared bucket everyone falls into.
func clientIP(c *gin.Context) string {
	hops := trustedProxyHops.Load()

	if xff := c.GetHeader("X-Forwarded-For"); xff != "" && hops > 0 {
		parts := strings.Split(xff, ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		if idx := len(parts) - int(hops); idx >= 0 && idx < len(parts) {
			if net.ParseIP(parts[idx]) != nil {
				return parts[idx]
			}
		}
		return ""
	}

	// Deliberately RemoteAddr and not c.ClientIP(): the latter is only
	// header-safe because Router() called SetTrustedProxies(nil), and
	// this function must not silently start trusting X-Forwarded-For
	// again if it is ever reached from an engine built without that.
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		host = c.Request.RemoteAddr
	}
	if net.ParseIP(host) == nil {
		return ""
	}
	return host
}

func writeError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

// requireMsisdn / optionalMsisdn — rewrite a just-bound request field to
// E.164 before anything downstream sees it.
//
// Normalisation belongs HERE, at the boundary, rather than in each
// client. Esoqo is a Kenya-only product and a Kenyan writes their
// number "0712345678"; demanding "+254712345678" is asking the user to
// know an implementation detail of our database. Doing it server-side
// means every client — web, admin, the Flutter app, anything built
// later — gets local-format input for free and, more importantly, that
// no client can invent its own idea of what a phone number looks like.
//
// That last part is the real reason this is not merely cosmetic:
// identity in Esoqo IS the msisdn (see the phone package), so a client
// that posted "0712345678" raw would create a second Person for someone
// who already exists, and send their OTP somewhere the gateway can't
// route.
//
// Both report whether the handler may continue, and write the error
// response themselves when not — same `if !ok { return }` shape the
// capability guards in this package already use.
func requireMsisdn(c *gin.Context, field *string, label string) bool {
	if phone.NormaliseInPlace(field) {
		return true
	}
	writeError(c, http.StatusBadRequest, "INVALID_MSISDN",
		label+" doesn't look like a Kenyan mobile number")
	return false
}

func optionalMsisdn(c *gin.Context, field **string, label string) bool {
	if phone.NormaliseOptional(field) {
		return true
	}
	writeError(c, http.StatusBadRequest, "INVALID_MSISDN",
		label+" doesn't look like a Kenyan mobile number")
	return false
}

// optionalMsisdnString — for a plain string field with no
// binding:"required" tag, where "" genuinely means "not supplied"
// (payParcelRequest.Msisdn is only meaningful for MPESA_STK; a
// voucher's recipient may be filled in later). Empty passes; anything
// actually typed still has to be a real number.
func optionalMsisdnString(c *gin.Context, field *string, label string) bool {
	if field == nil || strings.TrimSpace(*field) == "" {
		return true
	}
	return requireMsisdn(c, field, label)
}

// parseKES parses one of this package's own "%.2f"-formatted KES
// strings (see dbx.CreateStoreOrder/CreateBooking) back into a float
// for the STK push amount. Never fed anything but our own output, so a
// parse failure here is a bug, not user input — hence the 0 fallback
// rather than plumbing an error through every caller.
func parseKES(s string) float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}
