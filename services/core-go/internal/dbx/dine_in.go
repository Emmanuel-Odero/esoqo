// Package dbx (dine_in.go) — the eatery half of Shopping: a scanned
// table QR's order now actually carries the table (see
// CreateOrderInput.TableLabel in store.go — the universal scanner's own
// comment always claimed this, this file is what makes it true), a
// kitchen-facing status separate from the retail StoreOrderStatus
// lifecycle, table assignment, and tips.
//
// No per-cashier PIN sign-in yet (see TableAssignment's own schema
// comment) — table management here is store-owner-scoped, the same
// "core-go has no separate staff-PIN login" pattern requireStoreOwner
// in store.go already established for pickup orders. A named waiter is
// still tracked and credited (TableAssignment.cashierId, StoreOrder.
// tippedCashierId) — the owner just does the assigning today, on a
// shared device at the host stand, same as OrgFleetScreen already lets
// a fleet owner run trips without every driver having their own login.
package dbx

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var validDineInStatus = map[string]bool{
	"ORDERED": true, "PREPARING": true, "SERVED": true, "PAYING": true, "CLOSED": true,
}

// requireStoreOwnerByID mirrors requireStoreOwner (store.go) for the
// store-scoped writes below (AssignTable, ListTableOrders) that aren't
// anchored to one order.
func requireStoreOwnerByID(ctx context.Context, pool *pgxpool.Pool, storeID, actingPartyID string) error {
	var ownerPartyID string
	err := pool.QueryRow(ctx, `
		SELECT e."partyId" FROM store s JOIN enterprise e ON e.id = s."enterpriseId" WHERE s.id = $1`, storeID).
		Scan(&ownerPartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &OrderError{"STORE_NOT_FOUND", "That store was not found"}
	}
	if err != nil {
		return err
	}
	if actingPartyID == "" || actingPartyID != ownerPartyID {
		return &OrderError{"FORBIDDEN", "You don't manage this store"}
	}
	return nil
}

// CashierRow — a store's staff roster. core-go had no cashier
// list/create at all before this: apps/store (TS) manages cashiers
// today, and nothing here let the table board even see who to assign a
// table to. PinHash is never returned.
type CashierRow struct {
	ID     string
	Name   string
	Role   string
	Active bool
}

// CreateCashier — store-owner-scoped, same authority as everything
// else in this file. A PIN is still required at creation (not merely a
// name) even though sign-in isn't wired up yet — so a later cashier
// PIN sign-in (the fast-follow TableAssignment's own comment flags)
// never needs a second "add a PIN retroactively" migration.
func CreateCashier(ctx context.Context, pool *pgxpool.Pool, storeID, name, pinHash, role, actingPartyID string) (*CashierRow, error) {
	if err := requireStoreOwnerByID(ctx, pool, storeID, actingPartyID); err != nil {
		return nil, err
	}
	if role != "CASHIER" && role != "MANAGER" {
		role = "CASHIER"
	}
	var r CashierRow
	err := pool.QueryRow(ctx, `
		INSERT INTO cashier (id, "storeId", name, "pinHash", role, active, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, true, now(), now())
		RETURNING id, name, role, active`, storeID, name, pinHash, role).
		Scan(&r.ID, &r.Name, &r.Role, &r.Active)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func ListCashiers(ctx context.Context, pool *pgxpool.Pool, storeID, actingPartyID string) ([]CashierRow, error) {
	if err := requireStoreOwnerByID(ctx, pool, storeID, actingPartyID); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT id, name, role, active FROM cashier WHERE "storeId" = $1 ORDER BY name ASC`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CashierRow
	for rows.Next() {
		var r CashierRow
		if err := rows.Scan(&r.ID, &r.Name, &r.Role, &r.Active); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AssignTable — (re)assigns a table to a named staff member for the
// rest of the shift. Ends any prior active assignment for that exact
// table first rather than deleting it, so "who served table 4 at 8pm
// last Tuesday" stays answerable later.
func AssignTable(ctx context.Context, pool *pgxpool.Pool, storeID, tableLabel, cashierID, actingPartyID string) (string, error) {
	if err := requireStoreOwnerByID(ctx, pool, storeID, actingPartyID); err != nil {
		return "", err
	}
	var cashierStoreID string
	if err := pool.QueryRow(ctx, `SELECT "storeId" FROM cashier WHERE id = $1 AND active = true`, cashierID).Scan(&cashierStoreID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", &OrderError{"NOT_FOUND", "That staff member was not found"}
		}
		return "", err
	}
	if cashierStoreID != storeID {
		return "", &OrderError{"INVALID_ITEM", "That staff member belongs to another store"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		UPDATE table_assignment SET "endedAt" = now()
		WHERE "storeId" = $1 AND "tableLabel" = $2 AND "endedAt" IS NULL`, storeID, tableLabel)
	if err != nil {
		return "", err
	}
	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO table_assignment (id, "storeId", "tableLabel", "cashierId", "assignedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, now())
		RETURNING id`, storeID, tableLabel, cashierID).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

// UpdateDineInStatus — kitchen/floor status only; never touches
// StoreOrderStatus (payment/pickup), a fully separate lifecycle (see
// DineInStatus's own schema comment).
func UpdateDineInStatus(ctx context.Context, pool *pgxpool.Pool, orderID, status, actingPartyID string) error {
	if !validDineInStatus[status] {
		return &OrderError{"INVALID_ITEM", "Status must be ORDERED, PREPARING, SERVED, PAYING or CLOSED"}
	}
	storeID, err := requireStoreOwner(ctx, pool, orderID, actingPartyID)
	if err != nil {
		return err
	}
	var tableLabel *string
	if err := pool.QueryRow(ctx, `SELECT "tableLabel" FROM store_order WHERE id = $1`, orderID).Scan(&tableLabel); err != nil {
		return err
	}
	if tableLabel == nil {
		return &OrderError{"INVALID_ITEM", "That order has no table — it isn't a dine-in order"}
	}
	_, err = pool.Exec(ctx, `UPDATE store_order SET "dineInStatus" = $1 WHERE id = $2 AND "storeId" = $3`, status, orderID, storeID)
	return err
}

// TableOrderRow — one active dine-in order for the table board: enough
// to show what's happening at each table without a per-order drill-down
// for the common case.
type TableOrderRow struct {
	OrderID      string
	TableLabel   string
	DineInStatus string
	TotalKES     string
	WaiterName   *string
	CreatedAt    string
}

// ListTableOrders — every dine-in order not yet CLOSED, for the table
// board. Store-owner-scoped (see package comment); waiter name is a
// best-effort join against whichever TableAssignment is currently
// active for that table, nil if nobody's been assigned yet.
func ListTableOrders(ctx context.Context, pool *pgxpool.Pool, storeID, actingPartyID string) ([]TableOrderRow, error) {
	if err := requireStoreOwnerByID(ctx, pool, storeID, actingPartyID); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT so.id, so."tableLabel", so."dineInStatus"::text, so."totalKes"::text, c.name, so."createdAt"::text
		FROM store_order so
		LEFT JOIN table_assignment ta ON ta."storeId" = so."storeId" AND ta."tableLabel" = so."tableLabel" AND ta."endedAt" IS NULL
		LEFT JOIN cashier c ON c.id = ta."cashierId"
		WHERE so."storeId" = $1 AND so."tableLabel" IS NOT NULL AND so."dineInStatus" IS DISTINCT FROM 'CLOSED'
		ORDER BY so."createdAt" ASC`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TableOrderRow
	for rows.Next() {
		var r TableOrderRow
		if err := rows.Scan(&r.OrderID, &r.TableLabel, &r.DineInStatus, &r.TotalKES, &r.WaiterName, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AddTip — buyer-facing, at payment. The order id is the trust boundary
// here, same convention GetStoreOrder already documents ("the order id
// is the secret") — no party/session check beyond knowing the id, since
// a guest checkout must be able to tip too. tippedCashierId is resolved
// from the table's active assignment at this exact moment and frozen —
// see StoreOrder.tippedCashierId's own comment on why it isn't
// re-resolved later.
func AddTip(ctx context.Context, pool *pgxpool.Pool, orderID string, tipKES float64) error {
	if tipKES <= 0 {
		return &OrderError{"INVALID_ITEM", "Enter a tip amount above zero"}
	}
	var storeID string
	var tableLabel *string
	err := pool.QueryRow(ctx, `SELECT "storeId", "tableLabel" FROM store_order WHERE id = $1`, orderID).Scan(&storeID, &tableLabel)
	if errors.Is(err, pgx.ErrNoRows) {
		return &OrderError{"NOT_FOUND", "That order was not found"}
	}
	if err != nil {
		return err
	}
	var cashierID *string
	if tableLabel != nil {
		_ = pool.QueryRow(ctx, `
			SELECT "cashierId" FROM table_assignment
			WHERE "storeId" = $1 AND "tableLabel" = $2 AND "endedAt" IS NULL
			ORDER BY "assignedAt" DESC LIMIT 1`, storeID, *tableLabel).Scan(&cashierID)
	}
	_, err = pool.Exec(ctx, `UPDATE store_order SET "tipKes" = $1, "tippedCashierId" = $2 WHERE id = $3`, tipKES, cashierID, orderID)
	return err
}
