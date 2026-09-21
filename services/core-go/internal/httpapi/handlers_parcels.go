package httpapi

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/fleetqr"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/notify"
	"github.com/esoqo/core-go/internal/payments"
)

type bookParcelRequest struct {
	SenderName        string   `json:"senderName" binding:"required"`
	SenderMsisdn      string   `json:"senderMsisdn" binding:"required"`
	ReceiverName      string   `json:"receiverName" binding:"required"`
	ReceiverMsisdn    string   `json:"receiverMsisdn" binding:"required"`
	OriginLabel       string   `json:"originLabel" binding:"required"`
	DestinationLabel  string   `json:"destinationLabel" binding:"required"`
	Notes             *string  `json:"notes"`
	ParcelType        string   `json:"parcelType" binding:"required"`
	WeightKg          *float64 `json:"weightKg"`
	Fragile           bool     `json:"fragile"`
	OriginZoneID      *string  `json:"originZoneId"`
	DestinationZoneID *string  `json:"destinationZoneId"`
	// ExistingCode — a code already printed and stuck on the physical
	// parcel ahead of time (see dbx.ParcelLabelStock). Optional; when
	// omitted BookParcel mints a fresh code as before.
	ExistingCode *string `json:"existingCode"`

	// DestinationAgentID — the pickup point the receiver collects from
	// instead of a doorstep delivery, which earns the rate card's
	// agentDropDiscountPct. Optional; nil keeps the doorstep default.
	DestinationAgentID *string `json:"destinationAgentId"`
	// DeclaredValueKes/CoverageTierID — declared contents value and the
	// cover bought against it. Validated together by dbx.BookParcel.
	DeclaredValueKes *money.Amount `json:"declaredValueKes"`
	CoverageTierID   *string       `json:"coverageTierId"`
	// ParcelOrgID — the courier company the sender chose to carry this,
	// when the booking surface offers a choice. Omitted means
	// Esoqo-operated dispatch on the platform rate card, which is how
	// every booking worked before tenancy and still the default; a
	// parcel can also be handed to a company later (see
	// handleAdminAssignParcelOrg).
	ParcelOrgID *string `json:"parcelOrgId"`
	// OriginMethod — "SCHEDULED_PICKUP" (default) or "SELF_DROPOFF", when
	// the booking surface offers a walk-in choice (see
	// GET /v1/parcels/stations). Empty means the historical default.
	OriginMethod string `json:"originMethod"`
	// PayAtCounter — see dbx.BookParcelInput's own comment. No online
	// price or payment for this booking; settled in person, whichever
	// origin method it was booked with.
	PayAtCounter bool `json:"payAtCounter"`

	// LengthCm/WidthCm/HeightCm — measured at a counter, for the
	// volumetric weight a bulky parcel is charged on. All three or none.
	LengthCm *float64 `json:"lengthCm"`
	WidthCm  *float64 `json:"widthCm"`
	HeightCm *float64 `json:"heightCm"`
	// ContentsDeclared — the clerk asked about prohibited contents and
	// the sender said no. Only honoured for a staff session: a
	// self-service booking cannot attest that a person asked a
	// question, and a declaration nobody made is worse than none at all.
	ContentsDeclared bool `json:"contentsDeclared"`

	// The SENDER's own declaration, which anyone may make — including a
	// guest, unlike ContentsDeclared directly above.
	//
	// The two are not the same claim and are deliberately not merged.
	// ContentsDeclared says a named member of staff asked a person, face
	// to face, whether the box holds anything prohibited; a web form can
	// never produce that, which is why it stays staff-only. These say
	// the sender described the contents, put a value on them, and ticked
	// that they are lawful and that both sets of terms are accepted.
	// Weaker, and worth recording precisely because the alternative on a
	// self-service booking was recording nothing at all.
	//
	// TermsVersion is what the client actually displayed. Trusted from
	// the body on purpose — the server cannot know which wording a page
	// rendered, and a version invented here would describe the
	// deployment rather than the agreement. Bounded, so a client cannot
	// park an essay in the column.
	SenderDeclaredContents *string `json:"senderDeclaredContents"`
	LawfulContentsAttested bool    `json:"lawfulContentsAttested"`
	TermsAccepted          bool    `json:"termsAccepted"`
	TermsVersion           *string `json:"termsVersion"`
	CarrierTermsVersion    *string `json:"carrierTermsVersion"`

	// A dropped pin for either end. ~80% of Kenyans have no formal
	// address and addressing failure is this market's largest cause of
	// delivery failure — a pin is what a courier's maps app can actually
	// route to, where the free-text label is prose a human reads.
	OriginLat      *float64 `json:"originLat"`
	OriginLng      *float64 `json:"originLng"`
	DestinationLat *float64 `json:"destinationLat"`
	DestinationLng *float64 `json:"destinationLng"`
}

// trimPtr normalises an optional free-text field: whitespace off, nil
// if nothing is left, truncated to max.
//
// Truncation rather than rejection because none of the fields it
// guards is worth failing a booking over — a sender who pasted a
// paragraph into "what's inside" should get their parcel booked with
// the first 500 characters, not an error they have to puzzle out at a
// counter.
func trimPtr(s *string, max int) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil
	}
	if len(v) > max {
		v = v[:max]
	}
	return &v
}

// handleBookParcel — POST /v1/parcels. Guest-or-authenticated, same
// pattern handleCreateOrder uses: a signed-in sender's partyId comes
// from the session, a guest supplies name+phone directly. Starts as
// DRAFT_PENDING_PAYMENT — the caller still needs handleSetParcelPrice
// then handlePayParcel before this is a real, BOOKED parcel.
func (s *Server) handleBookParcel(c *gin.Context) {
	var req bookParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.SenderMsisdn, "The sender's phone number") {
		return
	}
	if !requireMsisdn(c, &req.ReceiverMsisdn, "The receiver's phone number") {
		return
	}
	var senderPartyID *string
	// Binder identity comes from the session, never the body — see
	// BookParcelInput.BinderOrgID on why req.ParcelOrgID cannot gate
	// anything. A guest booking leaves both nil, which can only bind
	// unowned stock.
	var binderOrgID *string
	var binderIsPlatformStaff bool
	// Only a real staff session can attest that somebody asked the
	// prohibited-contents question — see the request field's comment.
	var contentsDeclaredByStaffID *string
	if token := bearerToken(c); token != "" {
		if ctx, _ := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c)); ctx != nil {
			if ctx.PartyID != "" {
				senderPartyID = &ctx.PartyID
			}
			if ctx.ParcelOrgID != "" {
				orgID := ctx.ParcelOrgID
				binderOrgID = &orgID
			}
			binderIsPlatformStaff = authsvc.Can(*ctx, "parcels.assign", nil)
			if req.ContentsDeclared && ctx.ActorID != "" {
				id := ctx.ActorID
				contentsDeclaredByStaffID = &id
			}
		}
	}
	parcelID, code, deliveryCode, serviceTicketNumber, err := dbx.BookParcel(c.Request.Context(), s.Pool, dbx.BookParcelInput{
		SenderPartyID: senderPartyID, SenderName: req.SenderName, SenderMsisdn: req.SenderMsisdn,
		ReceiverName: req.ReceiverName, ReceiverMsisdn: req.ReceiverMsisdn,
		OriginLabel: req.OriginLabel, DestinationLabel: req.DestinationLabel, Notes: req.Notes,
		ParcelType: req.ParcelType, WeightKg: req.WeightKg, Fragile: req.Fragile,
		OriginZoneID: req.OriginZoneID, DestinationZoneID: req.DestinationZoneID,
		ExistingCode:       req.ExistingCode,
		DestinationAgentID: req.DestinationAgentID,
		DeclaredValueKes:   req.DeclaredValueKes.KESPtr(), CoverageTierID: req.CoverageTierID,
		ParcelOrgID: req.ParcelOrgID, OriginMethod: req.OriginMethod, PayAtCounter: req.PayAtCounter,
		BinderOrgID: binderOrgID, BinderIsPlatformStaff: binderIsPlatformStaff,
		LengthCm: req.LengthCm, WidthCm: req.WidthCm, HeightCm: req.HeightCm,
		ContentsDeclaredByStaffID: contentsDeclaredByStaffID,
		SenderDeclaredContents:    trimPtr(req.SenderDeclaredContents, 500),
		LawfulContentsAttested:    req.LawfulContentsAttested,
		TermsAccepted:             req.TermsAccepted,
		TermsVersion:              trimPtr(req.TermsVersion, 40),
		CarrierTermsVersion:       trimPtr(req.CarrierTermsVersion, 40),
	})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	// Public parcel bookings need the real tracking code immediately so the
	// sender can track the parcel, share the link, and hand the receiver a
	// consistent reference. The service ticket remains available as a
	// secondary operational identifier for counter workflows, but it is no
	// longer the front-door code customers rely on.
	respCode := code
	status := "DRAFT_PENDING_PAYMENT"
	if req.PayAtCounter {
		status = "BOOKED"
	}
	c.JSON(http.StatusOK, gin.H{
		"parcelId": parcelID, "code": respCode, "serviceTicketNumber": serviceTicketNumber,
		"deliveryCode": deliveryCode, "status": status,
	})
}

// handleConfirmParcelIntake — retired. This duplicated
// handleScanParcelHandoff's own "clerk confirms the box is physically
// here" moment (see dbx.ConfirmParcelIntake, still present but unused —
// left alone as a schema-adjacent function, not deleted) as a second,
// never-wired-up path with its own message pair. The Front Desk UI
// (apps/app's parcel-org counter page) already calls the real thing:
// POST /v1/parcels/:code/handoff, which now carries this same message
// pair — see notify.ParcelIntakeConfirmed's own callers there.

type settleCounterParcelRequest struct {
	PriceKes float64 `json:"priceKes" binding:"required"`
}

// handleSettleCounterParcel — POST /v1/parcels/:code/settle-counter.
// The clerk or rider recording the fare they just took in cash for a
// PAY_AT_COUNTER parcel. See dbx.SettleCounterParcel for why this
// endpoint had to exist at all: without it, every walk-in and every
// pay-on-collection parcel stayed priceless and unpaid forever.
//
// CapParcelOrgCarry, the rider tier, deliberately — BookParcelInput's
// own comment on PayAtCounter says a scheduled pickup "settles with the
// courier who collects it", so gating this at the dispatcher tier would
// lock out the person actually holding the money. It's the same tier
// that already collects cash on delivery (see handleRecordCodCollection).
//
// Esoqo staff settling an Esoqo-operated counter parcel come through
// the same endpoint with a nil org scope — the capability is the
// narrowing there, rather than a tenancy match.
func (s *Server) handleSettleCounterParcel(c *gin.Context) {
	var req settleCounterParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)

	var orgScope *string
	switch {
	case ctx.ParcelOrgID != "":
		if err := authsvc.RequireCapability(ctx, authsvc.CapParcelOrgCarry, nil); err != nil {
			writeError(c, http.StatusForbidden, "DENIED", "Your role doesn't allow taking payment")
			return
		}
		orgID := ctx.ParcelOrgID
		orgScope = &orgID
	case authsvc.Can(ctx, "parcels.edit", nil):
		// Esoqo ops — no tenancy narrowing to apply.
	default:
		writeError(c, http.StatusForbidden, "DENIED", "Not permitted to settle a parcel")
		return
	}

	if err := dbx.SettleCounterParcel(c.Request.Context(), s.Pool, c.Param("code"), req.PriceKes, orgScope); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"settled": true})
}

// handleGetParcelPricing — GET /v1/parcels/pricing?parcelType=. Public
// — the sender needs to see the price band and bargain options before
// they've booked, let alone signed in. With no parcelType, returns
// every type's pricing at once — what the booking form's parcel-type
// dropdown needs to show each option's own weight/price range, and to
// match an entered weight to a bracket client-side without a round
// trip per keystroke.
func (s *Server) handleGetParcelPricing(c *gin.Context) {
	if parcelType := c.Query("parcelType"); parcelType != "" {
		// Every optional modifier is a query param so this stays a pure,
		// cacheable read that a booking form can call on every edit —
		// which is the whole point: the sender now sees a real price
		// while filling the form in, instead of a DRAFT_PENDING_PAYMENT
		// row being written to the database just to find out what
		// something costs. That old ordering is what produced the
		// abandoned-draft backlog the admin console has a KPI for.
		var originZoneID, destinationZoneID, parcelOrgID *string
		if v := c.Query("originZoneId"); v != "" {
			originZoneID = &v
		}
		if v := c.Query("destinationZoneId"); v != "" {
			destinationZoneID = &v
		}
		// Which courier company's rate card to quote against. Absent
		// means Esoqo-operated dispatch and the platform default — the
		// behaviour every caller had before tenancy existed.
		if v := c.Query("parcelOrgId"); v != "" {
			parcelOrgID = &v
		}

		// Cover is quoted here rather than assumed zero so the number on
		// the form is the number the server will later accept — see
		// dbx.ParcelPriceBand's own comment on why one derivation is the
		// point.
		coverageFeeKes := 0.0
		var coverageTier *dbx.ParcelCoverageTier
		declaredValue, _ := money.ParseKES(c.Query("declaredValueKes"))
		if tierID := c.Query("coverageTierId"); tierID != "" && declaredValue.IsPositive() {
			tier, terr := dbx.GetCoverageTier(c.Request.Context(), s.Pool, tierID)
			if terr == nil && tier != nil && tier.Active {
				coverageTier = tier
				coverageFeeKes = tier.CoverageFee(declaredValue).KES()
			}
		}

		pricing, distanceKm, err := dbx.ParcelPriceBand(c.Request.Context(), s.Pool, dbx.PriceBandInput{
			ParcelType:          parcelType,
			OriginZoneID:        originZoneID,
			DestinationZoneID:   destinationZoneID,
			HasDestinationAgent: c.Query("destinationAgentId") != "",
			CoverageFeeKes:      coverageFeeKes,
			ParcelOrgID:         parcelOrgID,
		})
		if err != nil {
			writeParcelError(c, err)
			return
		}

		resp := gin.H{
			"parcelType": pricing.ParcelType, "weightLabel": pricing.WeightLabel,
			"minWeightKg": pricing.MinWeightKg, "maxWeightKg": pricing.MaxWeightKg,
			"minKes": pricing.MinKes, "maxKes": pricing.MaxKes,
			"bargainMinPct": pricing.BargainMinPct, "bargainMaxPct": pricing.BargainMaxPct,
			"bargainReasons": pricing.BargainReasons, "suggestedTransportMode": pricing.SuggestedTransportMode,
			"agentDropDiscountPct": pricing.AgentDropDiscountPct,
			"coverageFeeKes":       money.AmountFromKES(coverageFeeKes),
		}
		if originZoneID != nil && destinationZoneID != nil {
			resp["distanceKm"] = distanceKm
		}
		if coverageTier != nil {
			resp["coveredAmountKes"] = money.AmountOf(coverageTier.CoveredAmount(declaredValue))
		}
		c.JSON(http.StatusOK, resp)
		return
	}
	var listOrgID *string
	if v := c.Query("parcelOrgId"); v != "" {
		listOrgID = &v
	}
	all, err := dbx.ListParcelPricing(c.Request.Context(), s.Pool, listOrgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load pricing")
		return
	}
	c.JSON(http.StatusOK, gin.H{"pricing": all})
}

// handleListParcelZones — GET /v1/parcels/zones. Public — the booking
// form needs the zone picker before the sender has signed in, same
// reasoning handleGetParcelPricing is public.
func (s *Server) handleListParcelZones(c *gin.Context) {
	zones, err := dbx.ListParcelZones(c.Request.Context(), s.Pool, true)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load zones")
		return
	}
	c.JSON(http.StatusOK, gin.H{"zones": zones})
}

type setParcelPriceRequest struct {
	PriceKes      money.Amount `json:"priceKes" binding:"required"`
	BargainReason *string      `json:"bargainReason"`
}

// handleSetParcelPrice — POST /v1/parcels/:code/price. The client's
// number is a UI convenience only; dbx.SetParcelPrice re-derives and
// enforces the actual allowed range/reason server-side.
func (s *Server) handleSetParcelPrice(c *gin.Context) {
	var req setParcelPriceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetParcelPrice(c.Request.Context(), s.Pool, c.Param("code"), req.PriceKes.KES(), req.BargainReason); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"priceKes": req.PriceKes.KES()})
}

type payParcelRequest struct {
	PaymentMethod string `json:"paymentMethod" binding:"required"` // MPESA_STK | ESOKO_POINTS
	Msisdn        string `json:"msisdn"`                           // required for MPESA_STK
}

// handlePayParcel — POST /v1/parcels/:code/pay. Same two-method shape
// store checkout's PaymentMethod already follows (minus
// CASH_ON_DELIVERY — a parcel's dispatch fee is always collected up
// front, never on delivery). ESOKO_POINTS settles inline; MPESA_STK
// starts a push and the caller polls status the same way checkout does.
func (s *Server) handlePayParcel(c *gin.Context) {
	var req payParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !optionalMsisdnString(c, &req.Msisdn, "That phone number") {
		return
	}
	code := c.Param("code")

	if req.PaymentMethod == "ESOKO_POINTS" {
		ctx := ctxFromGin(c)
		if ctx.PartyID == "" {
			writeError(c, http.StatusUnauthorized, "SIGN_IN_REQUIRED", "Sign in to pay with Esoqo points")
			return
		}
		if err := dbx.PayParcelWithPoints(c.Request.Context(), s.Pool, code, ctx.PartyID); err != nil {
			writeParcelError(c, err)
			return
		}
		// No SMS here — paying (like booking) only describes a parcel;
		// it doesn't prove anyone has it in hand. See
		// handleScanParcelHandoff's own comment: that first physical
		// custody scan is the only thing that texts sender or receiver.
		c.JSON(http.StatusOK, gin.H{"status": "BOOKED", "method": "ESOKO_POINTS"})
		return
	}

	if req.PaymentMethod != "MPESA_STK" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "paymentMethod must be MPESA_STK or ESOKO_POINTS")
		return
	}
	if req.Msisdn == "" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "msisdn is required for M-Pesa")
		return
	}
	priceKes, status, err := dbx.GetParcelForPayment(c.Request.Context(), s.Pool, code)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	if status != "DRAFT_PENDING_PAYMENT" {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "This parcel is not awaiting payment")
		return
	}
	if priceKes <= 0 {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "Choose a price before paying")
		return
	}

	stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: req.Msisdn, AmountKES: priceKes,
		AccountReference: code, Description: "Esoqo parcel delivery",
	})
	if err != nil {
		// A bad phone number is the sender's own mistake and safe (and
		// useful) to show verbatim; anything else here is an operator-
		// side problem (missing config, Daraja unreachable) that must
		// never surface as a raw error string on someone's phone —
		// log the real one, show a plain "try again" instead.
		message := "Could not start the M-Pesa payment. Please try again in a moment."
		if mpesaErr, ok := err.(*payments.MpesaError); ok && mpesaErr.Code == payments.MpesaInvalidMsisdn {
			message = mpesaErr.Message
		} else {
			log.Printf("parcel STK push failed for %s: %v", code, err)
		}
		writeError(c, http.StatusBadRequest, "STK_FAILED", message)
		return
	}
	if err := dbx.AttachParcelPaymentCheckoutID(c.Request.Context(), s.Pool, code, stk.CheckoutRequestID); err != nil {
		writeError(c, http.StatusInternalServerError, "PAY_FAILED", "Could not start payment")
		return
	}
	// CheckoutRequestID is deliberately not echoed: it is the lookup key
	// the STK webhook confirms against, so handing it to the caller turns
	// a payer into someone who knows another party's confirm handle.
	// Clients poll by parcel code instead (no consumer ever read it).
	resp := gin.H{"status": "DRAFT_PENDING_PAYMENT"}
	if stk.AutoConfirmed {
		// justConfirmed no longer triggers an SMS here — a cleared
		// payment still only describes a parcel, not a courier's hand on
		// it. See handleScanParcelHandoff's own comment.
		if _, _, err := dbx.ConfirmParcelPaymentByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, stk.MpesaReceiptCode, s.Cfg.LoyaltyEarnEnabled); err == nil {
			resp["status"] = "BOOKED"
		}
	}
	c.JSON(http.StatusOK, resp)
}

// handleGetParcelStatus — GET /v1/parcels/:code/status. Guest-safe —
// same code the sender printed/shared is the bearer credential for
// "check this parcel", same convention a pickup code follows.
func (s *Server) handleGetParcelStatus(c *gin.Context) {
	status, err := dbx.GetParcelStatus(c.Request.Context(), s.Pool, c.Param("code"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that parcel")
		return
	}
	if status == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That parcel was not found")
		return
	}
	// Nothing to show yet, whichever identifier this was looked up by
	// (see Parcel.serviceTicketNumber's own comment) — a parcel nobody
	// has physically received doesn't have a real code, a route, or a
	// status worth reading out to the outside world. The real code in
	// particular must never leak here pre-intake: it's the one field
	// this whole reduction exists to protect.
	if status.IntakeConfirmedAt == nil {
		c.JSON(http.StatusOK, gin.H{
			"status": "AWAITING_INTAKE",
			"message": "This parcel hasn't been received yet. Once a handler confirms it, " +
				"you'll get a text with your tracking link.",
		})
		return
	}
	// Was the label this was scanned from genuinely ours?
	//
	// Three states, not a boolean, and the middle one is the reason:
	// absent means the caller typed the code by hand or scanned a label
	// printed before signing existed, which is ordinary and must not be
	// shown as a forgery. Only a k= that was presented and did not match
	// earns that.
	if k := c.Query("k"); k != "" {
		orgID, batchID, ferr := dbx.LabelSigFields(c.Request.Context(), s.Pool, c.Param("code"))
		if ferr == nil {
			if fleetqr.VerifyLabel(s.Cfg.FleetQrSecret, status.Code, orgID, batchID, k) {
				status.LabelVerdict = "genuine"
			} else {
				status.LabelVerdict = "forged"
			}
		}
	} else {
		status.LabelVerdict = "unverified"
	}
	c.JSON(http.StatusOK, status)
}

// handleGetPartyParcelActivity — GET /v1/me/parcel-activity. One
// endpoint behind the generic "any signed-in party" gate, not two
// session-specific ones — a customer, an admin staffer and a parcel-org
// staffer all resolve to the same ctx.PartyID, and "parcels you've
// sent, are receiving, or are currently holding" means the same thing
// for all three. Backs the guest tracking page's signed-in staff panel
// (see /parcels/track) as much as any customer's own "my parcels" view.
func (s *Server) handleGetPartyParcelActivity(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.PartyID == "" {
		writeError(c, http.StatusForbidden, "DENIED", "Sign in to see your parcels")
		return
	}
	rows, err := dbx.ListPartyParcelActivity(c.Request.Context(), s.Pool, ctx.PartyID, 50)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your parcels")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}

// handleGetParcelLabel — GET /v1/parcels/:code/label. Auth required.
// Backs the print-a-label flow: a handler/courier currently holding or
// assigned to the parcel, or org staff with the "parcels.read"
// capability (dispatch/ops), can pull the label projection — everyone
// else gets DENIED, same as an admin route would, even though this
// lives under /v1/parcels rather than /v1/admin/parcels (couriers
// don't have admin capabilities to check against, only custody).
func (s *Server) handleGetParcelLabel(c *gin.Context) {
	ctx := ctxFromGin(c)
	code := c.Param("code")
	authorized := authsvc.RequireCapability(ctx, "parcels.read", nil) == nil
	if !authorized {
		isHandler, err := dbx.IsParcelHandler(c.Request.Context(), s.Pool, code, ctx.PartyID)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that parcel")
			return
		}
		authorized = isHandler
	}
	if !authorized {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have this parcel in your custody")
		return
	}
	label, err := dbx.GetParcelLabel(c.Request.Context(), s.Pool, code)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that parcel")
		return
	}
	if label == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That parcel was not found")
		return
	}
	// Sign from the stock row (print-time truth) so the reprint is
	// genuine; branding rides on the same row. Parcels booked at
	// checkout with no stock row sign as empty and print Esoqo alone.
	label.Sig = fleetqr.SignLabel(s.Cfg.FleetQrSecret, label.Code, label.StockOrgID, label.StockBatchID)
	c.JSON(http.StatusOK, label)
}

// handleScanParcelHandoff — POST /v1/parcels/:code/handoff. Auth
// required — accepting custody needs a party to attribute it to (see
// dbx.ScanHandoff's own comment on the authorization model).
//
// This is the ONLY thing that ever texts a sender or receiver about a
// parcel that was booked (or paid for) online. Booking, pricing and
// paying all only describe or settle a parcel — none of them prove
// anyone has it in hand — so none of them send anything (see
// handleBookParcel's, handlePayParcel's and the M-Pesa webhook's own
// comments). Only the genuine first BOOKED→PICKED_UP transition does
// (never a later leg or a replayed scan — see dbx.ScanHandoff's
// wasFirstPickup), whether that scan is a courier company's own front
// desk confirming a walk-in drop-off, or a courier scanning a
// scheduled pickup at the sender's door: both are the same "someone
// verified they're holding it" event.
func (s *Server) handleScanParcelHandoff(c *gin.Context) {
	ctx := ctxFromGin(c)
	code := c.Param("code")
	// Resolved here, not asserted by the client — same shape
	// handleDeliverParcel's own allowCodeless takes. Esoqo ops handling
	// a parcel directly (a recovery, an exception at a hub) are carriers
	// by capability rather than by a parcel_courier row; everyone else
	// has to be a recognised carrier for this parcel. See
	// dbx.canTakeParcelCustody.
	staffOverride := authsvc.RequireCapability(ctx, "parcels.override", nil) == nil ||
		authsvc.RequireCapability(ctx, "parcels.assign", nil) == nil
	// ctx.ActorID is the StaffUser id for a STAFF session — recorded as
	// intakeConfirmedByStaffId when a no-Party desk confirms the box (see
	// dbx.ScanHandoff). Empty for a subject/courier scan, which is fine:
	// the column is nullable and only a staff confirmation sets it.
	status, wasFirstIntake, resolvedCode, err := dbx.ScanHandoff(c.Request.Context(), s.Pool, code, ctx.PartyID, ctx.ActorID, staffOverride)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	// resolvedCode, never the caller's `code`, from here down: a walk-in
	// clerk scans the serviceTicketNumber the sender was given (the only
	// reference that exists pre-intake), and every lookup and message
	// below is keyed on the real code. Using the input would find no
	// notify row at all and quietly text nobody — see dbx.ScanHandoff.
	if wasFirstIntake {
		if info, ierr := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, resolvedCode); ierr == nil && info != nil {
			if info.SenderMsisdn != "" {
				_ = authsvc.SendSms(info.SenderMsisdn,
					notify.ParcelIntakeConfirmed(resolvedCode, info.CarrierOrgName, info.OriginLabel, info.ReceiverName, info.ReceiverMsisdn),
					"PARCEL_INTAKE_CONFIRMED")
			}
			// The receiver is contacted at the actionable stage, not when
			// the parcel first enters custody. A scheduled pickup is ready
			// for final delivery once the first courier takes it; a counter
			// intake waits until the parcel reaches its destination point,
			// where handleHoldParcelAtAgent sends the one readiness SMS.
			if status == "PICKED_UP" && info.ReceiverMsisdn != "" {
				carrier := ""
				if info.CarrierOrgName != nil {
					carrier = *info.CarrierOrgName
				}
				_ = authsvc.SendSms(info.ReceiverMsisdn,
					notify.ParcelInTransitToYou(resolvedCode, info.SenderName, info.OriginLabel, info.DeliveryCode, carrier),
					"PARCEL_READY_FOR_DELIVERY")
			}
			// A courier company's own team, not Esoqo-operated dispatch
			// (nil ParcelOrgID — see that field's own comment) — there's
			// no "team" outside a company's own roster to summarize a
			// departure to.
			if info.ParcelOrgID != nil {
				s.sendOrgDispatchSummary(c, *info.ParcelOrgID, resolvedCode)
			}
		}
	}
	// The real code goes back to the caller because this scan is the
	// moment it comes into existence for the outside world (see
	// Parcel.serviceTicketNumber). The front desk needs it to print the
	// label that goes on the box — printing the ticket number there
	// would put a reference on the parcel that no later scan resolves.
	c.JSON(http.StatusOK, gin.H{"status": status, "code": resolvedCode})
}

// dispatchSummaryEvery — how many departures pass between summaries.
// The first parcel of the day always sends (the desk wants to know the
// day has started); after that, every Nth. Derived from the day's own
// running count rather than kept as timer state anywhere, so it costs
// nothing and behaves identically across however many API processes are
// running.
const dispatchSummaryEvery = 10

// sendOrgDispatchSummary — the courier company's dispatch desk hears
// "one of ours just left the station", with the day's running count.
//
// Genuinely a digest, which is what the old version only claimed to be:
// it fired on every single first-handoff scan, to every active staff
// member, synchronously inside the scan request. That was one text per
// box per person — the exact per-parcel noise the message's own doc
// comment says it isn't — and because authsvc.SendSms dials the gateway
// inline, the courier's scan blocked on N sequential HTTP round-trips
// before returning. Worse, every one of those messages drew against the
// single global daily SMS ceiling shared with OTP, so a busy afternoon
// could silently exhaust the budget that receivers' delivery codes and
// OTPs depend on.
//
// Now: dispatch-capable staff only (see dbx.ListOrgDispatchDeskMsisdns),
// on a cadence (see dispatchSummaryEvery), and off the request path
// entirely. Best-effort and silent on any error — a summary text is a
// courtesy to the desk, never a reason to fail a scan that already
// succeeded.
func (s *Server) sendOrgDispatchSummary(c *gin.Context, orgID, code string) {
	count, err := dbx.CountOrgParcelsDispatchedToday(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		return
	}
	if count != 1 && count%dispatchSummaryEvery != 0 {
		return
	}
	org, err := dbx.GetParcelOrg(c.Request.Context(), s.Pool, orgID)
	if err != nil || org == nil {
		return
	}
	msisdns, err := dbx.ListOrgDispatchDeskMsisdns(c.Request.Context(), s.Pool, orgID)
	if err != nil || len(msisdns) == 0 {
		return
	}
	message := notify.ParcelOrgDispatchSummary(org.Name, code, count)
	// Detached from the request context on purpose: the gin context is
	// cancelled the moment the scan response is written, and these sends
	// deliberately outlive it. Nothing downstream reads a result.
	go func() {
		for _, m := range msisdns {
			_ = authsvc.SendSms(m, message, "PARCEL_ORG_DISPATCH_SUMMARY")
		}
	}()
}

type deliverParcelRequest struct {
	// No longer `binding:"required"` — a parcel being collected from a
	// pickup point, or handed over under a staff override, legitimately
	// has no code to quote (see dbx.DeliverParcel's own switch). The
	// empty case is validated there, where the parcel's status is known,
	// rather than here where it isn't.
	DeliveryCode string `json:"deliveryCode"`

	// OtpCode — the alternative to DeliveryCode: a code the receiver
	// just read out, texted to the parcel's own receiverMsisdn a moment
	// earlier (see handleRequestParcelDeliveryOtp). Verified here,
	// server-side, against that same stored number before dbx ever sees
	// it — see dbx.DeliverParcel's own comment on why it only ever
	// receives the yes/no fact, never the raw code.
	OtpCode string `json:"otpCode"`

	// Proof of delivery, captured at the door. PhotoKey is what
	// handleUploadPodPhoto handed back — a storage key, never a URL the
	// client composed.
	PhotoKey       *string  `json:"photoKey"`
	Lat            *float64 `json:"lat"`
	Lng            *float64 `json:"lng"`
	ReceivedByName *string  `json:"receivedByName"`

	// CodCollectedKes — what the courier actually took at the door, for
	// a cash-on-delivery parcel. Required for one: handing over goods
	// without recording the money is the failure mode COD has to be
	// built to prevent, so the delivery is refused without it.
	// Still a pointer: nil means "the courier reported no collection at
	// all", which is a different fact from collecting zero, and the
	// needsCod check below turns on exactly that distinction. Binds from
	// a number or a decimal string (see money.Amount).
	CodCollectedKes *money.Amount `json:"codCollectedKes"`
}

// handleDeliverParcel — POST /v1/parcels/:code/deliver. Auth required
// — only the parcel's current holder can close the chain (see
// dbx.DeliverParcel). Sends the delivery SMS to both parties once the
// drop-off is confirmed.
//
// The code-less override is resolved here, from the caller's
// capability, and passed to dbx as a decided boolean. It is never read
// off the request body: a client that could assert "no code needed"
// would be asserting its own authorization, and the delivery code is
// the only thing standing between a tracking number and someone else's
// parcel.
func (s *Server) handleDeliverParcel(c *gin.Context) {
	var req deliverParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	code := c.Param("code")
	allowCodeless := authsvc.RequireCapability(ctx, "parcels.override", nil) == nil
	proof := dbx.DeliverProof{
		PhotoURL:       req.PhotoKey,
		Lat:            req.Lat,
		Lng:            req.Lng,
		ReceivedByName: req.ReceivedByName,
	}
	// Resolved here, server-side, against the parcel's own
	// receiverMsisdn — never the raw code trusted straight into dbx.
	// See dbx.DeliverParcel's own comment on why this arrives there as
	// a plain bool. Only attempted when there's no delivery code to try
	// first — dbx.DeliverParcel checks the code before otpVerified, so
	// a bogus OTP alongside a genuinely correct code must never refuse
	// a delivery the code alone would have allowed.
	var otpVerified bool
	if strings.TrimSpace(req.DeliveryCode) == "" && strings.TrimSpace(req.OtpCode) != "" {
		var overr error
		otpVerified, overr = dbx.VerifyParcelDeliveryOtp(c.Request.Context(), s.Pool, s.OTP, code, req.OtpCode)
		if overr != nil {
			writeParcelError(c, overr)
			return
		}
		if !otpVerified {
			writeError(c, http.StatusUnauthorized, "WRONG_CODE", "That code is not right")
			return
		}
	}
	// Checked BEFORE delivering, so a COD parcel can never be closed out
	// with the money left unrecorded — and reported here rather than
	// after the hand-over, when it would be too late to act on.
	needsCod, err := dbx.ParcelNeedsCodCollection(c.Request.Context(), s.Pool, code)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "DELIVER_FAILED", "Could not load that parcel")
		return
	}
	if needsCod && req.CodCollectedKes == nil {
		writeError(c, http.StatusBadRequest, "COD_REQUIRED", "Record what the buyer paid before completing this delivery")
		return
	}

	// ── Delivery-code throttle ──────────────────────────────────────
	//
	// The code is six digits now (see dbx.DeliveryCodeDigits), which is
	// a million combinations — enumerable in seconds by the one party
	// with both the parcel and the right to call this endpoint: the
	// courier currently holding it. Without a wall here, diverting a box
	// and then guessing your way to a DELIVERY_CODE proof would look
	// exactly like an honest handover in the audit trail, while the
	// legitimate no-code routes (OTP to the number on file, or a staff
	// override with photo and name) both leave evidence. The throttle is
	// what keeps the short code honest; it is not optional.
	//
	// Keyed on the parcel, not the caller or the IP: the thing being
	// guessed is this parcel's code, and a courier switching handsets or
	// networks must not get a fresh allowance. Only wrong codes count —
	// a receiver who fumbles twice and then reads it correctly is no
	// closer to a lockout than one who got it right first time.
	//
	// OTP and override deliveries skip the gate entirely: neither is
	// guessing the delivery code, and locking a parcel out of the two
	// routes that exist precisely for "the code didn't arrive" would
	// strand the receiver standing at the counter.
	triesCode := "parcel-delivery-code:" + code
	guessingCode := strings.TrimSpace(req.DeliveryCode) != "" && !otpVerified
	if guessingCode &&
		authsvc.FailedAttempts(c.Request.Context(), s.Redis, triesCode) >= dbx.DeliveryCodeMaxAttempts {
		writeError(c, http.StatusTooManyRequests, "CODE_LOCKED",
			"Too many wrong codes for this parcel. Send the receiver a one-time code instead, or hand over with a photo and their name.")
		return
	}

	// receiverSelfConfirm is false and stays false on this route: this is
	// the staff hand-over endpoint, and a caller who has authenticated as
	// staff is by definition not the receiver closing their own parcel.
	// The self-confirm path is handleReceiverSelfConfirm, which reaches
	// DeliverParcel only after spending a receiver token.
	if err := dbx.DeliverParcel(c.Request.Context(), s.Pool, code, req.DeliveryCode, ctx.PartyID, proof, allowCodeless, otpVerified, false); err != nil {
		// A wrong code is the only failure worth counting. Every other
		// rejection here (not holding it, already delivered, journey
		// closed) is a statement about the parcel that no amount of
		// retrying changes, and counting those would lock a parcel over
		// a clerk repeating a call that was never going to succeed.
		var pe *dbx.ParcelError
		if errors.As(err, &pe) && pe.Code == "WRONG_CODE" && guessingCode {
			left := dbx.DeliveryCodeMaxAttempts -
				authsvc.RecordFailure(c.Request.Context(), s.Redis, triesCode, time.Hour)
			if left <= 0 {
				writeError(c, http.StatusTooManyRequests, "CODE_LOCKED",
					"Too many wrong codes for this parcel. Send the receiver a one-time code instead, or hand over with a photo and their name.")
				return
			}
			// Saying how many tries remain is deliberate. The person
			// typing is a clerk helping a receiver read a number off a
			// phone, not an attacker being handed a hint — and a clerk
			// who doesn't know a lockout is coming will burn the last
			// try on a guess instead of switching to the OTP route.
			writeError(c, http.StatusUnauthorized, "WRONG_CODE",
				fmt.Sprintf("That code doesn't match. %d %s left before this parcel locks.",
					left, map[bool]string{true: "try", false: "tries"}[left == 1]))
			return
		}
		writeParcelError(c, err)
		return
	}
	// Delivered — nothing left to guess, so the counter goes rather than
	// ageing out on its own.
	authsvc.ClearFailures(c.Request.Context(), s.Redis, triesCode)

	// After the hand-over, never before: a wrong delivery code must not
	// be able to book a collection for goods that never changed hands.
	var codResult *dbx.CodCollectionResult
	if needsCod {
		codResult, err = s.collectCodOnDelivery(c, code, req.CodCollectedKes, ctx.PartyID)
		if err != nil {
			// The parcel IS delivered at this point — reporting a flat
			// failure would tell the courier to try again on a parcel
			// that's already gone. Say exactly what's outstanding and
			// point at the endpoint that fixes it.
			log.Printf("parcel %s delivered but COD collection failed: %v", code, err)
			writeError(c, http.StatusConflict, "COD_NOT_RECORDED",
				"Delivered, but the payment wasn't recorded. Record it again from the parcel.")
			return
		}
		s.notifyCodCollected(c, code, codResult)
	}
	if info, ierr := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code); ierr == nil && info != nil {
		deliveredAt := time.Now()
		if info.DeliveredAt != nil {
			deliveredAt = *info.DeliveredAt
		}
		if info.SenderMsisdn != "" {
			_ = authsvc.SendSms(info.SenderMsisdn, notify.ParcelDelivered(code, info.DestinationLabel, deliveredAt), "PARCEL_DELIVERED")
		}
	}
	resp := gin.H{"status": "DELIVERED"}
	if codResult != nil {
		resp["cod"] = codResult
	}
	c.JSON(http.StatusOK, resp)
}

// handleRequestParcelDeliveryOtp — POST /v1/parcels/:code/deliver/request-otp.
// Auth required — only someone actually at the hand-over (holding the
// parcel, or staff with read access) should be triggering a text to
// the receiver's phone. See dbx.RequestParcelDeliveryOtp's own comment.
func (s *Server) handleRequestParcelDeliveryOtp(c *gin.Context) {
	code := c.Param("code")
	masked, err := dbx.RequestParcelDeliveryOtp(c.Request.Context(), s.Pool, s.OTP, code, clientIP(c))
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"maskedMsisdn": masked})
}

func (s *Server) handleListMyParcels(c *gin.Context) {
	ctx := ctxFromGin(c)
	rows, err := dbx.ListMyParcels(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your parcels")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}

// handleListHeldParcels — GET /v1/me/parcels/holding. The handler/
// driver-facing "parcels I'm holding" list — the mobile version of
// Phases 2/6/7's own scoped-session screens.
func (s *Server) handleListHeldParcels(c *gin.Context) {
	ctx := ctxFromGin(c)
	rows, err := dbx.ListParcelsHeld(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load parcels you're holding")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}

// handleRequestParcelReceiptOtp — POST /v1/parcels/:code/receipt/otp.
// Public — no Esoqo account needed, only proof of control of the
// number already on the parcel (see dbx.RequestParcelReceiptOtp; the
// OTP always goes to that stored receiverMsisdn, never one the client
// supplies).
func (s *Server) handleRequestParcelReceiptOtp(c *gin.Context) {
	masked, err := dbx.RequestParcelReceiptOtp(c.Request.Context(), s.Pool, s.OTP, c.Param("code"), clientIP(c))
	if err != nil {
		writeParcelReceiptError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"maskedMsisdn": masked})
}

type confirmParcelReceiptRequest struct {
	Code            string  `json:"code" binding:"required"`
	ConditionRating int     `json:"conditionRating" binding:"required"`
	Feedback        *string `json:"feedback"`
}

// handleConfirmParcelReceipt — POST /v1/parcels/:code/receipt/confirm.
// Public — closes the loop past handleDeliverParcel's courier-side
// claim of drop-off with the receiver's own OTP-verified word, plus a
// condition rating. Tells the sender by SMS.
func (s *Server) handleConfirmParcelReceipt(c *gin.Context) {
	var req confirmParcelReceiptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	code := c.Param("code")
	senderMsisdn, _, receiverName, err := dbx.ConfirmParcelReceipt(c.Request.Context(), s.Pool, s.OTP, code, req.Code, req.ConditionRating, req.Feedback)
	if err != nil {
		writeParcelReceiptError(c, err)
		return
	}
	if senderMsisdn != "" {
		_ = authsvc.SendSms(senderMsisdn, notify.ParcelReceiptConfirmed(code, receiverName, req.ConditionRating), "PARCEL_RECEIPT_CONFIRMED")
	}
	c.JSON(http.StatusOK, gin.H{"confirmed": true})
}

// writeParcelReceiptError — the receipt endpoints can also fail with an
// *authsvc.OtpError (rate-limited, expired, wrong code), which
// writeParcelError doesn't know how to unwrap.
func writeParcelReceiptError(c *gin.Context, err error) {
	if oe, ok := err.(*authsvc.OtpError); ok {
		status := http.StatusBadRequest
		if oe.Code == authsvc.OtpRateLimited || oe.Code == authsvc.OtpSpendCap {
			status = http.StatusTooManyRequests
		}
		writeError(c, status, string(oe.Code), oe.Message)
		return
	}
	writeParcelError(c, err)
}

// handleListParcelHandoffs — GET /v1/parcels/:code/handoffs. Auth
// required, and scoped to the parcel's own sender — the custody chain
// names real people (couriers), so unlike the guest-safe status
// endpoint this isn't shown to just anyone holding the code (see
// dbx.ListParcelHandoffs's own comment; the admin console has its own,
// unscoped equivalent in handlers_admin_parcels.go).
func (s *Server) handleListParcelHandoffs(c *gin.Context) {
	ctx := ctxFromGin(c)
	parcelID, senderPartyID, err := dbx.GetParcelSenderPartyID(c.Request.Context(), s.Pool, c.Param("code"))
	if err != nil {
		writeParcelError(c, err)
		return
	}
	if senderPartyID == nil || *senderPartyID != ctx.PartyID {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "You can only view your own parcel's handling history")
		return
	}
	rows, err := dbx.ListParcelHandoffs(c.Request.Context(), s.Pool, parcelID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load handling history")
		return
	}
	c.JSON(http.StatusOK, gin.H{"handoffs": rows})
}

// ── Dispatch: courier pings, available jobs, claim ──

type postCourierPingRequest struct {
	Lat float64 `json:"lat" binding:"required"`
	Lng float64 `json:"lng" binding:"required"`
}

// handlePostCourierPing — POST /v1/parcels/couriers/me/pings. Auth
// required — a courier's own location, posted while their "Nearby
// jobs" view is open (see dbx.PostCourierPing).
func (s *Server) handlePostCourierPing(c *gin.Context) {
	var req postCourierPingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	if err := dbx.PostCourierPing(c.Request.Context(), s.Pool, ctx.PartyID, req.Lat, req.Lng); err != nil {
		writeParcelCourierError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleListAvailableJobs — GET /v1/parcels/couriers/me/available-jobs?radiusKm=.
// Auth required. Defaults to a 15km radius — wide enough for a boda in
// most Kenyan towns, narrow enough that "available jobs" doesn't mean
// the whole country.
func (s *Server) handleListAvailableJobs(c *gin.Context) {
	radiusKm := 15.0
	if v := c.Query("radiusKm"); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil && parsed > 0 {
			radiusKm = parsed
		}
	}
	ctx := ctxFromGin(c)
	jobs, err := dbx.ListAvailableJobs(c.Request.Context(), s.Pool, ctx.PartyID, radiusKm)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load nearby jobs")
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": jobs})
}

// handleClaimParcel — POST /v1/parcels/:code/claim. Auth required —
// the real first-accept-wins dispatch primitive (see dbx.ClaimParcel).
// A rival courier who claimed first gets ALREADY_DELIVERED here (same
// code ScanHandoff's "already gone" cases use) — the mobile client
// treats it as "someone beat you to it, refresh the list", not an
// error to alarm over.
func (s *Server) handleClaimParcel(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := dbx.ClaimParcel(c.Request.Context(), s.Pool, c.Param("code"), ctx.PartyID); err != nil {
		// dbx.ClaimParcel can fail with either *dbx.ParcelCourierError
		// (not an active courier) or *dbx.ParcelError (already claimed/
		// wrong state) — writeParcelCourierError is the one unwrapper
		// that handles both instead of falling through to a generic 500.
		writeParcelCourierError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"claimed": true})
}

// parcelErrorStatus maps a ParcelError code to its HTTP status.
//
// Split out from writeParcelError so the mapping is testable without a
// gin context — these codes are a published client contract (the
// offline counter queue branches on one of them), and a contract with
// no test is a convention.
func parcelErrorStatus(code string) int {
	switch code {
	case "NOT_FOUND":
		return http.StatusNotFound
	case "FORBIDDEN":
		return http.StatusForbidden
	case "INSUFFICIENT_POINTS":
		return http.StatusPaymentRequired
	case "ALREADY_SETTLED", "ALREADY_DELIVERED":
		// Conflict, not a bad request: the caller did nothing wrong,
		// the parcel simply moved on. A clerk's till app can tell
		// "someone already took this money" apart from "you typed a
		// bad amount" without parsing prose.
		return http.StatusConflict
	case "LABEL_ALREADY_SPENT":
		// Also a conflict, and for the sharpest version of the same
		// reason: for the offline counter queue this response is how a
		// replayed booking discovers it already succeeded. A 400 there
		// would read as "the clerk typed something wrong" for a parcel
		// that shipped hours ago.
		return http.StatusConflict
	}
	return http.StatusBadRequest
}

func writeParcelError(c *gin.Context, err error) {
	if pe, ok := err.(*dbx.ParcelError); ok {
		writeError(c, parcelErrorStatus(pe.Code), pe.Code, pe.Message)
		return
	}
	writeError(c, http.StatusInternalServerError, "PARCEL_FAILED", "Could not complete that")
}
