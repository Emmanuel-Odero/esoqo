package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/payments"
)

func (s *Server) handleListStores(c *gin.Context) {
	stores, err := dbx.ListStores(c.Request.Context(), s.Pool, 50, 0)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load stores")
		return
	}
	c.JSON(http.StatusOK, gin.H{"stores": stores})
}

// handleListStoresNearby — GET /v1/stores/nearby?lat=&lng=&radiusKm=&q=&category=.
// lat/lng are optional together: supply both for a GPS-sorted "near
// me" search, or omit both and use q/category for a neighborhood-text
// search when the device has no location permission. See
// dbx.ListStoresNearby's own comment for why this is one endpoint
// instead of two.
func (s *Server) handleListStoresNearby(c *gin.Context) {
	var lat, lng *float64
	if latStr, lngStr := c.Query("lat"), c.Query("lng"); latStr != "" && lngStr != "" {
		latVal, errLat := strconv.ParseFloat(latStr, 64)
		lngVal, errLng := strconv.ParseFloat(lngStr, 64)
		if errLat != nil || errLng != nil {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "lat/lng must be numbers")
			return
		}
		lat, lng = &latVal, &lngVal
	}

	radiusKM := 15.0
	if r := c.Query("radiusKm"); r != "" {
		if v, err := strconv.ParseFloat(r, 64); err == nil && v > 0 {
			radiusKM = v
		}
	}

	stores, err := dbx.ListStoresNearby(c.Request.Context(), s.Pool, lat, lng, radiusKM, c.Query("q"), c.Query("category"), 50)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load nearby stores")
		return
	}
	c.JSON(http.StatusOK, gin.H{"stores": stores})
}

func (s *Server) handleGetStore(c *gin.Context) {
	store, err := dbx.GetStoreBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that store")
		return
	}
	if store == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That store is not available")
		return
	}
	c.JSON(http.StatusOK, store)
}

func (s *Server) handleListStoreProducts(c *gin.Context) {
	store, err := dbx.GetStoreBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that store")
		return
	}
	if store == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That store is not available")
		return
	}
	products, err := dbx.ListStoreProducts(c.Request.Context(), s.Pool, store.ID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load products")
		return
	}
	c.JSON(http.StatusOK, gin.H{"products": products})
}

func (s *Server) handleGetProduct(c *gin.Context) {
	product, err := dbx.GetProduct(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that product")
		return
	}
	if product == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That product is not available")
		return
	}
	c.JSON(http.StatusOK, product)
}

type createOrderRequest struct {
	StoreSlug        string  `json:"storeSlug" binding:"required"`
	BuyerName        string  `json:"buyerName" binding:"required"`
	BuyerMsisdn      string  `json:"buyerMsisdn" binding:"required"`
	PaymentMethod    string  `json:"paymentMethod" binding:"required"` // MPESA_STK | CASH_ON_DELIVERY | VOUCHER
	VoucherID        *string `json:"voucherId"`
	DeliveryOptionID *string `json:"deliveryOptionId"`
	DeliveryAddress  *string `json:"deliveryAddress"`
	CollectionNotes  *string `json:"collectionNotes"`
	// TableLabel — set by the universal scan screen when this checkout
	// started from a table QR. See dbx.CreateOrderInput.
	TableLabel *string `json:"tableLabel"`
	// IsSelfCheckout — set by the universal scan screen's basket mode
	// when this checkout is a mall/supermarket self-checkout rather than
	// a single-product buy. See dbx.CreateOrderInput.
	IsSelfCheckout bool `json:"isSelfCheckout"`
	Items          []struct {
		ProductID string  `json:"productId" binding:"required"`
		VariantID *string `json:"variantId"`
		Quantity  int     `json:"quantity" binding:"required"`
	} `json:"items" binding:"required"`
}

// handleCreateOrder — guest or authenticated. A signed-in buyer's
// partyId is taken from the session (never trusted from the request
// body); a guest checkout supplies name+phone directly, same as the
// storefront's own guest checkout.
func (s *Server) handleCreateOrder(c *gin.Context) {
	var req createOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.BuyerMsisdn, "The buyer's phone number") {
		return
	}

	items := make([]dbx.OrderItemInput, len(req.Items))
	for i, it := range req.Items {
		items[i] = dbx.OrderItemInput{ProductID: it.ProductID, VariantID: it.VariantID, Quantity: it.Quantity}
	}

	var buyerPartyID *string
	if token := bearerToken(c); token != "" {
		if ctx, _ := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c)); ctx != nil && ctx.PartyID != "" {
			buyerPartyID = &ctx.PartyID
		}
	}

	orderID, totalKES, err := dbx.CreateStoreOrder(c.Request.Context(), s.Pool, dbx.CreateOrderInput{
		StoreSlug:        req.StoreSlug,
		BuyerPartyID:     buyerPartyID,
		BuyerName:        req.BuyerName,
		BuyerMsisdn:      req.BuyerMsisdn,
		PaymentMethod:    req.PaymentMethod,
		VoucherID:        req.VoucherID,
		Items:            items,
		DeliveryOptionID: req.DeliveryOptionID,
		DeliveryAddress:  req.DeliveryAddress,
		CollectionNotes:  req.CollectionNotes,
		TableLabel:       req.TableLabel,
		IsSelfCheckout:   req.IsSelfCheckout,
	})
	if err != nil {
		writeOrderOrBookingError(c, err)
		return
	}

	if req.PaymentMethod == "VOUCHER" {
		// Settled inline in CreateStoreOrder — no STK round-trip.
		c.JSON(http.StatusOK, gin.H{"orderId": orderID, "totalKes": totalKES, "status": "PAID", "method": "VOUCHER"})
		return
	}

	resp := gin.H{"orderId": orderID, "totalKes": totalKES, "status": "PENDING_PAYMENT"}

	if req.PaymentMethod == "MPESA_STK" {
		stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
			Msisdn: req.BuyerMsisdn, AmountKES: parseKES(totalKES),
			AccountReference: orderID[:8], Description: "Esoqo order",
		})
		if err != nil {
			// Order exists but push failed to initiate — buyer can retry
			// payment against the same order id rather than losing it.
			resp["paymentError"] = err.Error()
			c.JSON(http.StatusOK, resp)
			return
		}
		_ = dbx.AttachOrderCheckoutRequestID(c.Request.Context(), s.Pool, orderID, stk.CheckoutRequestID)
		resp["checkoutRequestId"] = stk.CheckoutRequestID
		if stk.AutoConfirmed {
			_ = dbx.ConfirmStoreOrderPaymentByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, s.Cfg.LoyaltyEarnEnabled)
			resp["status"] = "PAID"
		}
	}

	c.JSON(http.StatusOK, resp)
}

// handleGetOrder — public: the order id itself is the secret, same
// convention as getOrder in store-order.ts.
func (s *Server) handleGetOrder(c *gin.Context) {
	order, err := dbx.GetStoreOrder(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that order")
		return
	}
	if order == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That order was not found")
		return
	}
	c.JSON(http.StatusOK, order)
}

func (s *Server) handleListMyOrders(c *gin.Context) {
	ctx := ctxFromGin(c)
	orders, err := dbx.ListOrdersForParty(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your orders")
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

// ── "My spots" — a person's own saved-store bookmarks ────────────

func (s *Server) handleListSavedStores(c *gin.Context) {
	ctx := ctxFromGin(c)
	stores, err := dbx.ListSavedStores(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your saved stores")
		return
	}
	c.JSON(http.StatusOK, gin.H{"stores": stores})
}

func (s *Server) handleSaveStore(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := dbx.SaveStore(c.Request.Context(), s.Pool, ctx.PartyID, c.Param("storeId")); err != nil {
		writeError(c, http.StatusInternalServerError, "SAVE_FAILED", "Could not save that store")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) handleUnsaveStore(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := dbx.UnsaveStore(c.Request.Context(), s.Pool, ctx.PartyID, c.Param("storeId")); err != nil {
		writeError(c, http.StatusInternalServerError, "UNSAVE_FAILED", "Could not remove that store")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleGetUsualProduct — GET /v1/stores/:slug/usual. Guest-safe route
// (no authRequired — the store detail screen calls this even for a
// signed-out visitor) but returns null for anyone without a resolvable
// party, same "degrade to guest, never error" contract as
// optionalBuyerPartyID elsewhere in this codebase.
func (s *Server) handleGetUsualProduct(c *gin.Context) {
	partyID := ""
	if token := bearerToken(c); token != "" {
		if ctx, _ := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c)); ctx != nil {
			partyID = ctx.PartyID
		}
	}
	if partyID == "" {
		c.JSON(http.StatusOK, gin.H{"usual": nil})
		return
	}
	store, err := dbx.GetStoreBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil || store == nil {
		c.JSON(http.StatusOK, gin.H{"usual": nil})
		return
	}
	usual, err := dbx.UsualProduct(c.Request.Context(), s.Pool, partyID, store.ID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load your usual order")
		return
	}
	c.JSON(http.StatusOK, gin.H{"usual": usual})
}

// handleMarkOrderReady — POST /v1/stores/orders/:id/ready. Store-owner
// only (see dbx.requireStoreOwner); the store's own Esoqo account signs
// in the same way a buyer would, there's no separate staff login.
func (s *Server) handleMarkOrderReady(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := dbx.MarkOrderReadyForPickup(c.Request.Context(), s.Pool, c.Param("id"), ctx.PartyID); err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "READY_FOR_PICKUP"})
}

type confirmCollectedRequest struct {
	Code string `json:"code" binding:"required"`
}

// handleConfirmOrderCollected — POST /v1/stores/orders/:id/collect.
// Store-owner only, same as handleMarkOrderReady.
func (s *Server) handleConfirmOrderCollected(c *gin.Context) {
	var req confirmCollectedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	if err := dbx.ConfirmOrderCollected(c.Request.Context(), s.Pool, c.Param("id"), ctx.PartyID, req.Code); err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "FULFILLED"})
}

// ── eatery dine-in: staff roster, table board, status, tips ───────

type createCashierRequest struct {
	Name string `json:"name" binding:"required"`
	Pin  string `json:"pin" binding:"required"`
	Role string `json:"role"`
}

// handleCreateCashier — POST /v1/stores/:slug/cashiers. Store-owner
// only; PIN hashing happens at this boundary, same as every other
// staff-PIN creation path in this codebase (never stored raw).
func (s *Server) handleCreateCashier(c *gin.Context) {
	var req createCashierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if authsvc.IsWeakPin(req.Pin) {
		writeError(c, http.StatusBadRequest, "WEAK_PIN", "Choose a less guessable PIN")
		return
	}
	hash, err := authsvc.HashPin(req.Pin)
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_PIN", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	store, err := dbx.GetStoreBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil || store == nil {
		writeError(c, http.StatusNotFound, "STORE_NOT_FOUND", "That store was not found")
		return
	}
	cashier, err := dbx.CreateCashier(c.Request.Context(), s.Pool, store.ID, req.Name, hash, req.Role, ctx.PartyID)
	if err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"cashier": cashier})
}

func (s *Server) handleListCashiers(c *gin.Context) {
	ctx := ctxFromGin(c)
	store, err := dbx.GetStoreBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil || store == nil {
		writeError(c, http.StatusNotFound, "STORE_NOT_FOUND", "That store was not found")
		return
	}
	cashiers, err := dbx.ListCashiers(c.Request.Context(), s.Pool, store.ID, ctx.PartyID)
	if err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cashiers": cashiers})
}

type assignTableRequest struct {
	CashierID string `json:"cashierId" binding:"required"`
}

// handleAssignTable — POST /v1/stores/:slug/tables/:table/assign.
// Store-owner only (see dbx.requireStoreOwnerByID's own comment on why
// there's no separate waiter PIN login yet).
func (s *Server) handleAssignTable(c *gin.Context) {
	var req assignTableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	store, err := dbx.GetStoreBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil || store == nil {
		writeError(c, http.StatusNotFound, "STORE_NOT_FOUND", "That store was not found")
		return
	}
	id, err := dbx.AssignTable(c.Request.Context(), s.Pool, store.ID, c.Param("table"), req.CashierID, ctx.PartyID)
	if err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"assignmentId": id})
}

// handleListTableOrders — GET /v1/stores/:slug/tables. The table board:
// every dine-in order not yet CLOSED, oldest first (whoever's been
// waiting longest surfaces at the top).
func (s *Server) handleListTableOrders(c *gin.Context) {
	ctx := ctxFromGin(c)
	store, err := dbx.GetStoreBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil || store == nil {
		writeError(c, http.StatusNotFound, "STORE_NOT_FOUND", "That store was not found")
		return
	}
	orders, err := dbx.ListTableOrders(c.Request.Context(), s.Pool, store.ID, ctx.PartyID)
	if err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

type dineInStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

// handleUpdateDineInStatus — POST /v1/stores/orders/:id/dine-in-status.
// Store-owner only, same as handleMarkOrderReady/handleConfirmOrderCollected.
func (s *Server) handleUpdateDineInStatus(c *gin.Context) {
	var req dineInStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	if err := dbx.UpdateDineInStatus(c.Request.Context(), s.Pool, c.Param("id"), req.Status, ctx.PartyID); err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"dineInStatus": req.Status})
}

type addTipRequest struct {
	TipKES money.Amount `json:"tipKes" binding:"required"`
}

// handleAddTip — POST /v1/orders/:id/tip. Guest-safe by the same "the
// order id is the secret" convention GetStoreOrder already documents —
// a guest checkout must be able to tip too, not just a signed-in buyer.
func (s *Server) handleAddTip(c *gin.Context) {
	var req addTipRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.AddTip(c.Request.Context(), s.Pool, c.Param("id"), req.TipKES.KES()); err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── mall self-checkout: guard exit-code verification ──────────────

type resolveExitCodeRequest struct {
	Code string `json:"code" binding:"required"`
}

// handleResolveExitCode — POST /v1/stores/:slug/exit-code/resolve.
// Store-owner-scoped (see dbx.ResolveExitCode) — the mall/supermarket
// equivalent of handleConfirmOrderCollected, but store-scoped rather
// than order-scoped since a guard only ever has the code, never an
// order id. Response is deliberately PII-minimal: item count and
// total only, no buyer name or phone.
func (s *Server) handleResolveExitCode(c *gin.Context) {
	var req resolveExitCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	result, err := dbx.ResolveExitCode(c.Request.Context(), s.Pool, c.Param("slug"), ctx.PartyID, req.Code)
	if err != nil {
		writeOrderOrBookingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"orderId":       result.OrderID,
		"itemCount":     result.ItemCount,
		"totalKes":      result.TotalKES,
		"alreadyExited": result.AlreadyExited,
	})
}

func writeOrderOrBookingError(c *gin.Context, err error) {
	if oe, ok := err.(*dbx.OrderError); ok {
		status := http.StatusBadRequest
		switch oe.Code {
		case "STORE_NOT_FOUND", "NOT_FOUND":
			status = http.StatusNotFound
		case "FORBIDDEN":
			status = http.StatusForbidden
		}
		writeError(c, status, oe.Code, oe.Message)
		return
	}
	if be, ok := err.(*dbx.BookingError); ok {
		status := http.StatusBadRequest
		if be.Code == "SCHEDULE_NOT_FOUND" {
			status = http.StatusNotFound
		}
		writeError(c, status, be.Code, be.Message)
		return
	}
	writeError(c, http.StatusInternalServerError, "CHECKOUT_FAILED", "Could not complete that request")
}
