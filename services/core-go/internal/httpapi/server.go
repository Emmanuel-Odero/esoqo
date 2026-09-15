// Package httpapi is the Gin HTTP layer: router wiring, middleware, and
// the Phase 0 auth handlers (OTP, PIN sign-in, session, /me).
package httpapi

import (
	"fmt"
	"net"
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
	"github.com/esoqo/core-go/internal/storage"
)

type Server struct {
	Cfg     config.Config
	Pool    *pgxpool.Pool
	Redis   *redis.Client
	OTP     *authsvc.OtpService
	Session *authsvc.SessionService
	OrgCtx  *authsvc.OrgContextService

	// StaffLockout bounds PIN guesses on ticket-staff sign-in, which has
	// no per-account failure column of its own.
	StaffLockout *authsvc.Lockout

	// Storage backs field-captured images — today, proof-of-delivery
	// photos. See internal/storage for why the provider gating mirrors
	// packages/db/src/storage.ts exactly rather than inventing a second
	// policy for this side.
	Storage storage.Store
}

func NewServer(cfg config.Config, pool *pgxpool.Pool, rdb *redis.Client) *Server {
	return &Server{
		Cfg:     cfg,
		Pool:    pool,
		Redis:   rdb,
		OTP:     authsvc.NewOtpService(rdb, cfg.OTPPepper, cfg.OTPDailySpendCapKES, cfg.OTPRateLimitPerHour),
		Session: authsvc.NewSessionService(rdb),
		OrgCtx:  authsvc.NewOrgContextService(rdb, time.Duration(cfg.OrgContextActivationDays)*24*time.Hour),
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
		v1.GET("/orders/:id", s.handleGetOrder)
		v1.GET("/me/orders", s.authRequired(), s.handleListMyOrders)
		v1.GET("/me/saved-stores", s.authRequired(), s.handleListSavedStores)
		v1.POST("/me/saved-stores/:storeId", s.authRequired(), s.handleSaveStore)
		v1.DELETE("/me/saved-stores/:storeId", s.authRequired(), s.handleUnsaveStore)
		v1.POST("/stores/orders/:id/ready", s.authRequired(), s.handleMarkOrderReady)
		v1.POST("/stores/orders/:id/collect", s.authRequired(), s.handleConfirmOrderCollected)
		v1.POST("/stores/orders/:id/dine-in-status", s.authRequired(), s.handleUpdateDineInStatus)
		v1.POST("/orders/:id/tip", s.handleAddTip)
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
		v1.GET("/bookings/:id", s.handleGetBooking)
		v1.GET("/me/tickets", s.authRequired(), s.handleListMyBookings)
		v1.GET("/me/orgs", s.authRequired(), s.handleListMyOrgs)
		v1.GET("/me/org-grants", s.authRequired(), s.handleListMyOrgGrants)
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
		v1.GET("/bookings/:id/status", s.handleGetBookingStatus)
		v1.GET("/bookings/:id/balance-view", s.handleGetBookingBalanceView)
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
		v1.POST("/fleet/trips/:id/declare", s.authRequired(), s.handleDeclare)
		v1.GET("/fleet/trips/:id/collections", s.authRequired(), s.handleTripCollections)
		v1.GET("/fleet/my-trip", s.authRequired(), s.handleMyActiveTrip)

		v1.POST("/fares", s.rateLimit("pay:fare", 40, time.Hour), s.handleCreateFare)
		v1.GET("/fares/:id", s.handleGetFare)
		v1.GET("/fares/:id/status", s.handleFareStatus)
		v1.POST("/fares/verify", s.authRequired(), s.handleVerifyFare)
		v1.GET("/trips/resolve", s.handleResolveTrip)
		v1.GET("/scan/resolve", s.handleResolveScan)
		v1.GET("/fleet/trips/:id/qr", s.authRequired(), s.handleTripQr)
		v1.GET("/me/fares", s.authRequired(), s.handleListMyFares)

		v1.POST("/vouchers", s.authRequired(), s.handleCreateVoucher)
		v1.POST("/vouchers/:id/load", s.rateLimit("pay:voucherload", 30, time.Hour), s.authRequired(), s.handleLoadVoucher)
		v1.GET("/vouchers/:id/status", s.authRequired(), s.handleVoucherStatus)
		v1.GET("/vouchers/resolve", s.handleResolveVoucher)
		v1.GET("/me/vouchers", s.authRequired(), s.handleListMyVouchers)
		v1.POST("/vouchers/:id/freeze", s.authRequired(), s.handleFreezeVoucher)
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

		v1.POST("/parcels", s.handleBookParcel)
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
		v1.POST("/parcels/:code/cod", s.handleSetParcelCod)
		v1.POST("/parcels/:code/cod/confirm", s.handleConfirmParcelCodBooking)
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
		v1.GET("/parcel-orgs/me/parcels", s.authRequired(), s.handleListMyOrgParcels)
		v1.POST("/parcel-orgs/me/parcels/:code/assign", s.authRequired(), s.handleAssignOrgParcel)
		v1.POST("/parcel-orgs/me/cod/remit", s.authRequired(), s.handleOrgRemitCod)
		// A company's own label stock — minting, the register, and
		// withdrawing a stolen pad, all scoped to the session's org.
		// "batches" is static and sits above :id, same shape as the
		// admin-side label routes.
		v1.POST("/parcel-orgs/me/labels/generate", s.authRequired(), s.handleOrgGenerateLabels)
		v1.GET("/parcel-orgs/me/labels", s.authRequired(), s.handleOrgListLabelRegister)
		v1.GET("/parcel-orgs/me/labels/batches", s.authRequired(), s.handleOrgListLabelBatches)
		v1.POST("/parcel-orgs/me/labels/batches/:id/void", s.authRequired(), s.handleOrgVoidLabelBatch)
		v1.GET("/parcel-orgs/me/staff", s.authRequired(), s.handleListMyOrgStaff)
		v1.POST("/parcel-orgs/me/staff", s.authRequired(), s.handleUpsertMyOrgStaff)
		v1.POST("/parcels/:code/price", s.handleSetParcelPrice)
		v1.POST("/parcels/:code/pay", s.rateLimit("pay:parcel", 30, time.Hour), s.handlePayParcel)
		v1.GET("/parcels/:code/status", s.handleGetParcelStatus)
		// Public and code-gated like /status above — the live position
		// is deliberately anonymous (see dbx.CourierPosition).
		v1.GET("/parcels/:code/position", s.handleGetParcelCourierPosition)
		v1.GET("/parcels/:code/label", s.authRequired(), s.handleGetParcelLabel)
		v1.POST("/parcels/:code/handoff", s.authRequired(), s.handleScanParcelHandoff)
		v1.POST("/parcels/:code/deliver", s.authRequired(), s.handleDeliverParcel)
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
		v1.POST("/parcels/:code/receipt/otp", s.handleRequestParcelReceiptOtp)
		v1.POST("/parcels/:code/receipt/confirm", s.handleConfirmParcelReceipt)
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
		v1.GET("/parcels/:code/pod-photo", s.handleGetPodPhoto)
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
		v1.POST("/admin/parcels/:id/assign", s.authRequired(), s.handleAssignParcelCollector)
		// Registered as a sibling of /admin/parcels rather than under
		// :id, for the same gin static-vs-param reason the courier
		// routes below already carry a comment about.
		v1.POST("/admin/parcels/bulk-assign", s.authRequired(), s.handleBulkAssignParcels)
		v1.POST("/admin/parcels/:id/cancel", s.authRequired(), s.handleCancelParcel)
		v1.POST("/admin/parcels/:id/refund", s.authRequired(), s.handleMarkParcelRefunded)
		v1.PATCH("/admin/parcels/:id", s.authRequired(), s.handleUpdateParcelDetails)
		v1.POST("/admin/parcels/:id/exception", s.authRequired(), s.handleFlagParcelException)
		v1.POST("/admin/parcels/:id/exception/clear", s.authRequired(), s.handleClearParcelException)
		v1.GET("/admin/parcels/:id/handoffs", s.authRequired(), s.handleAdminListParcelHandoffs)

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
		v1.GET("/admin/parcels/enterprises", s.authRequired(), s.handleAdminSearchEnterprises)
		v1.POST("/admin/parcels/orgs", s.authRequired(), s.handleAdminCreateParcelOrg)
		v1.POST("/admin/parcels/:id/org", s.authRequired(), s.handleAdminAssignParcelOrg)
		v1.PATCH("/admin/parcels/orgs/:id", s.authRequired(), s.handleAdminUpdateParcelOrg)
		v1.GET("/admin/parcels/orgs/:id/staff", s.authRequired(), s.handleAdminListParcelOrgStaff)
		v1.POST("/admin/parcels/orgs/:id/staff", s.authRequired(), s.handleAdminUpsertParcelOrgStaff)
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
		v1.POST("/admin/parcels/labels/batches/:id/void", s.authRequired(), s.handleVoidParcelLabelBatch)
	}

	// Two routes, one handler. Daraja publishes no signature, HMAC or
	// documented source-IP range, so the callback is authenticated by
	// being at a URL only Safaricom was ever handed: MPESA_CALLBACK_URL
	// ends in MPESA_CALLBACK_SECRET. The bare path stays registered so a
	// callback that arrives without it can be logged and rejected rather
	// than silently 404ing — and so console/dev setups keep working.
	r.POST("/webhooks/mpesa/stk-callback", s.handleMpesaStkCallback)
	r.POST("/webhooks/mpesa/stk-callback/:token", s.handleMpesaStkCallback)

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
