// Package dbx (self_checkout.go) — mall/supermarket self-checkout: a
// basket built from scanning shelf barcodes one at a time (see
// CreateOrderInput.IsSelfCheckout), paid at the door, then walked out
// on the same pickupCode mechanism a click-and-collect order uses (see
// generatePickupCodeWithRetry in store.go) — a guard's exit check and
// a pickup counter's collection check are the same shape, just gated
// by a different reason and a different terminal transition (PAID
// straight to FULFILLED, never passing through READY_FOR_PICKUP, so
// ConfirmOrderCollected's status gate can't be reused unmodified).
package dbx

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ExitCodeResult is the guard-facing "public-safe projection" of a
// self-checkout order: paid/unpaid + item count only, never the
// buyer's name or msisdn — same PII-minimal rule ResolveTicketByCode
// already follows for a guest-safe scan.
type ExitCodeResult struct {
	OrderID       string
	ItemCount     int
	TotalKES      string
	AlreadyExited bool
}

// ResolveExitCode is the guard's verification step for a mall
// self-checkout basket. Store-owner-scoped (requireStoreOwnerByID) —
// the same "no separate staff-PIN login yet" pattern dine_in.go's
// table board already runs under, a fast-follow noted there and here
// rather than built now. Re-checking an already-exited code is not an
// error: it returns AlreadyExited so a guard re-scanning the same
// basket on a slow network doesn't see a false failure.
func ResolveExitCode(ctx context.Context, pool *pgxpool.Pool, storeSlug, actingPartyID, code string) (*ExitCodeResult, error) {
	store, err := GetStoreBySlug(ctx, pool, storeSlug)
	if err != nil {
		return nil, err
	}
	if store == nil {
		return nil, &OrderError{"STORE_NOT_FOUND", "That store was not found"}
	}
	if err := requireStoreOwnerByID(ctx, pool, store.ID, actingPartyID); err != nil {
		return nil, err
	}

	normalized := strings.ToUpper(strings.TrimSpace(code))
	var orderID, status, totalKESText string
	err = pool.QueryRow(ctx, `
		SELECT id, status::text, "totalKes"::text FROM store_order
		WHERE "storeId" = $1 AND "isSelfCheckout" AND "pickupCode" = $2`,
		store.ID, normalized).Scan(&orderID, &status, &totalKESText)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &OrderError{"WRONG_CODE", "That code doesn't match a self-checkout order here"}
	}
	if err != nil {
		return nil, err
	}

	var itemCount int
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(quantity), 0) FROM store_order_item WHERE "orderId" = $1`, orderID).
		Scan(&itemCount); err != nil {
		return nil, err
	}

	if status == "FULFILLED" {
		return &ExitCodeResult{OrderID: orderID, ItemCount: itemCount, TotalKES: totalKESText, AlreadyExited: true}, nil
	}
	if status != "PAID" {
		return nil, &OrderError{"NOT_PAID", "This order hasn't been paid for yet"}
	}

	_, err = pool.Exec(ctx, `
		UPDATE store_order SET status = 'FULFILLED', "collectedAt" = now() WHERE id = $1`, orderID)
	if err != nil {
		return nil, err
	}
	return &ExitCodeResult{OrderID: orderID, ItemCount: itemCount, TotalKES: totalKESText}, nil
}
