// Package dbx (saved_stores.go) — "My spots": a person's own bookmark
// list of stores, plus what it makes possible on read — the buyer's
// "usual" product at a saved store, derived fresh from StoreOrder/
// StoreOrderItem history every time, never cached (same "computed, not
// stored" principle as a group's balance elsewhere in this package).
// No capability gate beyond being signed in: this is a person's own
// data about their own account, the same shape as ListMyGroups/
// ListMyTicketOrgs, not a resource anyone else's session could reach.
package dbx

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SaveStore — idempotent: saving an already-saved store is a no-op, not
// an error. The star icon toggles on tap; a double-tap racing the
// network must never surface as a failure the person has to dismiss.
func SaveStore(ctx context.Context, pool *pgxpool.Pool, partyID, storeID string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO saved_store (id, "partyId", "storeId", "savedAt")
		VALUES (gen_random_uuid(), $1, $2, now())
		ON CONFLICT ("partyId", "storeId") DO NOTHING`, partyID, storeID)
	return err
}

// UnsaveStore is likewise idempotent — unsaving something not saved is
// a no-op DELETE, not a NOT_FOUND the client has to special-case.
func UnsaveStore(ctx context.Context, pool *pgxpool.Pool, partyID, storeID string) error {
	_, err := pool.Exec(ctx, `DELETE FROM saved_store WHERE "partyId" = $1 AND "storeId" = $2`, partyID, storeID)
	return err
}

// SavedStoreRow mirrors StoreSummary's own field names (see store.go)
// so the mobile client can reuse StoreSummary.fromJson's parsing
// directly — same fields, same PascalCase-straight-through-gin.JSON
// convention, one SavedAt timestamp added.
type SavedStoreRow struct {
	ID              string
	Slug            string
	Name            string
	Tagline         *string
	LogoURL         *string
	PrimaryCategory *string
	SavedAt         string
}

func ListSavedStores(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]SavedStoreRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.id, s.slug, s.name, s.tagline, s."logoUrl", s."primaryCategory", ss."savedAt"::text
		FROM saved_store ss
		JOIN store s ON s.id = ss."storeId"
		WHERE ss."partyId" = $1
		ORDER BY ss."savedAt" DESC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SavedStoreRow
	for rows.Next() {
		var r SavedStoreRow
		if err := rows.Scan(&r.ID, &r.Slug, &r.Name, &r.Tagline, &r.LogoURL, &r.PrimaryCategory, &r.SavedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UsualProductRow — the buyer's most-frequently-ordered product (and
// variant, when they picked one) at one store: the answer to "order the
// usual". Ranked by how many separate orders included it, not total
// quantity — someone who buys one loaf of bread every week has a
// clearer "usual" than a single large one-off order would suggest.
type UsualProductRow struct {
	ProductID string
	Name      string
	PriceKES  string
	VariantID *string
}

// UsualProduct — nil, not an error, when this buyer has never ordered
// from this store (the overwhelming common case the first time anyone
// visits) so the caller can render "no usual yet" instead of handling
// a spurious NOT_FOUND.
func UsualProduct(ctx context.Context, pool *pgxpool.Pool, partyID, storeID string) (*UsualProductRow, error) {
	var r UsualProductRow
	err := pool.QueryRow(ctx, `
		SELECT p.id, p.name, p."priceKes"::text, soi."variantId"
		FROM store_order_item soi
		JOIN store_order so ON so.id = soi."orderId"
		JOIN product p ON p.id = soi."productId"
		WHERE so."storeId" = $1 AND so."buyerPartyId" = $2
		GROUP BY p.id, p.name, p."priceKes", soi."variantId"
		ORDER BY count(*) DESC, max(so."createdAt") DESC
		LIMIT 1`, storeID, partyID).
		Scan(&r.ProductID, &r.Name, &r.PriceKES, &r.VariantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}
