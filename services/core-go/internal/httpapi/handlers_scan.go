package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/dbx"
)

// GET /v1/scan/resolve?code= — the universal scanner dispatcher, public.
// One code in, one Kind + action out (trip|voucher|fare|product|store|
// table|ticket|order|party|certificate|parcel|unknown); every projection is
// public-safe, so guests can scan too. Anything permission-sensitive
// (full fare details, ticket check-in) stays behind its own capability
// rule.
func (s *Server) handleResolveScan(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		code = c.Query("payload")
	}
	if code == "" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "code is required")
		return
	}
	hit, err := dbx.ResolveScan(c.Request.Context(), s.Pool, code, s.Cfg.FleetQrSecret, s.Cfg.FareProofTTLMin)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "RESOLVE_FAILED", "Could not read that code")
		return
	}
	out := gin.H{"kind": hit.Kind, "action": hit.Action}
	switch hit.Kind {
	case dbx.ScanKindTrip:
		r := hit.Trip
		stages := make([]gin.H, 0, len(r.Stages))
		for _, st := range r.Stages {
			stages = append(stages, gin.H{"id": st.ID, "name": st.Name, "order": st.Order, "fareKes": st.FareKES})
		}
		out["trip"] = gin.H{
			"tripId": r.TripID, "orgId": r.OrgID, "orgName": r.OrgName, "orgSlug": r.OrgSlug,
			"vehiclePlate": r.VehiclePlate, "routeName": r.RouteName,
			"driverName": r.DriverName, "conductorName": r.ConductorName,
			"status": r.Status, "stages": stages,
		}
	case dbx.ScanKindVoucher:
		out["voucher"] = hit.Voucher
	case dbx.ScanKindFare:
		out["fare"] = hit.Fare
	case dbx.ScanKindProduct:
		out["product"] = hit.Product
	case dbx.ScanKindStore:
		out["store"] = hit.Store
	case dbx.ScanKindTable:
		out["table"] = hit.Table
	case dbx.ScanKindTicket:
		out["ticket"] = hit.Ticket
	case dbx.ScanKindOrder:
		out["order"] = hit.Order
	case dbx.ScanKindParty:
		out["party"] = hit.Party
	case dbx.ScanKindCertificate:
		out["certificate"] = hit.Certificate
	case dbx.ScanKindParcel:
		out["parcel"] = hit.Parcel
	}
	c.JSON(http.StatusOK, out)
}
