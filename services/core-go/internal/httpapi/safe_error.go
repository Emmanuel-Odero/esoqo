package httpapi

import (
	"context"
	"errors"
	"log"
	"net"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// writeSafeError responds with err's own message when that message was
// written for a human, and a generic one when it came from the database
// driver or the network.
//
// dbx deliberately returns user-facing text for domain failures ("give
// this bill a name", "you are already a member of this group"), and
// those are worth showing. What must never reach a client is a pgx
// error: those carry table names, column names, constraint names and
// sometimes connection details, handing an attacker a free description
// of the schema.
//
// This filters by origin rather than by an allowlist of the ~50 domain
// sentinels spread across dbx. An allowlist would be the stricter
// choice, but it silently degrades to a generic message every time
// someone adds a sentinel and forgets to register it — failing quietly
// in the direction of a worse product. Filtering on driver/network
// origin targets exactly the class of error that leaks internals, and a
// new dbx sentinel keeps working by default.
func writeSafeError(c *gin.Context, status int, code string, err error, fallback string) {
	if internalError(err) {
		// The real error still needs to reach an operator.
		log.Printf("core-go: %s: %v", code, err)
		writeError(c, status, code, fallback)
		return
	}
	writeError(c, status, code, err.Error())
}

// safeErrorMessage is writeSafeError's judgement without the response:
// the message when it was written for a human, a fallback when it came
// from the driver or the network.
//
// Needed wherever a failure is reported *inside* a 200 body rather than
// as the status of the whole request — a bulk operation listing which
// items it couldn't do, for instance. Those per-item strings reach a
// client exactly like an error body does, so they need exactly the same
// filtering; without this they'd be the one path where a pgx error
// describing the schema slips out.
func safeErrorMessage(err error, fallback string) string {
	if err == nil {
		return ""
	}
	if internalError(err) {
		// The real error still needs to reach an operator.
		log.Printf("core-go: %s: %v", fallback, err)
		return fallback
	}
	return err.Error()
}

// internalError reports whether err came from infrastructure rather than
// from a deliberate domain check.
func internalError(err error) bool {
	if err == nil {
		return false
	}

	// Postgres server-side errors: constraint violations, undefined
	// columns, syntax errors. The most leaky of the lot.
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return true
	}

	// Driver-level: no rows, closed pool, failed connection.
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, pgx.ErrTxClosed) || errors.Is(err, pgx.ErrTxCommitRollback) {
		return true
	}
	var connErr *pgconn.ConnectError
	if errors.As(err, &connErr) {
		return true
	}

	// Network and lifecycle: DNS, dial, timeout, cancellation. These
	// expose hostnames and internal addressing.
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}

	return false
}
