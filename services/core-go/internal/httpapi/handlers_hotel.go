// Package httpapi (handlers_hotel.go) — Hotel organization portal handlers.
//
// These handlers implement the hotel org type's portal API.
// They demonstrate how a new org type plugs into the generic org infrastructure:
// all auth/tenancy is provided by the generic session; only the domain data
// (rooms, reservations) is type-specific here.
package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// hotelOrgCtx is the hotel-specific equivalent of orgCtx for courier.
// Extracts and validates a hotel org context from the session.
func (s *Server) hotelOrgCtx(c *gin.Context, capability string) string {
	ctx := ctxFromGin(c)
	if ctx.OrgType != "hotel" {
		writeError(c, http.StatusForbidden, "NOT_HOTEL_STAFF", "This requires a hotel staff session")
		return ""
	}
	return authsvc.ExtractOrgFromContext(c, ctx, capability)
}

// handleGetHotelDashboard — GET /v1/hotels/:orgId/dashboard
// Returns hotel occupancy summary for the portal dashboard.
func (s *Server) handleGetHotelDashboard(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "read")
	if orgID == "" {
		return
	}

	org, err := dbx.GetOrg(c.Request.Context(), s.Pool, orgID)
	if err != nil || org == nil {
		writeError(c, http.StatusInternalServerError, "FETCH_FAILED", "Could not load hotel")
		return
	}

	// Fetch hotel-specific config entries
	configs, err := dbx.ListOrgConfigs(c.Request.Context(), s.Pool, orgID, "hotel.")
	if err != nil {
		configs = []dbx.OrgConfig{}
	}
	cfgMap := make(map[string]string, len(configs))
	for _, cfg := range configs {
		raw := string(cfg.ConfigData)
		// Strip outer JSON string quotes if present
		if len(raw) >= 2 && raw[0] == '"' {
			raw = raw[1 : len(raw)-1]
		}
		cfgMap[cfg.ConfigKey] = raw
	}

	c.JSON(http.StatusOK, gin.H{
		"org": gin.H{
			"id":   org.ID,
			"name": org.Name,
			"slug": org.Slug,
		},
		"occupancy": gin.H{
			"totalRooms":     cfgMap["hotel.total_rooms"],
			"occupiedRooms":  cfgMap["hotel.occupied_rooms"],
			"availableRooms": cfgMap["hotel.available_rooms"],
		},
	})
}

// handleListHotelRooms — GET /v1/hotels/:orgId/rooms
// Lists all rooms for the hotel.
func (s *Server) handleListHotelRooms(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "rooms.read")
	if orgID == "" {
		return
	}

	rooms, err := dbx.ListOrgConfigs(c.Request.Context(), s.Pool, orgID, "room.")
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load rooms")
		return
	}
	if rooms == nil {
		rooms = []dbx.OrgConfig{}
	}
	c.JSON(http.StatusOK, gin.H{"rooms": rooms})
}

// handleCreateHotelRoom — POST /v1/hotels/:orgId/rooms
// Creates a new room for the hotel.
func (s *Server) handleCreateHotelRoom(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "rooms.write")
	if orgID == "" {
		return
	}

	var req struct {
		Number        string   `json:"number" binding:"required"`
		Type          string   `json:"type" binding:"required"` // single, double, suite
		Floor         int      `json:"floor"`
		MaxGuests     int      `json:"maxGuests"`
		PricePerNight float64  `json:"pricePerNight"`
		Amenities     []string `json:"amenities"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	configData, err := json.Marshal(map[string]any{
		"number":        req.Number,
		"type":          req.Type,
		"floor":         req.Floor,
		"maxGuests":     req.MaxGuests,
		"pricePerNight": req.PricePerNight,
		"amenities":     req.Amenities,
		"status":        "available",
	})
	if err != nil {
		writeError(c, http.StatusInternalServerError, "ENCODE_FAILED", "Could not encode room data")
		return
	}

	configKey := "room." + req.Number
	if err := dbx.UpsertOrgConfig(c.Request.Context(), s.Pool, orgID, configKey, configData, 100); err != nil {
		writeError(c, http.StatusInternalServerError, "CREATE_FAILED", "Could not create room")
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"room": gin.H{
			"number":        req.Number,
			"type":          req.Type,
			"status":        "available",
			"pricePerNight": req.PricePerNight,
		},
	})
}

// handleUpdateHotelRoomStatus — PATCH /v1/hotels/:orgId/rooms/:number/status
// Updates a room's status (available, occupied, maintenance).
func (s *Server) handleUpdateHotelRoomStatus(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "rooms.write")
	if orgID == "" {
		return
	}

	roomNumber := c.Param("number")
	var req struct {
		Status string `json:"status" binding:"required"` // available, occupied, maintenance
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	validStatuses := map[string]bool{"available": true, "occupied": true, "maintenance": true}
	if !validStatuses[req.Status] {
		writeError(c, http.StatusBadRequest, "INVALID_STATUS", "Status must be available, occupied, or maintenance")
		return
	}

	// Fetch existing room config
	configKey := "room." + roomNumber
	existing, err := dbx.GetOrgConfig(c.Request.Context(), s.Pool, orgID, configKey)
	if err != nil || existing == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Room not found")
		return
	}

	// Merge status into existing data
	var roomData map[string]any
	if err := json.Unmarshal(existing.ConfigData, &roomData); err != nil {
		writeError(c, http.StatusInternalServerError, "DECODE_FAILED", "Could not read room data")
		return
	}
	roomData["status"] = req.Status

	configData, _ := json.Marshal(roomData)
	if err := dbx.UpsertOrgConfig(c.Request.Context(), s.Pool, orgID, configKey, configData, 100); err != nil {
		writeError(c, http.StatusInternalServerError, "UPDATE_FAILED", "Could not update room status")
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

// handleListHotelReservations — GET /v1/hotels/:orgId/reservations
// Lists all reservations for the hotel, with optional status filter.
func (s *Server) handleListHotelReservations(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "reservations.read")
	if orgID == "" {
		return
	}

	reservations, err := dbx.ListOrgConfigs(c.Request.Context(), s.Pool, orgID, "reservation.")
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load reservations")
		return
	}
	if reservations == nil {
		reservations = []dbx.OrgConfig{}
	}
	c.JSON(http.StatusOK, gin.H{"reservations": reservations})
}

// handleCreateHotelReservation — POST /v1/hotels/:orgId/reservations
// Creates a new reservation at the hotel.
func (s *Server) handleCreateHotelReservation(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "reservations.write")
	if orgID == "" {
		return
	}

	var req struct {
		GuestName    string `json:"guestName" binding:"required"`
		GuestPhone   string `json:"guestPhone"`
		RoomNumber   string `json:"roomNumber" binding:"required"`
		CheckInDate  string `json:"checkInDate" binding:"required"`
		CheckOutDate string `json:"checkOutDate" binding:"required"`
		Adults       int    `json:"adults"`
		Children     int    `json:"children"`
		Notes        string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	// Simple unique ID from timestamp + room
	reservationID := fmt.Sprintf("RES-%d-%s", time.Now().UnixMilli(), req.RoomNumber)

	configData, err := json.Marshal(map[string]any{
		"id":           reservationID,
		"guestName":    req.GuestName,
		"guestPhone":   req.GuestPhone,
		"roomNumber":   req.RoomNumber,
		"checkInDate":  req.CheckInDate,
		"checkOutDate": req.CheckOutDate,
		"adults":       req.Adults,
		"children":     req.Children,
		"notes":        req.Notes,
		"status":       "confirmed",
	})
	if err != nil {
		writeError(c, http.StatusInternalServerError, "ENCODE_FAILED", "Could not encode reservation data")
		return
	}

	if err := dbx.UpsertOrgConfig(c.Request.Context(), s.Pool, orgID, "reservation."+reservationID, configData, 100); err != nil {
		writeError(c, http.StatusInternalServerError, "CREATE_FAILED", "Could not create reservation")
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"reservation": gin.H{
			"id":          reservationID,
			"guestName":   req.GuestName,
			"roomNumber":  req.RoomNumber,
			"checkInDate": req.CheckInDate,
			"status":      "confirmed",
		},
	})
}

// handleCheckInGuest — POST /v1/hotels/:orgId/reservations/:reservationId/checkin
// Marks a guest as checked in and marks the room as occupied.
func (s *Server) handleCheckInGuest(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "reservations.write")
	if orgID == "" {
		return
	}

	reservationID := c.Param("reservationId")
	configKey := "reservation." + reservationID

	existing, err := dbx.GetOrgConfig(c.Request.Context(), s.Pool, orgID, configKey)
	if err != nil || existing == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Reservation not found")
		return
	}

	var resData map[string]any
	if err := json.Unmarshal(existing.ConfigData, &resData); err != nil {
		writeError(c, http.StatusInternalServerError, "DECODE_FAILED", "Could not read reservation data")
		return
	}
	resData["status"] = "checked_in"
	resData["checkedInAt"] = time.Now().UTC().Format(time.RFC3339)

	configData, _ := json.Marshal(resData)
	if err := dbx.UpsertOrgConfig(c.Request.Context(), s.Pool, orgID, configKey, configData, 100); err != nil {
		writeError(c, http.StatusInternalServerError, "UPDATE_FAILED", "Could not update reservation")
		return
	}

	// Mark room as occupied
	if roomNumber, ok := resData["roomNumber"].(string); ok {
		roomKey := "room." + roomNumber
		if roomCfg, _ := dbx.GetOrgConfig(c.Request.Context(), s.Pool, orgID, roomKey); roomCfg != nil {
			var roomData map[string]any
			if json.Unmarshal(roomCfg.ConfigData, &roomData) == nil {
				roomData["status"] = "occupied"
				roomData["currentReservationId"] = reservationID
				if rd, _ := json.Marshal(roomData); rd != nil {
					_ = dbx.UpsertOrgConfig(c.Request.Context(), s.Pool, orgID, roomKey, rd, 100)
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "checked_in"})
}

// handleCheckOutGuest — POST /v1/hotels/:orgId/reservations/:reservationId/checkout
// Marks a guest as checked out and frees the room.
func (s *Server) handleCheckOutGuest(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "reservations.write")
	if orgID == "" {
		return
	}

	reservationID := c.Param("reservationId")
	configKey := "reservation." + reservationID

	existing, err := dbx.GetOrgConfig(c.Request.Context(), s.Pool, orgID, configKey)
	if err != nil || existing == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Reservation not found")
		return
	}

	var resData map[string]any
	if err := json.Unmarshal(existing.ConfigData, &resData); err != nil {
		writeError(c, http.StatusInternalServerError, "DECODE_FAILED", "Could not read reservation data")
		return
	}
	resData["status"] = "checked_out"
	resData["checkedOutAt"] = time.Now().UTC().Format(time.RFC3339)

	configData, _ := json.Marshal(resData)
	if err := dbx.UpsertOrgConfig(c.Request.Context(), s.Pool, orgID, configKey, configData, 100); err != nil {
		writeError(c, http.StatusInternalServerError, "UPDATE_FAILED", "Could not update reservation")
		return
	}

	// Free the room
	if roomNumber, ok := resData["roomNumber"].(string); ok {
		roomKey := "room." + roomNumber
		if roomCfg, _ := dbx.GetOrgConfig(c.Request.Context(), s.Pool, orgID, roomKey); roomCfg != nil {
			var roomData map[string]any
			if json.Unmarshal(roomCfg.ConfigData, &roomData) == nil {
				roomData["status"] = "available"
				delete(roomData, "currentReservationId")
				if rd, _ := json.Marshal(roomData); rd != nil {
					_ = dbx.UpsertOrgConfig(c.Request.Context(), s.Pool, orgID, roomKey, rd, 100)
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "checked_out"})
}

// handleListHotelStaff — GET /v1/hotels/:orgId/staff
func (s *Server) handleListHotelStaff(c *gin.Context) {
	orgID := s.hotelOrgCtx(c, "staff.read")
	if orgID == "" {
		return
	}

	staff, err := dbx.ListOrgStaff(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load staff")
		return
	}
	if staff == nil {
		staff = []dbx.OrgStaff{}
	}
	c.JSON(http.StatusOK, gin.H{"staff": staff})
}
