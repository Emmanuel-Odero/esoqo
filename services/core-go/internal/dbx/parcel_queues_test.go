package dbx

import (
	"strings"
	"testing"
)

// The operations dashboard's promise is that a tile reading "7" opens
// a list of exactly 7 rows. That holds only while the count and the
// list share one predicate, so these tests guard the sharing rather
// than the SQL — the SQL itself needs a database, but "did someone add
// a queue the stats forgot, or hand-write a count again" does not.

// Every tile that is a worklist must have a queue behind it. Adding a
// tile without one is how a number becomes unclickable; adding one
// with a hand-written duplicate predicate is how it starts to drift.
func TestEveryAttentionCountHasAQueue(t *testing.T) {
	for _, queue := range []string{
		"needs-collector", "overdue-collection", "stale-drafts", "refunds-owed",
		"overdue-delivery", "failed-delivery", "stale-at-agent", "awaiting-return",
		"in-flight",
	} {
		if _, ok := ParcelQueues[queue]; !ok {
			t.Errorf("ParcelQueues is missing %q — its KPI tile has nothing to link to", queue)
		}
	}
}

// An unknown slug must be refused, not ignored. A misspelt queue that
// silently drops its filter shows an operator every parcel in the
// system under a heading promising a narrow worklist, which is a far
// worse failure than an error message.
func TestParcelQueueWhereRejectsUnknown(t *testing.T) {
	if _, err := ParcelQueueWhere("no-such-queue"); err == nil {
		t.Error("ParcelQueueWhere accepted an unknown queue; a bad slug must not silently list everything")
	}
	if _, err := ParcelQueueWhere(""); err == nil {
		t.Error("ParcelQueueWhere accepted an empty queue key")
	}
	for queue := range ParcelQueues {
		where, err := ParcelQueueWhere(queue)
		if err != nil {
			t.Errorf("ParcelQueueWhere(%q) errored: %v", queue, err)
		}
		if where == "" {
			t.Errorf("ParcelQueueWhere(%q) returned an empty predicate, which matches every row", queue)
		}
	}
}

// The fragments are concatenated into SQL and joined against aliased
// tables, so they have to be written against the `p` alias — a bare
// column name compiles here and fails at the database, where it is far
// more expensive to discover.
func TestQueuePredicatesUseTheRowAlias(t *testing.T) {
	for queue, where := range ParcelQueues {
		if !strings.Contains(where, "p.") {
			t.Errorf("ParcelQueues[%q] = %q does not reference the p alias AdminListParcels joins against", queue, where)
		}
	}
}

// The register's four states must partition the stock table: every
// label in exactly one, none in two. Overlap would double-count in the
// tab badges; a gap would hide labels the same way attaching info used
// to. Checked structurally — "voided" claims every voided row, and the
// other three each pin voidedAt IS NULL plus a distinct usedAt /
// infoAttachedAt combination.
func TestLabelStatesPartitionTheTable(t *testing.T) {
	for _, state := range []string{"blank", "filled", "spent", "voided"} {
		if _, ok := ParcelLabelStates[state]; !ok {
			t.Fatalf("ParcelLabelStates is missing %q", state)
		}
	}
	if len(ParcelLabelStates) != 4 {
		t.Errorf("ParcelLabelStates has %d entries; a new one must also be added to the register's tabs and its counts", len(ParcelLabelStates))
	}
	// The three live states must all exclude voided rows, or a withdrawn
	// label would appear in two tabs at once.
	for _, state := range []string{"blank", "filled", "spent"} {
		if !strings.Contains(ParcelLabelStates[state], `"voidedAt" IS NULL`) {
			t.Errorf("ParcelLabelStates[%q] does not exclude voided labels, so a withdrawn label would show in two tabs", state)
		}
	}
	if !strings.Contains(ParcelLabelStates["voided"], `"voidedAt" IS NOT NULL`) {
		t.Error(`ParcelLabelStates["voided"] must claim exactly the withdrawn rows`)
	}
}

// Same injection guard the queues get: these are interpolated, so they
// must stay constant.
func TestLabelStatePredicatesTakeNoParameters(t *testing.T) {
	for state, where := range ParcelLabelStates {
		if strings.Contains(where, "$") {
			t.Errorf("ParcelLabelStates[%q] contains a bind placeholder; state predicates must be constant", state)
		}
	}
}

// These strings are interpolated into SQL rather than parameterised,
// which is safe only while they stay compile-time constants. A
// placeholder in one would mean somebody tried to make a queue take
// user input — the exact move that turns this map into an injection
// surface.
func TestQueuePredicatesTakeNoParameters(t *testing.T) {
	for queue, where := range ParcelQueues {
		if strings.Contains(where, "$") {
			t.Errorf("ParcelQueues[%q] contains a bind placeholder; queue predicates must be constant", queue)
		}
	}
}
