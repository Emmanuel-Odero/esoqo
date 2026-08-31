// Package dbx (store.go) ports the buyer-facing slice of
// packages/db/src/dal/store.ts, product.ts and store-order.ts — public
// browse + checkout only. Merchant/PoS/reporting functions from those
// files stay TypeScript-only; there's no mobile buyer screen that needs
// them (see docs/adr/0005-mobile-api-in-go.md's "mobile v1 scope" note).
package dbx

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/ledger"
)

type StoreSummary struct {
	ID              string
	Slug            string
	Name            string
	Tagline         *string
	LogoURL         *string
	PrimaryCategory *string
}

// ListStores — public storefront directory. Only ACTIVE stores, same
// visibility rule as listPublicStores in store.ts.
func ListStores(ctx context.Context, pool *pgxpool.Pool, limit, offset int) ([]StoreSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, slug, name, tagline, "logoUrl", "primaryCategory"
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
		if err := rows.Scan(&s.ID, &s.Slug, &s.Name, &s.Tagline, &s.LogoURL, &s.PrimaryCategory); err != nil {
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
		SELECT id, slug, name, tagline, "logoUrl", "primaryCategory",
		       "aboutUs", "contactPhone", "deliveryZones", "codEnabled", currency
		FROM store WHERE slug = $1 AND status = 'ACTIVE'`, slug).
		Scan(&d.ID, &d.Slug, &d.Name, &d.Tagline, &d.LogoURL, &d.PrimaryCategory,
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
	PaymentMethod    string // MPESA_STK | CASH_ON_DELIVERY
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
			"customerId", "createdAt"
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, 'PENDING_PAYMENT', $5,
			$6, $7, $8, $9, $10, $11, now()
		) RETURNING id`,
		store.ID, in.BuyerPartyID, in.BuyerName, in.BuyerMsisdn, in.PaymentMethod,
		total, in.DeliveryOptionID, deliveryFeeKES, in.CollectionNotes, in.DeliveryAddress, customerID).
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
	return orderID, fmt.Sprintf("%.2f", total), nil
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

func ConfirmStoreOrderPaymentByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID string) error {
	var orderID, status, totalKESText, storeID string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "totalKes"::text, "storeId" FROM store_order
		WHERE "mpesaCheckoutRequestId" = $1`, checkoutRequestID).
		Scan(&orderID, &status, &totalKESText, &storeID)
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

	_, err = pool.Exec(ctx, `
		UPDATE store_order SET status = 'PAID', "paidAt" = now(), "journalEntryId" = $1 WHERE id = $2`,
		journalEntryID, orderID)
	if err != nil {
		return err
	}

	return earnStoreLoyalty(ctx, pool, orderID, storeID, totalKES)
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

type OrderStatus struct {
	ID        string
	StoreName string
	Status    string
	TotalKES  string
	CreatedAt string
}

func GetStoreOrder(ctx context.Context, pool *pgxpool.Pool, orderID string) (*OrderStatus, error) {
	var o OrderStatus
	err := pool.QueryRow(ctx, `
		SELECT so.id, s.name, so.status::text, so."totalKes"::text, so."createdAt"::text
		FROM store_order so JOIN store s ON s.id = so."storeId"
		WHERE so.id = $1`, orderID).
		Scan(&o.ID, &o.StoreName, &o.Status, &o.TotalKES, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func ListOrdersForParty(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]OrderStatus, error) {
	rows, err := pool.Query(ctx, `
		SELECT so.id, s.name, so.status::text, so."totalKes"::text, so."createdAt"::text
		FROM store_order so JOIN store s ON s.id = so."storeId"
		WHERE so."buyerPartyId" = $1
		ORDER BY so."createdAt" DESC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrderStatus
	for rows.Next() {
		var o OrderStatus
		if err := rows.Scan(&o.ID, &o.StoreName, &o.Status, &o.TotalKES, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
