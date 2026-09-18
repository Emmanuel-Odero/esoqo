package httpapi

import (
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/config"
)

// TestRouterRegistersWithoutConflict builds the whole route table.
//
// Gin panics at registration time when a static segment collides with a
// sibling wildcard — "/admin/parcels/orgs" next to "/admin/parcels/:id"
// is exactly that shape, and this package's own route comments record
// three previous collisions of the same kind (parcels/:code vs
// me/parcels, couriers vs :id, labels/generate vs labels/info/:code).
//
// Every one of those was found by a panic at boot. Nothing in the test
// suite built the router, so a fourth would have shipped and taken the
// service down on start rather than failing here. This is the cheapest
// possible guard: no database, no Redis, no requests — just assert that
// the table Router() declares is one gin will accept.
func TestRouterRegistersWithoutConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Nil pool and client are fine: Router() only wires handlers, it
	// never dials anything. A handler that did would fail its own test,
	// not this one.
	s := NewServer(config.Config{}, nil, nil)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("route registration panicked — almost certainly a static/wildcard collision: %v", r)
		}
	}()

	routes := s.Router().Routes()
	if len(routes) == 0 {
		t.Fatal("Router() registered no routes at all")
	}

	// Spot-check that the tenancy routes most at risk of colliding are
	// all actually present, so a future "fix" that resolves a conflict
	// by quietly deleting one of them fails here too.
	want := map[string]bool{
		"POST /v1/parcel-orgs/staff/signin": false,
		"GET /v1/parcel-orgs/by-slug/:slug": false,
		"GET /v1/parcel-orgs/me/parcels":    false,
		"GET /v1/admin/parcels/orgs":        false,
		"POST /v1/admin/parcels/:id/org":    false,
		// COD adds a third static sibling under /parcels/:code/... and a
		// /cod/ tree under /admin/parcels/, both fresh collision risks.
		"GET /v1/parcels/cod-policy":         false,
		"POST /v1/parcels/:code/cod/confirm": false,
		"POST /v1/parcels/:code/cod/collect": false,
		"POST /v1/admin/parcels/cod/settle":  false,
		"POST /v1/parcel-orgs/me/cod/remit":  false,
		// Parcel-on-fleet adds a /parcels/trips/... tree beside the
		// existing /parcels/:code wildcard — the same static-vs-wildcard
		// shape that has bitten this router three times before.
		"GET /v1/parcels/trips":                false,
		"GET /v1/parcels/trips/:tripId/stages": false,
		"POST /v1/parcels/:code/board":         false,
		// Dispatch board: static /dispatch beside /dispatch/:id and the
		// :id/... action tree — identical collision shape.
		"GET /v1/parcel-orgs/me/dispatch":     false,
		"POST /v1/parcel-orgs/me/dispatch":    false,
		"GET /v1/parcel-orgs/me/dispatch/:id": false,
		// Label tail-search beside the register and the info tree.
		"GET /v1/parcel-orgs/me/labels/search": false,
		"GET /v1/parcel-orgs/me/labels":        false,
		// Self-service PIN change beside the staff tree.
		"POST /v1/parcel-orgs/me/pin": false,
	}
	for _, r := range routes {
		key := r.Method + " " + r.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for key, found := range want {
		if !found {
			t.Errorf("expected route %q to be registered", key)
		}
	}
}
