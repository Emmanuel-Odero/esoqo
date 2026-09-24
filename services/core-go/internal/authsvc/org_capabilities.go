package authsvc

import (
	"fmt"
	"strings"

	"github.com/esoqo/core-go/internal/orgtypes"
)

// ResolveOrgCapabilities resolves the full list of capabilities for a staff member
// based on their role and any custom overrides.
//
// This replaces the courier-specific parcelStaffCapabilities function with a
// generic, org-type-aware implementation.
//
// The precedence is:
// 1. Custom capabilities if provided (overrides everything)
// 2. Preset role capabilities if role matches a known role
// 3. Empty list if role is unknown and no custom capabilities provided
func ResolveOrgCapabilities(
	orgType string,
	role string,
	customCapabilities []string,
) ([]string, error) {
	// Validate org type
	orgTypeDef, err := orgtypes.GetByString(orgType)
	if err != nil {
		return nil, fmt.Errorf("invalid org type %s: %w", orgType, err)
	}

	// If custom capabilities provided, use them (after validation)
	if len(customCapabilities) > 0 {
		return sanitizeCapabilities(orgType, customCapabilities), nil
	}

	// Look up role definition
	roleDef, ok := orgTypeDef.StaffRoles[role]
	if !ok {
		// Unknown role: return empty capabilities (safer than allowing everything)
		// Caller may choose to fall back to a default role
		return []string{}, nil
	}

	// Build full capability names from role definition
	capabilities := make([]string, 0, len(roleDef.Capabilities))
	for _, cap := range roleDef.Capabilities {
		fullCap := orgTypeDef.CapabilityPrefix + "." + cap
		capabilities = append(capabilities, fullCap)
	}

	return capabilities, nil
}

// sanitizeCapabilities validates that all provided capabilities are valid
// for the given org type. Removes any that aren't recognized.
func sanitizeCapabilities(orgType string, customCapabilities []string) []string {
	orgTypeDef, err := orgtypes.GetByString(orgType)
	if err != nil {
		// If org type is invalid, return empty (fail closed)
		return []string{}
	}

	// Build set of valid capabilities for this org type
	validCapabilities := make(map[string]bool)
	prefix := orgTypeDef.CapabilityPrefix + "."

	// Collect all capabilities from all roles
	for _, roleDef := range orgTypeDef.StaffRoles {
		for _, cap := range roleDef.Capabilities {
			validCapabilities[prefix+cap] = true
		}
	}

	// Filter custom capabilities
	sanitized := make([]string, 0, len(customCapabilities))
	for _, cap := range customCapabilities {
		// Allow both prefixed and unprefixed forms
		if validCapabilities[cap] {
			sanitized = append(sanitized, cap)
		} else if validCapabilities[prefix+cap] {
			// If provided without prefix, add prefix
			sanitized = append(sanitized, prefix+cap)
		}
		// Otherwise silently drop invalid capability
	}

	return sanitized
}

// HasCapability checks if a context has a specific capability.
// Handles both prefixed and unprefixed capability names.
//
// Examples:
//   - HasCapability(ctx, "parcelorg.read") returns true if context has it
//   - HasCapability(ctx, "read") returns true if context has "parcelorg.read" (if org type is courier)
func HasCapability(ctx Ctx, capability string) bool {
	if len(ctx.Capabilities) == 0 {
		return false
	}

	// Check exact match first
	for _, cap := range ctx.Capabilities {
		if cap == capability {
			return true
		}
	}

	// If no exact match and no org type, we're done
	if ctx.OrgType == "" {
		return false
	}

	// Check if capability should be prefixed
	orgTypeDef, err := orgtypes.GetByString(ctx.OrgType)
	if err != nil {
		return false
	}

	// If capability doesn't have a dot, it's unprefixed
	if !strings.Contains(capability, ".") {
		prefixedCap := orgTypeDef.CapabilityPrefix + "." + capability
		for _, cap := range ctx.Capabilities {
			if cap == prefixedCap {
				return true
			}
		}
	}

	return false
}

// HasAnyCapability checks if a context has any of the given capabilities.
func HasAnyCapability(ctx Ctx, capabilities ...string) bool {
	for _, cap := range capabilities {
		if HasCapability(ctx, cap) {
			return true
		}
	}
	return false
}

// HasAllCapabilities checks if a context has all of the given capabilities.
func HasAllCapabilities(ctx Ctx, capabilities ...string) bool {
	for _, cap := range capabilities {
		if !HasCapability(ctx, cap) {
			return false
		}
	}
	return true
}

// CanManageStaff checks if a staff member (by role) can manage other staff in their org.
func CanManageStaff(orgType string, role string) bool {
	orgTypeDef, err := orgtypes.GetByString(orgType)
	if err != nil {
		return false
	}

	roleDef, ok := orgTypeDef.StaffRoles[role]
	if !ok {
		return false
	}

	return roleDef.CanManageStaff
}

// CanManageStaffByContext checks if the current context has staff management rights.
func CanManageStaffByContext(ctx Ctx) bool {
	if ctx.OrgType == "" {
		return false
	}

	// Check if context has any staff management capability
	// For now, we use a convention: org can be managed by staff with "staff" or "write" capabilities
	return HasAnyCapability(ctx, "staff", "write")
}

// RoleDescription returns a human-readable description of a role.
func RoleDescription(orgType string, role string) (string, error) {
	roleDef, err := orgtypes.GetRole(orgtypes.OrgType(orgType), role)
	if err != nil {
		return "", err
	}
	return roleDef.Description, nil
}

// ListRolesForOrgType returns all available roles for an organization type.
func ListRolesForOrgType(orgType string) ([]orgtypes.RoleDefinition, error) {
	orgTypeDef, err := orgtypes.GetByString(orgType)
	if err != nil {
		return nil, err
	}

	roles := make([]orgtypes.RoleDefinition, 0, len(orgTypeDef.StaffRoles))
	for _, roleDef := range orgTypeDef.StaffRoles {
		roles = append(roles, roleDef)
	}
	return roles, nil
}

// ListCapabilitiesForRole returns all capabilities for a specific role.
func ListCapabilitiesForRole(orgType string, role string) ([]string, error) {
	caps, err := orgtypes.AllCapabilitiesForRole(orgtypes.OrgType(orgType), role)
	if err != nil {
		return nil, err
	}
	return caps, nil
}

// GetDefaultRoleForOrgType returns the default role for new staff in an org type.
// If multiple defaults exist, returns the first one found.
func GetDefaultRoleForOrgType(orgType string) (string, error) {
	orgTypeDef, err := orgtypes.GetByString(orgType)
	if err != nil {
		return "", err
	}

	for roleID, roleDef := range orgTypeDef.StaffRoles {
		if roleDef.IsDefault {
			return roleID, nil
		}
	}

	// No default found; return first role (arbitrary but consistent)
	for roleID := range orgTypeDef.StaffRoles {
		return roleID, nil
	}

	return "", fmt.Errorf("no roles found for org type %s", orgType)
}

// MigrateCapabilities migrates capabilities from one org type to another.
// Useful for org type migration or testing.
// Returns empty list if role doesn't exist in target org type.
func MigrateCapabilities(fromOrgType string, toOrgType string, role string) ([]string, error) {
	// Confirm the source role exists (ignore result — we use target caps if available)
	_, err := orgtypes.AllCapabilitiesForRole(orgtypes.OrgType(fromOrgType), role)
	_ = err // not an error if source role is absent

	// Try to resolve role in target org type
	// This will succeed if the role exists with the same name
	targetCapabilities, err := orgtypes.AllCapabilitiesForRole(
		orgtypes.OrgType(toOrgType), role,
	)
	if err != nil {
		// Role doesn't exist in target; use empty
		targetCapabilities = []string{}
	}

	// If we have target capabilities, use those; otherwise use source
	// (stripped of their prefix)
	if len(targetCapabilities) > 0 {
		return targetCapabilities, nil
	}

	// Try to extract base capabilities from source and reapply to target
	return ResolveOrgCapabilities(toOrgType, role, []string{})
}
