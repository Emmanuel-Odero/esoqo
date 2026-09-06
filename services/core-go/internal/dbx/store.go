// Package dbx (store.go) ports the buyer-facing slice of
// packages/db/src/dal/store.ts, product.ts and store-order.ts — public
// browse + checkout, plus the pickup-order lifecycle a store owner
// drives from their own Esoko account (MarkOrderReadyForPickup,
// ConfirmOrderCollected — see requireStoreOwner's own comment for why
// that's a real, if v1-simplified, authorization check rather than a
// new staff-PIN subsystem). PoS/reporting/catalogue-management
// functions from those TS files stay TypeScript-only; there's no
// mobile screen that needs them (see docs/adr/0005-mobile-api-in-go.md's
// "mobile v1 scope" note).
package dbx

import (
	"context"
	cryptorand "crypto/rand"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/ledger"
	"github.com/esoko/core-go/internal/loyalty"
)

func earnUnifiedLoyalty(ctx context.Context, pool *pgxpool.Pool, partyID string, kes float64, ref string, enabled bool) error {
	if partyID == "" {
		return nil
	}
	return loyalty.EarnForSpend(ctx, pool, partyID, kes, ref, enabled)
}

type StoreSummary struct {
	ID              string
	Slug            string
	Name            string
	Tagline         *string
	LogoURL         *string
	PrimaryCategory *string
	Neighborhood    *string
	Latitude        *string
	Longitude       *string
}

// ListStores — public storefront directory. Only ACTIVE stores, same
// visibility rule as listPublicStores in store.ts.
func ListStores(ctx context.Context, pool *pgxpool.Pool, limit, offset int) ([]StoreSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, slug, name, tagline, "logoUrl", "primaryCategory", neighborhood, latitude::text, longitude::text
		FROM store WHERE status = 'ACTIVE'
		ORDER BY "createdAt" DESC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []StoreSummary
	for rows.Next() {
		var s StoreSummary
		if err := rows.Scan(&s.ID, &s.Slug, &s.Name, &s.Tagline, &s.LogoURL, &s.PrimaryCategory,
			&s.Neighborhood, &s.Latitude, &s.Longitude); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// NearbyStore is ListStoresNearby's row shape — a StoreSummary plus how
// far away it is, when the caller supplied a device location at all.
type NearbyStore struct {
	StoreSummary
	DistanceKM *float64
}

// ListStoresNearby serves both of the "click & collect" discovery
// modes: pass lat/lng for a haversine-distance-sorted search (a real
// "near me" — Postgres computed, no PostGIS extension needed at this
// scale); omit them and pass q/category for a neighborhood-text
// search that works with no location permission at all. q matches
// name/neighborhood/primaryCategory case-insensitively; category
// narrows to stores whose primaryCategory matches exactly (case
// insensitive) — e.g. "Supermarket".
func ListStoresNearby(ctx context.Context, pool *pgxpool.Pool, lat, lng *float64, radiusKM float64, q, category string, limit int) ([]NearbyStore, error) {
	if lat != nil && lng != nil {
		rows, err := pool.Query(ctx, `
			SELECT id, slug, name, tagline, "logoUrl", "primaryCategory", neighborhood, latitude::text, longitude::text,
			       distance_km
			FROM (
				SELECT *,
				       6371 * acos(LEAST(1, GREATEST(-1,
				         cos(radians($1)) * cos(radians(latitude::float8)) * cos(radians(longitude::float8) - radians($2))
				         + sin(radians($1)) * sin(radians(latitude::float8))
				       ))) AS distance_km
				FROM store
				WHERE status = 'ACTIVE' AND latitude IS NOT NULL AND longitude IS NOT NULL
			) s
			WHERE distance_km <= $3
			  AND ($4 = '' OR name ILIKE '%'||$4||'%' OR neighborhood ILIKE '%'||$4||'%' OR "primaryCategory" ILIKE '%'||$4||'%')
			  AND ($5 = '' OR "primaryCategory" ILIKE $5)
			ORDER BY distance_km ASC
			LIMIT $6`, *lat, *lng, radiusKM, q, category, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []NearbyStore
		for rows.Next() {
			var s NearbyStore
			if err := rows.Scan(&s.ID, &s.Slug, &s.Name, &s.Tagline, &s.LogoURL, &s.PrimaryCategory,
				&s.Neighborhood, &s.Latitude, &s.Longitude, &s.DistanceKM); err != nil {
				return nil, err
			}
			out = append(out, s)
		}
		return out, rows.Err()
	}

	// No device location — text/category search only, same visibility
	// rule and shape as ListStores, just filtered.
	rows, err := pool.Query(ctx, `
		SELECT id, slug, name, tagline, "logoUrl", "primaryCategory", neighborhood, latitude::text, longitude::text
		FROM store
		WHERE status = 'ACTIVE'
		  AND ($1 = '' OR name ILIKE '%'||$1||'%' OR neighborhood ILIKE '%'||$1||'%' OR "primaryCategory" ILIKE '%'||$1||'%')
		  AND ($2 = '' OR "primaryCategory" ILIKE $2)
		ORDER BY "createdAt" DESC
		LIMIT $3`, q, category, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NearbyStore
	for rows.Next() {
		var s NearbyStore
		if err := rows.Scan(&s.ID, &s.Slug, &s.Name, &s.Tagline, &s.LogoURL, &s.PrimaryCategory,
			&s.Neighborhood, &s.Latitude, &s.Longitude); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

type StoreDetail struct {
	StoreSummary
	AboutUs       *string
	ContactPhone  *string
	DeliveryZones []string
	CodEnabled    bool
	Currency      string
}

func GetStoreBySlug(ctx context.Context, pool *pgxpool.Pool, slug string) (*StoreDetail, error) {
	var d StoreDetail
	err := pool.QueryRow(ctx, `
		SELECT id, slug, name, tagline, "logoUrl", "primaryCategory", neighborhood, latitude::text, longitude::text,
		       "aboutUs", "contactPhone", "deliveryZones", "codEnabled", currency
		FROM store WHERE slug = $1 AND status = 'ACTIVE'`, slug).
		Scan(&d.ID, &d.Slug, &d.Name, &d.Tagline, &d.LogoURL, &d.PrimaryCategory, &d.Neighborhood, &d.Latitude, &d.Longitude,
			&d.AboutUs, &d.ContactPhone, &d.DeliveryZones, &d.CodEnabled, &d.Currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

type ProductSummary struct {
	ID               string
	Name             string
	PriceKES         string
	Category         *string
	ImageURL         *string
	StockQty         *int
	AvailableOnOrder bool
	// IsService is a display-only hint, not a schema field — a Product
	// with no tracked stock and availableOnOrder=true reads as a
	// service/sell-by-order listing rather than physical stock. See the
	// plan's "services are Products" decision.
	IsService bool
}

func ListStoreProducts(ctx context.Context, pool *pgxpool.Pool, storeID string) ([]ProductSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT p.id, p.name, p."priceKes"::text, p.category, p."stockQty", p."availableOnOrder",
		       (SELECT pi.url FROM product_image pi WHERE pi."productId" = p.id ORDER BY pi.position LIMIT 1)
		FROM product p
		WHERE p."storeId" = $1 AND p.status = 'ACTIVE'
		ORDER BY p."createdAt" DESC`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ProductSummary
	for rows.Next() {
		var p ProductSummary
		if err := rows.Scan(&p.ID, &p.Name, &p.PriceKES, &p.Category, &p.StockQty, &p.AvailableOnOrder, &p.ImageURL); err != nil {
			return nil, err
		}
		p.IsService = p.StockQty == nil && p.AvailableOnOrder
		out = append(out, p)
	}
	return out, rows.Err()
}

type ProductVariantRow struct {
	ID       string
	Label    string
	PriceKES string
	StockQty *int
}

type ProductDetail struct {
	ProductSummary
	Description *string
	Unit        *string
	StoreID     string
	StoreName   string
	StoreSlug   string
	Variants    []ProductVariantRow
}

func GetProduct(ctx context.Context, pool *pgxpool.Pool, id string) (*ProductDetail, error) {
	var d ProductDetail
	err := pool.QueryRow(ctx, `
		SELECT p.id, p.name, p."priceKes"::text, p.category, p."stockQty", p."availableOnOrder",
		       p.description, p.unit, s.id, s.name, s.slug
		FROM product p
		JOIN store s ON s.id = p."storeId"
		WHERE p.id = $1 AND p.status = 'ACTIVE'`, id).
		Scan(&d.ID, &d.Name, &d.PriceKES, &d.Category, &d.StockQty, &d.AvailableOnOrder,
			&d.Description, &d.Unit, &d.StoreID, &d.StoreName, &d.StoreSlug)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.IsService = d.StockQty == nil && d.AvailableOnOrder

	rows, err := pool.Query(ctx, `
		SELECT id, label, "priceKes"::text, "stockQty" FROM product_variant WHERE "productId" = $1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v ProductVariantRow
		if err := rows.Scan(&v.ID, &v.Label, &v.PriceKES, &v.StockQty); err != nil {
			return nil, err
		}
		d.Variants = append(d.Variants, v)
	}
	return &d, rows.Err()
}

// ── checkout ───────────────────────────────────────────────────────

type OrderItemInput struct {
	ProductID string
	VariantID *string
	Quantity  int
}

type CreateOrderInput struct {
	StoreSlug        string
	BuyerPartyID     *string
	BuyerName        string
	BuyerMsisdn      string
	PaymentMethod    string // MPESA_STK | CASH_ON_DELIVERY | VOUCHER
	VoucherID        *string
	Items            []OrderItemInput
	DeliveryOptionID *string
	DeliveryAddress  *string
	CollectionNotes  *string
}

type OrderError struct {
	Code    string // STORE_NOT_FOUND | COD_NOT_AVAILABLE | INSUFFICIENT_STOCK | EMPTY_ORDER | INVALID_ITEM
	Message string
}

func (e *OrderError) Error() string { return e.Message }

// CreateStoreOrder mirrors createStoreOrder's core rules: stock/
// order-first validation, a cost snapshot per line so gross profit
// survives later price edits, and an auto-matched StoreCustomer by
// (storeId, msisdn). Simplified from the TS version: no org-on-behalf-of
// buying, no reroute flagging — buyer-only mobile v1.
func CreateStoreOrder(ctx context.Context, pool *pgxpool.Pool, in CreateOrderInput) (orderID string, totalKES string, err error) {
	if len(in.Items) == 0 {
		return "", "", &OrderError{"EMPTY_ORDER", "An order needs at least one item"}
	}

	store, err := GetStoreBySlug(ctx, pool, in.StoreSlug)
	if err != nil {
		return "", "", err
	}
	if store == nil {
		return "", "", &OrderError{"STORE_NOT_FOUND", "That store is not available"}
	}
	if in.PaymentMethod == "CASH_ON_DELIVERY" && !store.CodEnabled {
		return "", "", &OrderError{"COD_NOT_AVAILABLE", "This store does not accept cash on delivery"}
	}
	if in.PaymentMethod == "VOUCHER" && (in.VoucherID == nil || *in.VoucherID == "") {
		return "", "", &OrderError{"VOUCHER_REQUIRED", "Choose a voucher to pay with"}
	}
	if in.PaymentMethod != "MPESA_STK" && in.PaymentMethod != "CASH_ON_DELIVERY" && in.PaymentMethod != "VOUCHER" {
		return "", "", &OrderError{"INVALID_ITEM", "Payment method must be MPESA_STK, CASH_ON_DELIVERY or VOUCHER"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)

	total := 0.0
	type lockedLine struct {
		productID, variantID *string
		unitPriceKES         float64
		costKES              *float64
		quantity             int
	}
	var lines []lockedLine

	for _, item := range in.Items {
		var priceKESText string
		var costKESText *string
		var stockQty *int
		var availableOnOrder bool
		var status string

		if item.VariantID != nil {
			err = tx.QueryRow(ctx, `
				SELECT pv."priceKes"::text, p."costKes"::text, pv."stockQty", p."availableOnOrder", p.status
				FROM product_variant pv
				JOIN product p ON p.id = pv."productId"
				WHERE pv.id = $1 AND p.id = $2 AND p."storeId" = $3
				FOR UPDATE OF pv`, *item.VariantID, item.ProductID, store.ID).
				Scan(&priceKESText, &costKESText, &stockQty, &availableOnOrder, &status)
		} else {
			err = tx.QueryRow(ctx, `
				SELECT "priceKes"::text, "costKes"::text, "stockQty", "availableOnOrder", status
				FROM product WHERE id = $1 AND "storeId" = $2
				FOR UPDATE`, item.ProductID, store.ID).
				Scan(&priceKESText, &costKESText, &stockQty, &availableOnOrder, &status)
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", &OrderError{"INVALID_ITEM", "One of the items in this order is no longer available"}
		}
		if err != nil {
			return "", "", err
		}
		if status != "ACTIVE" {
			return "", "", &OrderError{"INVALID_ITEM", "One of the items in this order is no longer available"}
		}
		if stockQty != nil && *stockQty < item.Quantity && !availableOnOrder {
			return "", "", &OrderError{"INSUFFICIENT_STOCK", "Not enough stock for one of the items in this order"}
		}

		priceKES, err := strconv.ParseFloat(priceKESText, 64)
		if err != nil {
			return "", "", err
		}
		var costKES *float64
		if costKESText != nil {
			c, err := strconv.ParseFloat(*costKESText, 64)
			if err != nil {
				return "", "", err
			}
			costKES = &c
		}

		total += priceKES * float64(item.Quantity)
		lines = append(lines, lockedLine{&item.ProductID, item.VariantID, priceKES, costKES, item.Quantity})
	}

	var deliveryFeeKES *float64
	if in.DeliveryOptionID != nil {
		var feeText string
		err = tx.QueryRow(ctx, `
			SELECT "feeKes"::text FROM fulfilment_option WHERE id = $1 AND "storeId" = $2 AND active`,
			*in.DeliveryOptionID, store.ID).Scan(&feeText)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", &OrderError{"INVALID_ITEM", "That delivery option is not available"}
		}
		if err != nil {
			return "", "", err
		}
		fee, err := strconv.ParseFloat(feeText, 64)
		if err != nil {
			return "", "", err
		}
		deliveryFeeKES = &fee
		total += fee
	}

	// Auto-match/create the StoreCustomer this order belongs to, same
	// (storeId, msisdn) natural key as findOrCreateCustomer.
	var customerID string
	err = tx.QueryRow(ctx, `
		INSERT INTO store_customer (id, "storeId", msisdn, name, "partyId", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
		ON CONFLICT ("storeId", msisdn) DO UPDATE SET "updatedAt" = now()
		RETURNING id`, store.ID, in.BuyerMsisdn, in.BuyerName, in.BuyerPartyID).Scan(&customerID)
	if err != nil {
		return "", "", err
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO store_order (
			id, "storeId", "buyerPartyId", "buyerName", "buyerMsisdn", status, "paymentMethod",
			"totalKes", "deliveryOptionId", "deliveryFeeKes", "collectionNotes", "deliveryAddress",
			"customerId", "voucherId", "createdAt"
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, 'PENDING_PAYMENT', $5,
			$6, $7, $8, $9, $10, $11, $12, now()
		) RETURNING id`,
		store.ID, in.BuyerPartyID, in.BuyerName, in.BuyerMsisdn, in.PaymentMethod,
		total, in.DeliveryOptionID, deliveryFeeKES, in.CollectionNotes, in.DeliveryAddress, customerID, in.VoucherID).
		Scan(&orderID)
	if err != nil {
		return "", "", err
	}

	for _, l := range lines {
		_, err = tx.Exec(ctx, `
			INSERT INTO store_order_item (id, "orderId", "productId", "variantId", quantity, "unitPriceKes", "costKes")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
			orderID, *l.productID, l.variantID, l.quantity, l.unitPriceKES, l.costKES)
		if err != nil {
			return "", "", err
		}

		if l.variantID != nil {
			_, err = tx.Exec(ctx, `
				UPDATE product_variant SET "stockQty" = GREATEST("stockQty" - $1, 0)
				WHERE id = $2 AND "stockQty" IS NOT NULL`, l.quantity, *l.variantID)
		} else {
			_, err = tx.Exec(ctx, `
				UPDATE product SET "stockQty" = GREATEST("stockQty" - $1, 0)
				WHERE id = $2 AND "stockQty" IS NOT NULL`, l.quantity, *l.productID)
		}
		if err != nil {
			return "", "", err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	// VOUCHER settles inline (no STK round-trip): debit the purpose-locked
	// card, post the merchant ledger, mark PAID. Spend failure cancels the
	// order so stock/accounting never diverge from money movement.
	if in.PaymentMethod == "VOUCHER" {
		if err := SettleStoreOrderVoucher(ctx, pool, orderID, *in.VoucherID, true); err != nil {
			if oerr, ok := err.(*OrderError); ok {
				return "", "", oerr
			}
			return "", "", &OrderError{"VOUCHER_FAILED", err.Error()}
		}
		return orderID, fmt.Sprintf("%.2f", total), nil
	}
	return orderID, fmt.Sprintf("%.2f", total), nil
}

// SettleStoreOrderVoucher debits a SHOPPING|GENERAL voucher for a
// PENDING_PAYMENT order and marks it PAID. Idempotent per order.
func SettleStoreOrderVoucher(ctx context.Context, pool *pgxpool.Pool, orderID, voucherID string, loyaltyEnabled bool) error {
	var status, totalText, storeID string
	var buyerParty *string
	if err := pool.QueryRow(ctx, `SELECT status::text, "totalKes"::text, "storeId", "buyerPartyId"::text FROM store_order WHERE id = $1`, orderID).
		Scan(&status, &totalText, &storeID, &buyerParty); err != nil {
		return err
	}
	if status != "PENDING_PAYMENT" {
		return nil
	}
	total, err := strconv.ParseFloat(totalText, 64)
	if err != nil {
		return err
	}
	var enterpriseParty string
	if err := pool.QueryRow(ctx, `SELECT e."partyId" FROM store s JOIN enterprise e ON e.id = s."enterpriseId" WHERE s.id = $1`, storeID).Scan(&enterpriseParty); err != nil {
		return err
	}
	settlement, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return err
	}
	revenue, err := ledger.EnsureAccount(ctx, pool, &enterpriseParty, "STORE_REVENUE", "KES")
	if err != nil {
		return err
	}
	entryID, err := ledger.PostEntry(ctx, pool, "store-order:"+orderID, "Store order voucher payment", "core-go:store-order:"+orderID,
		[]ledger.Posting{{AccountID: settlement, AmountKES: total}, {AccountID: revenue, AmountKES: -total}})
	if err != nil {
		return err
	}
	if err := SpendVoucher(ctx, pool, voucherID, "SHOPPING", int(total*10+0.5), "store-order:"+orderID, entryID); err != nil {
		_, _ = pool.Exec(ctx, `UPDATE store_order SET status = 'CANCELLED' WHERE id = $1`, orderID)
		if _, ok := err.(*FleetError); ok {
			return &OrderError{"VOUCHER_FAILED", err.Error()}
		}
		return err
	}
	if _, err := pool.Exec(ctx, `UPDATE store_order SET status = 'PAID', "paidAt" = now(), "journalEntryId" = $1 WHERE id = $2`, entryID, orderID); err != nil {
		return err
	}
	_ = earnStoreLoyalty(ctx, pool, orderID, storeID, total)
	if buyerParty != nil && *buyerParty != "" {
		_ = earnUnifiedLoyalty(ctx, pool, *buyerParty, total, "store-order:"+orderID, loyaltyEnabled)
	}
	return nil
}

func AttachOrderCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, orderID, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `UPDATE store_order SET "mpesaCheckoutRequestId" = $1 WHERE id = $2`, checkoutRequestID, orderID)
	return err
}

// ConfirmStoreOrderPaymentByCheckoutID mirrors confirmStoreOrderPayment's
// M-Pesa callback path: idempotent on checkoutRequestId (a replayed
// callback is a no-op, not an error), posts to the ledger, earns
// loyalty if the store has it enabled. Returns ErrOrderNotFound so the
// webhook dispatcher (which tries store orders then bookings in
// sequence) knows to fall through — same "only continue on NOT_FOUND"
// shape services/core/src/index.ts uses.
var ErrOrderNotFound = errors.New("no order for that checkout request")

func ConfirmStoreOrderPaymentByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID string, loyaltyEnabled bool) error {
	var orderID, status, totalKESText, storeID string
	var buyerParty *string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "totalKes"::text, "storeId", "buyerPartyId"::text FROM store_order
		WHERE "mpesaCheckoutRequestId" = $1`, checkoutRequestID).
		Scan(&orderID, &status, &totalKESText, &storeID, &buyerParty)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrOrderNotFound
	}
	if err != nil {
		return err
	}
	if status != "PENDING_PAYMENT" {
		return nil // already confirmed — replayed callback
	}

	totalKES, err := strconv.ParseFloat(totalKESText, 64)
	if err != nil {
		return err
	}

	var storeEnterprisePartyID string
	err = pool.QueryRow(ctx, `
		SELECT e."partyId" FROM store s JOIN enterprise e ON e.id = s."enterpriseId"
		WHERE s.id = $1`, storeID).Scan(&storeEnterprisePartyID)
	if err != nil {
		return err
	}

	settlementAcct, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return err
	}
	revenueAcct, err := ledger.EnsureAccount(ctx, pool, &storeEnterprisePartyID, "STORE_REVENUE", "KES")
	if err != nil {
		return err
	}
	journalEntryID, err := ledger.PostEntry(ctx, pool,
		"store-order:"+orderID, "Store order payment", "core-go:store-order:"+orderID,
		[]ledger.Posting{{AccountID: settlementAcct, AmountKES: totalKES}, {AccountID: revenueAcct, AmountKES: -totalKES}})
	if err != nil {
		return err
	}

	// A pickup code is generated here, not at order creation, because
	// it's only meaningful once money has actually moved — an unpaid
	// order has nothing for a buyer to collect. Only PICKUP orders get
	// one; DELIVERY orders never do.
	var pickupCode *string
	var fulfilmentKind *string
	err = pool.QueryRow(ctx, `
		SELECT fo.kind FROM store_order so LEFT JOIN fulfilment_option fo ON fo.id = so."deliveryOptionId"
		WHERE so.id = $1`, orderID).Scan(&fulfilmentKind)
	if err != nil {
		return err
	}
	if fulfilmentKind != nil && *fulfilmentKind == "PICKUP" {
		code, err := generatePickupCodeWithRetry(ctx, pool)
		if err != nil {
			return err
		}
		pickupCode = &code
	}

	_, err = pool.Exec(ctx, `
		UPDATE store_order SET status = 'PAID', "paidAt" = now(), "journalEntryId" = $1, "pickupCode" = $2 WHERE id = $3`,
		journalEntryID, pickupCode, orderID)
	if err != nil {
		return err
	}

	_ = earnStoreLoyalty(ctx, pool, orderID, storeID, totalKES)
	if buyerParty != nil && *buyerParty != "" {
		_ = earnUnifiedLoyalty(ctx, pool, *buyerParty, totalKES, "store-order:"+orderID, loyaltyEnabled)
	}
	return nil
}

// generatePickupCode mirrors generateTicketCode's alphabet trick,
// shorter (6 chars, not 10) — a pickup code is read aloud by a human
// at a counter, not scanned, so it stays short but keeps the same
// no-ambiguous-characters alphabet.
func generatePickupCode() (string, error) {
	b := make([]byte, 6)
	if _, err := cryptorand.Read(b); err != nil {
		return "", err
	}
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I ambiguity
	out := make([]byte, 6)
	for i := range out {
		out[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return "PKP-" + string(out), nil
}

// generatePickupCodeWithRetry retries on the rare unique-constraint
// collision rather than trusting the keyspace is large enough to never
// need to (33^6 ≈ 1.29B, but a retry loop costs nothing and turns a
// theoretical collision into a non-event instead of a failed checkout).
func generatePickupCodeWithRetry(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	for range 5 {
		code, err := generatePickupCode()
		if err != nil {
			return "", err
		}
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM store_order WHERE "pickupCode" = $1)`, code).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("could not generate a unique pickup code")
}

// earnStoreLoyalty mirrors earnLoyaltyForSale's effect for an order
// checkout — only if the store has loyalty on, points floored per whole
// KES spent.
func earnStoreLoyalty(ctx context.Context, pool *pgxpool.Pool, orderID, storeID string, totalKES float64) error {
	var loyaltyEnabled bool
	var loyaltyPerKes int
	if err := pool.QueryRow(ctx, `
		SELECT "loyaltyEnabled", "loyaltyPerKes" FROM store WHERE id = $1`, storeID).
		Scan(&loyaltyEnabled, &loyaltyPerKes); err != nil {
		return err
	}
	if !loyaltyEnabled {
		return nil
	}

	var customerID string
	if err := pool.QueryRow(ctx, `SELECT "customerId" FROM store_order WHERE id = $1`, orderID).Scan(&customerID); err != nil {
		return err
	}
	points := int(totalKES) * loyaltyPerKes
	_, err := pool.Exec(ctx, `
		INSERT INTO loyalty_entry (id, "customerId", points, kind, "orderId", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, 'EARN', $3, now())`, customerID, points, orderID)
	return err
}

// orderStatusSelect is shared by GetStoreOrder and ListOrdersForParty —
// everything a buyer's order-detail screen needs in one call, since
// GetOrder is already public-by-id (the order id is the secret, same
// convention as getOrder in store-order.ts). The LEFT JOIN to
// fulfilment_option is how a buyer knows this is even a pickup order
// at all (deliveryOptionId is nullable, and a DELIVERY-fulfilled order
// carries no pickup code).
const orderStatusSelect = `
	SELECT so.id, s.name, so.status::text, so."totalKes"::text, so."createdAt"::text,
	       so."pickupCode", so."readyAt"::text, fo.kind,
	       s.neighborhood, s.latitude::text, s.longitude::text
	FROM store_order so
	JOIN store s ON s.id = so."storeId"
	LEFT JOIN fulfilment_option fo ON fo.id = so."deliveryOptionId"`

type OrderStatus struct {
	ID                string
	StoreName         string
	Status            string
	TotalKES          string
	CreatedAt         string
	PickupCode        *string
	ReadyAt           *string
	FulfilmentKind    *string // PICKUP | DELIVERY, nil if no fulfilment option was chosen
	StoreNeighborhood *string
	StoreLatitude     *string
	StoreLongitude    *string
}

func scanOrderStatus(row pgx.Row) (*OrderStatus, error) {
	var o OrderStatus
	err := row.Scan(&o.ID, &o.StoreName, &o.Status, &o.TotalKES, &o.CreatedAt,
		&o.PickupCode, &o.ReadyAt, &o.FulfilmentKind,
		&o.StoreNeighborhood, &o.StoreLatitude, &o.StoreLongitude)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func GetStoreOrder(ctx context.Context, pool *pgxpool.Pool, orderID string) (*OrderStatus, error) {
	o, err := scanOrderStatus(pool.QueryRow(ctx, orderStatusSelect+` WHERE so.id = $1`, orderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return o, nil
}

func ListOrdersForParty(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]OrderStatus, error) {
	rows, err := pool.Query(ctx, orderStatusSelect+`
		WHERE so."buyerPartyId" = $1
		ORDER BY so."createdAt" DESC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrderStatus
	for rows.Next() {
		o, err := scanOrderStatus(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// requireStoreOwner is the shared authorization check for both pickup
// management actions below. core-go has no separate staff-PIN login
// (Cashier/TicketOrgStaff are TS-only POS concepts) — a store's own
// Esoko account, the same one it would use to buy something, is who's
// allowed to manage that store's pickup orders. Mirrors the
// groups/treasury "officer" check: same signed-in-party pattern, no
// new auth subsystem. Returns the store id and a FORBIDDEN OrderError
// when actingPartyID isn't the owner.
func requireStoreOwner(ctx context.Context, pool *pgxpool.Pool, orderID, actingPartyID string) (storeID string, err error) {
	var ownerPartyID string
	err = pool.QueryRow(ctx, `
		SELECT s.id, e."partyId"
		FROM store_order so
		JOIN store s ON s.id = so."storeId"
		JOIN enterprise e ON e.id = s."enterpriseId"
		WHERE so.id = $1`, orderID).Scan(&storeID, &ownerPartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &OrderError{"NOT_FOUND", "That order was not found"}
	}
	if err != nil {
		return "", err
	}
	if actingPartyID == "" || actingPartyID != ownerPartyID {
		return "", &OrderError{"FORBIDDEN", "You don't manage this store"}
	}
	return storeID, nil
}

// MarkOrderReadyForPickup — the store side of the "click & collect"
// flow: PAID → READY_FOR_PICKUP, only for orders whose chosen
// fulfilment option is PICKUP. Backfills pickupCode if somehow still
// empty (a COD-at-pickup order never passed through
// ConfirmStoreOrderPaymentByCheckoutID's PAID transition, since COD
// has no STK confirmation step in mobile v1 — this is the fallback so
// the flow still works end to end for that edge case).
func MarkOrderReadyForPickup(ctx context.Context, pool *pgxpool.Pool, orderID, actingPartyID string) error {
	if _, err := requireStoreOwner(ctx, pool, orderID, actingPartyID); err != nil {
		return err
	}

	var status string
	var fulfilmentKind *string
	var pickupCode *string
	err := pool.QueryRow(ctx, `
		SELECT so.status::text, fo.kind, so."pickupCode"
		FROM store_order so LEFT JOIN fulfilment_option fo ON fo.id = so."deliveryOptionId"
		WHERE so.id = $1`, orderID).Scan(&status, &fulfilmentKind, &pickupCode)
	if err != nil {
		return err
	}
	if status != "PAID" {
		return &OrderError{"INVALID_STATUS", "Only a paid order can be marked ready for pickup"}
	}
	if fulfilmentKind == nil || *fulfilmentKind != "PICKUP" {
		return &OrderError{"NOT_PICKUP", "This order isn't a pickup order"}
	}
	if pickupCode == nil {
		code, err := generatePickupCodeWithRetry(ctx, pool)
		if err != nil {
			return err
		}
		pickupCode = &code
	}

	_, err = pool.Exec(ctx, `
		UPDATE store_order SET status = 'READY_FOR_PICKUP', "readyAt" = now(), "pickupCode" = $1 WHERE id = $2`,
		pickupCode, orderID)
	return err
}

// ConfirmOrderCollected — READY_FOR_PICKUP → FULFILLED, only once the
// code the staff member typed in matches what the buyer was shown.
// Comparison is case-insensitive (a human reading a code aloud won't
// reliably preserve case) but otherwise exact — no partial match.
func ConfirmOrderCollected(ctx context.Context, pool *pgxpool.Pool, orderID, actingPartyID, code string) error {
	if _, err := requireStoreOwner(ctx, pool, orderID, actingPartyID); err != nil {
		return err
	}

	var status string
	var pickupCode *string
	err := pool.QueryRow(ctx, `SELECT status::text, "pickupCode" FROM store_order WHERE id = $1`, orderID).
		Scan(&status, &pickupCode)
	if err != nil {
		return err
	}
	if status != "READY_FOR_PICKUP" {
		return &OrderError{"INVALID_STATUS", "This order isn't ready for pickup"}
	}
	if pickupCode == nil || !strings.EqualFold(strings.TrimSpace(code), *pickupCode) {
		return &OrderError{"WRONG_CODE", "That pickup code doesn't match"}
	}

	_, err = pool.Exec(ctx, `
		UPDATE store_order SET status = 'FULFILLED', "collectedAt" = now() WHERE id = $1`, orderID)
	return err
}
