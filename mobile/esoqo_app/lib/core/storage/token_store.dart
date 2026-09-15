import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Bearer-token-at-rest storage — iOS Keychain / Android Keystore, never
/// SharedPreferences (plaintext) or an in-memory-only singleton (loses
/// the session on every cold start). This is the mobile equivalent of the
/// web apps' httpOnly `esoko_session` cookie: same opaque token, same
/// Redis-backed session on the core-go side, just carried differently in
/// transport (see services/core-go/README.md and
/// docs/adr/0005-mobile-api-in-go.md).
///
/// One token slot, one kind of session: a signed-in Party (SUBJECT, via
/// /v1/auth/*). There used to be a second kind here — an org-scoped crew
/// PIN login (AGENT, via /v1/ticket-staff/sign-in) that was mutually
/// exclusive with a SUBJECT session on the same device. It's retired
/// from this app: per company policy every crew member holds their own
/// Esoqo account, so org-staff duty is now a SUBJECT session
/// *additionally* carrying a live, OTP-activated org context (see
/// [writeOrgContext] below and docs/proposals/
/// esoqo-unified-crew-identity.md) rather than a whole second credential
/// and a second, device-locking session kind. core-go's AGENT session
/// type and `/v1/ticket-staff/sign-in` endpoint still exist server-side
/// (unmigrated staff, other clients) — this app just no longer creates
/// or reads that kind of session.
class TokenStore {
  TokenStore._();
  static final TokenStore instance = TokenStore._();

  static const _key = 'esoko_session_token';
  static const _orgContextKey = 'esoko_org_context';

  final _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  Future<String?> read() => _storage.read(key: _key);

  Future<void> write(String token) => _storage.write(key: _key, value: token);

  Future<void> clear() => Future.wait([
        _storage.delete(key: _key),
        _storage.delete(key: _orgContextKey),
      ]);

  /// A SUBJECT's live, OTP-activated org-staff context (see
  /// core/auth/org_context_state.dart) — an *overlay* on top of the one
  /// subject session, not a competing session kind: it never touches
  /// [_key], and clearing it never signs the person out. Stored so
  /// [ApiClient] can attach `X-Esoqo-Org-Context` without an extra round
  /// trip, and so the switcher survives a cold start; the only thing
  /// that actually authorises anything is core-go's own live
  /// Redis+Postgres check on every request, never this cache.
  Future<void> writeOrgContext(String orgContextJson) =>
      _storage.write(key: _orgContextKey, value: orgContextJson);

  Future<String?> readOrgContext() => _storage.read(key: _orgContextKey);

  Future<void> clearOrgContext() => _storage.delete(key: _orgContextKey);
}
