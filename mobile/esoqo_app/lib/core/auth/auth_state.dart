/// A signed-in person's own view of themselves — mirrors GET /v1/me's
/// response shape (see services/core-go/internal/httpapi/handlers_auth.go).
class EsoqoProfile {
  const EsoqoProfile({
    required this.partyId,
    this.esoqoId,
    required this.officialName,
    this.knownAs,
    this.msisdn,
    required this.capabilities,
  });

  factory EsoqoProfile.fromJson(Map<String, dynamic> json) => EsoqoProfile(
        partyId: json['partyId'] as String,
        esoqoId: json['esoqoId'] as String?,
        officialName: json['officialName'] as String,
        knownAs: json['knownAs'] as String?,
        msisdn: json['msisdn'] as String?,
        capabilities: (json['capabilities'] as List?)?.cast<String>() ?? const [],
      );

  final String partyId;
  /// The short, human-typeable handle, e.g. "johnmutu482" — see
  /// dbx.EnsureEsoqoPaymentId. What the UI should actually show; partyId
  /// (a raw UUID) is an internal identifier, not something a person
  /// should ever need to read or type.
  final String? esoqoId;
  final String officialName;
  final String? knownAs;
  final String? msisdn;
  final List<String> capabilities;

  /// What the UI greets someone with — "known as" if they set one,
  /// otherwise whatever's on file (often just their own phone number for
  /// a freshly-provisioned account — see core-go's FindOrCreatePersonByMsisdn).
  String get displayName => knownAs?.isNotEmpty == true ? knownAs! : officialName;

  bool has(String capability) => capabilities.contains(capability);
}

/// Sealed auth state — deliberately three states, not a bool, so the UI
/// can show a splash/loading screen instead of flashing the sign-in
/// screen while the stored token is still being checked on cold start.
sealed class AuthState {
  const AuthState();
}

class AuthUnknown extends AuthState {
  const AuthUnknown();
}

class AuthSignedOut extends AuthState {
  const AuthSignedOut();
}

class AuthSignedIn extends AuthState {
  const AuthSignedIn(this.profile);
  final EsoqoProfile profile;
}
