package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// The leak this closes: a Postgres error names tables, columns and
// constraints, describing the schema to anyone who can trigger one.
func TestInternalErrorHidesPostgresErrors(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23505",
		Message:        `duplicate key value violates unique constraint "parcel_paymentCheckoutRequestId_key"`,
		ConstraintName: "parcel_paymentCheckoutRequestId_key",
		TableName:      "parcel",
		SchemaName:     "public",
	}
	if !internalError(pgErr) {
		t.Error("a PgError must never reach a client")
	}
	// Still hidden once wrapped, which is how it actually arrives.
	if !internalError(fmt.Errorf("confirming parcel: %w", pgErr)) {
		t.Error("a wrapped PgError must still be treated as internal")
	}
}

func TestInternalErrorHidesDriverAndNetworkErrors(t *testing.T) {
	cases := map[string]error{
		"no rows":      pgx.ErrNoRows,
		"tx closed":    pgx.ErrTxClosed,
		"wrapped rows": fmt.Errorf("loading bill: %w", pgx.ErrNoRows),
		"dns":          &net.DNSError{Err: "no such host", Name: "db.internal.esoqo"},
		"deadline":     context.DeadlineExceeded,
		"cancelled":    context.Canceled,
		"wrapped dead": fmt.Errorf("query: %w", context.DeadlineExceeded),
	}
	for name, err := range cases {
		if !internalError(err) {
			t.Errorf("%s: expected to be treated as internal, was not", name)
		}
	}
}

// The other half: dbx writes deliberate user-facing text, and hiding it
// behind a generic string would make the product worse for no gain.
func TestInternalErrorKeepsDomainMessages(t *testing.T) {
	cases := []error{
		errors.New("give this bill a name"),
		errors.New("you are already a member of this group"),
		fmt.Errorf("wrapped: %w", errors.New("a county is required")),
	}
	for _, err := range cases {
		if internalError(err) {
			t.Errorf("domain message %q should reach the client", err)
		}
	}
}

func TestInternalErrorNilIsNotInternal(t *testing.T) {
	if internalError(nil) {
		t.Error("nil must not be reported as an internal error")
	}
}
