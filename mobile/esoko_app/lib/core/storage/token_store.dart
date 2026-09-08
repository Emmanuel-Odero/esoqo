import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Bearer-token-at-rest storage — iOS Keychain / Android Keystore, never
/// SharedPreferences (plaintext) or an in-memory-only singleton (loses
/// the session on every cold start). This is the mobile equivalent of the
/// web apps' httpOnly `esoko_session` cookie: same opaque token, same
/// Redis-backed session on the core-go side, just carried differently in
/// transport (see services/core-go/README.md and
/// docs/adr/0005-mobile-api-in-go.md).
///
/// One token slot, two kinds of session: a signed-in Party (SUBJECT,
/// via /v1/auth/*) or an org-scoped crew PIN login (AGENT, via
/// /v1/ticket-staff/sign-in — see core/auth/agent_session.dart). They
/// are mutually exclusive on one device by construction, same as a
/// physical work phone either being someone's personal Esoko account or
/// signed in to a till/scanner terminal, never both — writing one kind
/// always clears the other. [ApiClient] doesn't care which kind is
/// active; it just attaches whatever [read] returns.
enum SessionKind { subject, agent }

class TokenStore {
  TokenStore._();
  static final TokenStore instance = TokenStore._();

  static const _key = 'esoko_session_token';
  static const _kindKey = 'esoko_session_kind';
  static const _agentContextKey = 'esoko_agent_context';

  final _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  Future<String?> read() => _storage.read(key: _key);

  Future<SessionKind?> readKind() async {
    final raw = await _storage.read(key: _kindKey);
    return switch (raw) {
      'agent' => SessionKind.agent,
      'subject' => SessionKind.subject,
      _ => null,
    };
  }

  /// Raw JSON blob describing the current agent session (org id, role,
  /// name, linked crewMemberId) — only meaningful when [readKind] is
  /// [SessionKind.agent]. See AgentSession.toJson/fromJson.
  Future<String?> readAgentContext() => _storage.read(key: _agentContextKey);

  /// A person signing in as themselves — clears any prior crew session
  /// on this device, same as a work terminal being handed back before
  /// someone signs in on their own account.
  Future<void> write(String token) async {
    await _storage.write(key: _key, value: token);
    await _storage.write(key: _kindKey, value: 'subject');
    await _storage.delete(key: _agentContextKey);
  }

  /// A crew PIN login — see AgentSessionController.signInAsCrew.
  Future<void> writeAgent(String token, String agentContextJson) async {
    await _storage.write(key: _key, value: token);
    await _storage.write(key: _kindKey, value: 'agent');
    await _storage.write(key: _agentContextKey, value: agentContextJson);
  }

  Future<void> clear() => Future.wait([
        _storage.delete(key: _key),
        _storage.delete(key: _kindKey),
        _storage.delete(key: _agentContextKey),
      ]);
}
