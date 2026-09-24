package authsvc

import (
	"fmt"

	"github.com/esoqo/core-go/internal/orgtypes"
	"github.com/gin-gonic/gin"
)

// OrgContextError represents an error in org context operations.
type OrgContextError struct {
	Code    string
	Message string
}

func (e *OrgContextError) Error() string {
	return e.Message
}

// ExtractOrgFromContext extracts organization information from a request context.
// This is the generic replacement for courier-specific orgCtx() helpers.
//
// It verifies:
// 1. The session has an OrgID (staff is scoped to an org)
// 2. The OrgType is valid and registered
// 3. The caller has the required capability (if specified)
//
// Returns the OrgID if all checks pass, or "" with an error written to the response.
func ExtractOrgFromContext(
	c *gin.Context,
	ctx Ctx,
	requiredCapability string,
) string {
	// Check: Does this session have an org?
	if ctx.OrgID == "" {
		// Support backward compat: check for ParcelOrgID
		if ctx.ParcelOrgID != "" {
			ctx.OrgID = ctx.ParcelOrgID
			ctx.OrgType = "courier"
		} else if ctx.TicketOrgID != "" {
			ctx.OrgID = ctx.TicketOrgID
			ctx.OrgType = "ticket"
		} else {
			// Not an org-scoped session
			writeOrgContextError(c, &OrgContextError{
				Code:    "NOT_ORG_STAFF",
				Message: "This operation requires an organization staff session",
			})
			return ""
		}
	}

	// Check: Is the OrgType valid?
	if ctx.OrgType == "" {
		// Fallback: assume courier for backward compat
		if ctx.ParcelOrgID != "" {
			ctx.OrgType = "courier"
		} else if ctx.TicketOrgID != "" {
			ctx.OrgType = "ticket"
		} else {
			writeOrgContextError(c, &OrgContextError{
				Code:    "INVALID_ORG_TYPE",
				Message: "Organization type is not set in session",
			})
			return ""
		}
	}

	// Check: Is this a known org type?
	if _, err := orgtypes.GetByString(ctx.OrgType); err != nil {
		writeOrgContextError(c, &OrgContextError{
			Code:    "UNKNOWN_ORG_TYPE",
			Message: fmt.Sprintf("Unknown organization type: %s", ctx.OrgType),
		})
		return ""
	}

	// Check: Does caller have required capability?
	if requiredCapability != "" {
		if !hasOrgCapability(ctx, requiredCapability) {
			writeOrgContextError(c, &OrgContextError{
				Code:    "INSUFFICIENT_PERMISSION",
				Message: "Your role doesn't allow that operation",
			})
			return ""
		}
	}

	return ctx.OrgID
}

// hasOrgCapability checks if the context has a specific org capability.
// It handles the org-type-prefixed capability naming automatically.
func hasOrgCapability(ctx Ctx, capability string) bool {
	if ctx.OrgType == "" {
		return false
	}

	// Build the full capability name with org-type prefix
	// Example: ("courier", "read") -> "parcelorg.read"
	orgTypeDef, err := orgtypes.GetByString(ctx.OrgType)
	if err != nil {
		return false
	}

	fullCapability := orgTypeDef.CapabilityPrefix + "." + capability

	// Check if context has this capability
	for _, cap := range ctx.Capabilities {
		if cap == fullCapability {
			return true
		}
	}

	return false
}

// GetOrgContext returns the organization metadata from the Ctx.
// Useful for logging, audit trails, and operation scoping.
func GetOrgContext(ctx Ctx) *OrgContextData {
	return &OrgContextData{
		OrgID:      ctx.OrgID,
		OrgType:    ctx.OrgType,
		StaffID:    ctx.ActorID,
		PartyID:    ctx.PartyID,
		Profile:    ctx.SessionProfile,
		Verified:   ctx.Verified,
		ExpiresAt:  ctx.ExpiresAt,
	}
}

// OrgContextData holds organization context for operations.
type OrgContextData struct {
	OrgID     string
	OrgType   string
	StaffID   string
	PartyID   string
	Profile   string
	Verified  bool
	ExpiresAt int64
}

// IsOrgScoped checks if a Ctx is scoped to an organization.
func IsOrgScoped(ctx Ctx) bool {
	return ctx.OrgID != "" || ctx.ParcelOrgID != "" || ctx.TicketOrgID != ""
}

// writeOrgContextError writes an org context error to the response.
// Uses a format compatible with the existing error handling.
func writeOrgContextError(c *gin.Context, err *OrgContextError) {
	c.JSON(403, gin.H{
		"code":    err.Code,
		"message": err.Message,
	})
}

// VerifyOrgOwnership verifies that a given staff member belongs to the given org
// in the current session context.
func VerifyOrgOwnership(ctx Ctx, requestedOrgID string) bool {
	if ctx.OrgID != requestedOrgID {
		return false
	}
	return ctx.Verified
}

// MustBeOrgScoped is a middleware-style helper that panics if the context
// is not org-scoped. Used in tests and helpers that assume org context.
func MustBeOrgScoped(ctx Ctx) *OrgContextData {
	if !IsOrgScoped(ctx) {
		panic("context is not org-scoped")
	}
	return GetOrgContext(ctx)
}
