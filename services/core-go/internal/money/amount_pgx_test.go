package money

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Amount's Scan/Value only matter if pgx actually calls them. That is a
// property of the driver, not of this package, so no amount of unit
// testing establishes it — and getting it wrong fails at runtime rather
// than at compile time, because rows.Scan takes `any`.
//
// Gated on TEST_DATABASE_URL so the normal `go test ./...` stays
// hermetic. Run against a dev database with:
//
//	TEST_DATABASE_URL="postgres://esoko:esoko_dev_only@localhost:5432/esoko" \
//	  go test ./internal/money/ -run PGX -v
func TestPGXRoundTripsAmountThroughNumeric(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping pgx integration check")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	cases := []Cents{0, 1, -1, 25050, 125050, 999999999}
	for _, want := range cases {
		// Value() on the way in, Scan() on the way out, through a real
		// Decimal(18,2) column of the same shape the ledger uses.
		var got Amount
		if err := pool.QueryRow(ctx,
			`SELECT $1::numeric(18,2)`, AmountOf(want)).Scan(&got); err != nil {
			t.Fatalf("round trip of %d cents: %v", want, err)
		}
		if got.Cents() != want {
			t.Errorf("numeric round trip: %d -> %d cents", want, got.Cents())
		}
	}
}

// The exactness claim, against the database rather than in memory: a
// value that cannot be represented in binary floating point must survive
// unchanged.
func TestPGXPreservesAmountsFloatWouldNotRepresent(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping pgx integration check")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// 0.1 + 0.2 in float64 is 0.30000000000000004; as cents it is 30.
	var sum Amount
	if err := pool.QueryRow(ctx,
		`SELECT ($1::numeric(18,2) + $2::numeric(18,2))`,
		AmountOf(10), AmountOf(20)).Scan(&sum); err != nil {
		t.Fatalf("sum: %v", err)
	}
	if sum.Cents() != 30 {
		t.Errorf("0.10 + 0.20 = %d cents, want 30", sum.Cents())
	}

	// A three-way split that must reconcile exactly, mirroring the COD
	// settlement entry.
	var remainder Amount
	if err := pool.QueryRow(ctx,
		`SELECT ($1::numeric(18,2) - $2::numeric(18,2) - $3::numeric(18,2))`,
		AmountOf(250001), AmountOf(130001), AmountOf(120000)).Scan(&remainder); err != nil {
		t.Fatalf("split: %v", err)
	}
	if remainder.Cents() != 0 {
		t.Errorf("three-way split left %d cents stranded, want 0", remainder.Cents())
	}
}
