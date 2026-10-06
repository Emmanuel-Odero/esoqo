/**
 * Kenya business registration verification.
 *
 * This module handles verification of business registration numbers
 * against official registries. Currently supports:
 * - Placeholder for future integration with:
 *   - Kenya Business Register (KBR)
 *   - KBRA (Kenya Revenue Authority)
 *   - County registries
 *
 * For now, we implement basic format validation and log attempts
 * for manual review. External API integration can be added later.
 */

export interface RegistrationVerification {
  isValid: boolean;
  message: string;
  verified: boolean; // false means unverified but accepted; true means verified against registry
  registrySource?: string;
}

/**
 * Validate a Kenyan business registration number format.
 * Formats vary by type:
 * - Limited Companies: typically 9 digits or alphanumeric
 * - Partnerships/Sole Proprietorship: may be shorter
 * - Cooperatives: "CP/" prefix + number
 * - SACCO: often "SACCO/" prefix
 */
export function validateBusinessRegistrationFormat(
  registrationNo: string,
  businessType?: string,
): RegistrationVerification {
  const trimmed = registrationNo.trim().toUpperCase();

  // Check minimum length
  if (trimmed.length < 3) {
    return {
      isValid: false,
      message: 'Registration number is too short',
      verified: false,
    };
  }

  // Check maximum length
  if (trimmed.length > 40) {
    return {
      isValid: false,
      message: 'Registration number is too long',
      verified: false,
    };
  }

  // Known prefixes for specific business types
  const knownPrefixes = ['CP/', 'SACCO/', 'LP/', 'NG/'];
  const hasKnownPrefix = knownPrefixes.some((p) => trimmed.startsWith(p));

  // If no known prefix, should be primarily numeric or alphanumeric
  if (!hasKnownPrefix) {
    // Allow alphanumeric with hyphens and slashes
    if (!/^[A-Z0-9/-]+$/.test(trimmed)) {
      return {
        isValid: false,
        message: 'Registration number contains invalid characters',
        verified: false,
      };
    }
  }

  // Format is acceptable (not yet verified against registry)
  return {
    isValid: true,
    message: 'Registration number format is acceptable',
    verified: false, // Not verified against actual registry yet
  };
}

/**
 * Verify registration against external registries.
 * This is a placeholder for future integration.
 *
 * TODO: Implement actual API calls to:
 * - Kenya Business Register
 * - KBRA systems
 * - County registries
 */
export async function verifyBusinessRegistration(
  registrationNo: string,
  businessName?: string,
): Promise<RegistrationVerification> {
  // For now, just do format validation
  const formatCheck = validateBusinessRegistrationFormat(registrationNo);

  if (!formatCheck.isValid) {
    return formatCheck;
  }

  // In production, this would call external APIs:
  // const result = await kbrApi.verify(registrationNo);
  // if (result.found && result.name === businessName) {
  //   return { isValid: true, message: 'Verified', verified: true, registrySource: 'KBR' };
  // }

  // For now, accept format-valid numbers with a note that they need manual verification
  return {
    isValid: true,
    message:
      'Registration number format is valid. Manual verification may be required.',
    verified: false,
    registrySource: 'pending_manual_review',
  };
}
