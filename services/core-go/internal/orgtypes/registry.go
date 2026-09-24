// Package orgtypes defines the organization type system that allows Esoqo
// to support multiple organization types (courier companies, hotels, eateries,
// chamas, etc.) without hardcoding courier-specific logic.
package orgtypes

import (
	"fmt"
	"time"
)

// OrgType identifies what kind of organization this is.
type OrgType string

const (
	// OrgTypeCourier represents a courier/delivery company.
	OrgTypeCourier OrgType = "courier"
	// OrgTypeTicket represents a ticket organiser (transport, events).
	OrgTypeTicket OrgType = "ticket"
	// OrgTypeHotel represents a hotel or accommodation business.
	OrgTypeHotel OrgType = "hotel"
	// OrgTypeEatery represents a restaurant/food business.
	OrgTypeEatery OrgType = "eatery"
	// OrgTypeChama represents a group/savings group (chama).
	OrgTypeChama OrgType = "chama"
	// OrgTypeTout represents a transportation broker/tout.
	OrgTypeTout OrgType = "tout"
)

// SessionProfile defines how long a session lasts and its security properties.
type SessionProfile string

const (
	// SessionProfileShift is for shift-based work (couriers, hotel staff) - 12 hours.
	SessionProfileShift SessionProfile = "shift"
	// SessionProfileSession is for normal business sessions - 1 hour.
	SessionProfileSession SessionProfile = "session"
	// SessionProfileReadonly is for limited access sessions - 30 minutes.
	SessionProfileReadonly SessionProfile = "readonly"
)

// StaffSignInMethod defines how staff authenticate to the system.
type StaffSignInMethod string

const (
	// StaffSignInMethodPIN uses a 4-digit PIN (courier staff).
	StaffSignInMethodPIN StaffSignInMethod = "pin"
	// StaffSignInMethodPassword uses password authentication.
	StaffSignInMethodPassword StaffSignInMethod = "password"
	// StaffSignInMethodOTP uses one-time password via SMS/email.
	StaffSignInMethodOTP StaffSignInMethod = "otp"
	// StaffSignInMethodSSO uses single sign-on (enterprise).
	StaffSignInMethodSSO StaffSignInMethod = "sso"
)

// OrgTypeDefinition describes how a specific organization type behaves.
type OrgTypeDefinition struct {
	// ID is the unique identifier for this org type (courier, hotel, eatery, etc.).
	ID OrgType

	// Name is the human-readable name for display purposes.
	Name string

	// Description explains what this org type does.
	Description string

	// Category groups related org types (logistics, hospitality, food, social).
	Category string

	// SessionCookieName is the name of the session cookie for this org type.
	// If empty, uses a generic org session cookie with type discrimination.
	SessionCookieName string

	// DefaultSessionTTL is how long a staff session lasts.
	DefaultSessionTTL time.Duration

	// DefaultSessionProfile defines the session profile for typical staff.
	DefaultSessionProfile SessionProfile

	// StaffSignInMethod is how staff authenticate.
	StaffSignInMethod StaffSignInMethod

	// CapabilityPrefix is prefixed to all capabilities (parcelorg, hotelorg, eateryorg).
	CapabilityPrefix string

	// PortalRoute returns the portal route for an org of this type.
	// Example: "/org/courier/[id]", "/org/hotel/[id]", etc.
	PortalRoute func(orgID string) string

	// RequiresEnterprise indicates if this org type must belong to an enterprise.
	RequiresEnterprise bool

	// AllowsWalkIn indicates if this org type supports public walk-in (like courier desks).
	AllowsWalkIn bool

	// StaffRoles defines the preset roles available for this org type.
	StaffRoles map[string]RoleDefinition

	// Metadata stores arbitrary org-type-specific configuration.
	Metadata map[string]interface{}
}

// RoleDefinition describes a preset role for an organization type.
type RoleDefinition struct {
	// ID is the unique identifier for this role within the org type.
	ID string

	// Name is the human-readable name for display (e.g., "Delivery Rider").
	Name string

	// Description explains what this role does.
	Description string

	// Capabilities are the default capabilities granted to this role.
	// These are the base capability names without the org type prefix.
	// Example: []string{"read", "carry"} becomes ["parcelorg.read", "parcelorg.carry"].
	Capabilities []string

	// IsDefault indicates this is the default role for new staff.
	IsDefault bool

	// CanManageStaff indicates staff with this role can manage other staff.
	CanManageStaff bool
}

var (
	// Registry maps org type IDs to their definitions.
	Registry = map[OrgType]*OrgTypeDefinition{
		OrgTypeCourier: {
			ID:                    OrgTypeCourier,
			Name:                  "Courier Company",
			Description:           "Delivery and logistics company",
			Category:              "logistics",
			SessionCookieName:     "esoqo_parcel_org_session", // Keep for backward compat during migration
			DefaultSessionTTL:     12 * time.Hour,
			DefaultSessionProfile: SessionProfileShift,
			StaffSignInMethod:     StaffSignInMethodPIN,
			CapabilityPrefix:      "parcelorg",
			PortalRoute: func(orgID string) string {
				return "/org/courier/" + orgID
			},
			RequiresEnterprise: true,
			AllowsWalkIn:       true,
			StaffRoles: map[string]RoleDefinition{
				"RIDER": {
					ID:          "RIDER",
					Name:        "Delivery Rider",
					Description: "Picks up and delivers parcels",
					Capabilities: []string{
						"read",   // parcelorg.read
						"carry",  // parcelorg.carry
					},
					IsDefault: false,
				},
				"DISPATCHER": {
					ID:          "DISPATCHER",
					Name:        "Dispatcher",
					Description: "Assigns parcels and manages dispatch runs",
					Capabilities: []string{
						"read",      // parcelorg.read
						"carry",     // parcelorg.carry
						"dispatch",  // parcelorg.dispatch
						"arrival",   // parcelorg.arrival
					},
					IsDefault: false,
				},
				"INTAKE_CLERK": {
					ID:          "INTAKE_CLERK",
					Name:        "Intake Clerk",
					Description: "Books parcels at counter",
					Capabilities: []string{
						"read",   // parcelorg.read
						"intake", // parcelorg.intake
					},
					IsDefault: false,
				},
				"MANAGER": {
					ID:          "MANAGER",
					Name:        "Manager",
					Description: "Full access to company operations",
					Capabilities: []string{
						"read",      // parcelorg.read
						"write",     // parcelorg.write
						"carry",     // parcelorg.carry
						"dispatch",  // parcelorg.dispatch
						"intake",    // parcelorg.intake
						"staff",     // parcelorg.staff
						"stations",  // parcelorg.stations
						"earnings",  // parcelorg.earnings
					},
					IsDefault:      false,
					CanManageStaff: true,
				},
			},
		},
		OrgTypeTicket: {
			ID:                    OrgTypeTicket,
			Name:                  "Ticket Organiser",
			Description:           "Transport or events organiser",
			Category:              "managed",
			SessionCookieName:     "", // Use generic org session
			DefaultSessionTTL:     12 * time.Hour,
			DefaultSessionProfile: SessionProfileSession,
			StaffSignInMethod:     StaffSignInMethodPIN,
			CapabilityPrefix:      "ticketorg",
			PortalRoute: func(orgID string) string {
				return "/org/ticket/" + orgID
			},
			RequiresEnterprise: true,
			AllowsWalkIn:       false,
			StaffRoles: map[string]RoleDefinition{
				"SCANNER": {
					ID:          "SCANNER",
					Name:        "Scanner",
					Description: "Scans tickets at check-in",
					Capabilities: []string{
						"read",   // ticketorg.read
						"checkin", // ticketorg.checkin
					},
					IsDefault: false,
				},
				"MANAGER": {
					ID:          "MANAGER",
					Name:        "Manager",
					Description: "Full access to organiser operations",
					Capabilities: []string{
						"read",     // ticketorg.read
						"write",    // ticketorg.write
						"checkin",  // ticketorg.checkin
						"staff",    // ticketorg.staff
						"earnings", // ticketorg.earnings
					},
					IsDefault:      false,
					CanManageStaff: true,
				},
			},
		},
		OrgTypeHotel: {
			ID:                    OrgTypeHotel,
			Name:                  "Hotel",
			Description:           "Hotel or accommodation business",
			Category:              "hospitality",
			SessionCookieName:     "",
			DefaultSessionTTL:     8 * time.Hour,
			DefaultSessionProfile: SessionProfileSession,
			StaffSignInMethod:     StaffSignInMethodPIN,
			CapabilityPrefix:      "hotelorg",
			PortalRoute: func(orgID string) string {
				return "/org/hotel/" + orgID
			},
			RequiresEnterprise: true,
			AllowsWalkIn:       false,
			StaffRoles: map[string]RoleDefinition{
				"RECEPTIONIST": {
					ID:          "RECEPTIONIST",
					Name:        "Receptionist",
					Description: "Manages front desk",
					Capabilities: []string{
						"read",        // hotelorg.read
						"checkin",     // hotelorg.checkin
						"checkout",    // hotelorg.checkout
						"reservation", // hotelorg.reservation
					},
					IsDefault: false,
				},
				"HOUSEKEEPER": {
					ID:          "HOUSEKEEPER",
					Name:        "Housekeeper",
					Description: "Manages rooms and cleaning",
					Capabilities: []string{
						"read",  // hotelorg.read
						"rooms", // hotelorg.rooms
					},
					IsDefault: false,
				},
				"MANAGER": {
					ID:          "MANAGER",
					Name:        "Manager",
					Description: "Full access to hotel operations",
					Capabilities: []string{
						"read",        // hotelorg.read
						"write",       // hotelorg.write
						"checkin",     // hotelorg.checkin
						"checkout",    // hotelorg.checkout
						"reservation", // hotelorg.reservation
						"rooms",       // hotelorg.rooms
						"staff",       // hotelorg.staff
						"earnings",    // hotelorg.earnings
					},
					IsDefault:      false,
					CanManageStaff: true,
				},
			},
			Metadata: map[string]interface{}{
				"requiresRoomManagement": true,
				"supportsReservations":   true,
			},
		},
		OrgTypeEatery: {
			ID:                    OrgTypeEatery,
			Name:                  "Restaurant/Eatery",
			Description:           "Food and beverage business",
			Category:              "food",
			SessionCookieName:     "",
			DefaultSessionTTL:     8 * time.Hour,
			DefaultSessionProfile: SessionProfileSession,
			StaffSignInMethod:     StaffSignInMethodPIN,
			CapabilityPrefix:      "eateryorg",
			PortalRoute: func(orgID string) string {
				return "/org/eatery/" + orgID
			},
			RequiresEnterprise: true,
			AllowsWalkIn:       false,
			StaffRoles: map[string]RoleDefinition{
				"WAITER": {
					ID:          "WAITER",
					Name:        "Waiter",
					Description: "Takes and serves orders",
					Capabilities: []string{
						"read",     // eateryorg.read
						"orders",   // eateryorg.orders
						"payments", // eateryorg.payments
					},
					IsDefault: false,
				},
				"CHEF": {
					ID:          "CHEF",
					Name:        "Chef",
					Description: "Prepares meals",
					Capabilities: []string{
						"read",      // eateryorg.read
						"orders",    // eateryorg.orders
						"inventory", // eateryorg.inventory
					},
					IsDefault: false,
				},
				"MANAGER": {
					ID:          "MANAGER",
					Name:        "Manager",
					Description: "Full access to restaurant operations",
					Capabilities: []string{
						"read",      // eateryorg.read
						"write",     // eateryorg.write
						"orders",    // eateryorg.orders
						"inventory", // eateryorg.inventory
						"menu",      // eateryorg.menu
						"payments",  // eateryorg.payments
						"staff",     // eateryorg.staff
						"earnings",  // eateryorg.earnings
					},
					IsDefault:      false,
					CanManageStaff: true,
				},
			},
			Metadata: map[string]interface{}{
				"supportsMenu":      true,
				"supportsInventory": true,
				"supportsOrders":    true,
			},
		},
		OrgTypeChama: {
			ID:                    OrgTypeChama,
			Name:                  "Chama/Savings Group",
			Description:           "Community savings and investment group",
			Category:              "social",
			SessionCookieName:     "",
			DefaultSessionTTL:     4 * time.Hour,
			DefaultSessionProfile: SessionProfileSession,
			StaffSignInMethod:     StaffSignInMethodPIN,
			CapabilityPrefix:      "chamaorg",
			PortalRoute: func(orgID string) string {
				return "/org/chama/" + orgID
			},
			RequiresEnterprise: false,
			AllowsWalkIn:       false,
			StaffRoles: map[string]RoleDefinition{
				"MEMBER": {
					ID:          "MEMBER",
					Name:        "Member",
					Description: "Chama member",
					Capabilities: []string{
						"read",      // chamaorg.read
						"contribute", // chamaorg.contribute
					},
					IsDefault: true,
				},
				"TREASURER": {
					ID:          "TREASURER",
					Name:        "Treasurer",
					Description: "Manages funds",
					Capabilities: []string{
						"read",       // chamaorg.read
						"contribute", // chamaorg.contribute
						"funds",      // chamaorg.funds
						"ledger",     // chamaorg.ledger
					},
					IsDefault: false,
				},
				"LEADER": {
					ID:          "LEADER",
					Name:        "Leader/Chairperson",
					Description: "Full access to chama operations",
					Capabilities: []string{
						"read",       // chamaorg.read
						"write",      // chamaorg.write
						"contribute", // chamaorg.contribute
						"funds",      // chamaorg.funds
						"ledger",     // chamaorg.ledger
						"staff",      // chamaorg.staff
						"meetings",   // chamaorg.meetings
					},
					IsDefault:      false,
					CanManageStaff: true,
				},
			},
			Metadata: map[string]interface{}{
				"supportsFunds":    true,
				"supportsLedger":   true,
				"supportsMeetings": true,
			},
		},
		OrgTypeTout: {
			ID:                    OrgTypeTout,
			Name:                  "Tout/Broker",
			Description:           "Transportation broker or agent",
			Category:              "logistics",
			SessionCookieName:     "",
			DefaultSessionTTL:     6 * time.Hour,
			DefaultSessionProfile: SessionProfileSession,
			StaffSignInMethod:     StaffSignInMethodPIN,
			CapabilityPrefix:      "toutorg",
			PortalRoute: func(orgID string) string {
				return "/org/tout/" + orgID
			},
			RequiresEnterprise: false,
			AllowsWalkIn:       true,
			StaffRoles: map[string]RoleDefinition{
				"AGENT": {
					ID:          "AGENT",
					Name:        "Agent",
					Description: "Sells tickets and manages bookings",
					Capabilities: []string{
						"read",     // toutorg.read
						"bookings", // toutorg.bookings
						"payments", // toutorg.payments
					},
					IsDefault: false,
				},
				"MANAGER": {
					ID:          "MANAGER",
					Name:        "Manager",
					Description: "Full access to agent operations",
					Capabilities: []string{
						"read",       // toutorg.read
						"write",      // toutorg.write
						"bookings",   // toutorg.bookings
						"payments",   // toutorg.payments
						"settlement", // toutorg.settlement
						"staff",      // toutorg.staff
					},
					IsDefault:      false,
					CanManageStaff: true,
				},
			},
			Metadata: map[string]interface{}{
				"supportsBookings":  true,
				"supportsWalkIn":    true,
				"supportsSettlement": true,
			},
		},
	}
)

// Get retrieves an org type definition by ID.
func Get(orgType OrgType) (*OrgTypeDefinition, error) {
	def, ok := Registry[orgType]
	if !ok {
		return nil, fmt.Errorf("unknown org type: %s", orgType)
	}
	return def, nil
}

// GetByString retrieves an org type definition by string ID.
func GetByString(orgType string) (*OrgTypeDefinition, error) {
	return Get(OrgType(orgType))
}

// AllOrgTypes returns all registered org type IDs.
func AllOrgTypes() []OrgType {
	types := make([]OrgType, 0, len(Registry))
	for t := range Registry {
		types = append(types, t)
	}
	return types
}

// GetRole retrieves a role definition for an org type.
func GetRole(orgType OrgType, roleID string) (*RoleDefinition, error) {
	def, err := Get(orgType)
	if err != nil {
		return nil, err
	}
	role, ok := def.StaffRoles[roleID]
	if !ok {
		return nil, fmt.Errorf("unknown role %s for org type %s", roleID, orgType)
	}
	return &role, nil
}

// SessionTTL returns the session TTL for a given org type and profile.
func SessionTTL(orgType OrgType, profile SessionProfile) time.Duration {
	def, err := Get(orgType)
	if err != nil {
		// Default fallback
		return 12 * time.Hour
	}

	switch profile {
	case SessionProfileShift:
		return def.DefaultSessionTTL
	case SessionProfileSession:
		if def.DefaultSessionTTL > 8*time.Hour {
			return 1 * time.Hour
		}
		return def.DefaultSessionTTL / 2
	case SessionProfileReadonly:
		return 30 * time.Minute
	default:
		return def.DefaultSessionTTL
	}
}

// CapabilityName prefixes a capability with the org type's prefix.
// Example: ("courier", "read") -> "parcelorg.read"
func CapabilityName(orgType OrgType, capability string) (string, error) {
	def, err := Get(orgType)
	if err != nil {
		return "", err
	}
	return def.CapabilityPrefix + "." + capability, nil
}

// AllCapabilitiesForRole returns all capabilities for a given role.
// Example: ("courier", "RIDER") -> ["parcelorg.read", "parcelorg.carry"]
func AllCapabilitiesForRole(orgType OrgType, roleID string) ([]string, error) {
	role, err := GetRole(orgType, roleID)
	if err != nil {
		return nil, err
	}

	capabilities := make([]string, 0, len(role.Capabilities))
	for _, cap := range role.Capabilities {
		fullCap, _ := CapabilityName(orgType, cap)
		capabilities = append(capabilities, fullCap)
	}
	return capabilities, nil
}
