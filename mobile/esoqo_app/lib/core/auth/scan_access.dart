import 'auth_state.dart';

/// Least-privilege visibility for scan features. `has` is exact-match
/// (unlike the server's qualifier-aware matcher), so owner grants like
/// `fare.read:own` do NOT count — only the unrestricted crew/staff
/// grants below. The server enforces the same rule (own-fares-only for
/// everyone else), so this gating is navigation convenience, never the
/// security boundary.
///
/// Passenger level (everyone, incl. guests): scan bus QR, vouchers,
/// self-checkout, restaurant tables — resolving is public, paying uses
/// the payer's own wallet/STK.
/// Crew level: verify any fare.
bool canVerifyFare(EsoqoProfile? profile) {
  if (profile == null) return false;
  return profile.has('fare.verify') || profile.has('ticketorg.read');
}
