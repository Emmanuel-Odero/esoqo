import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Bearer-token-at-rest storage — iOS Keychain / Android Keystore, never
/// SharedPreferences (plaintext) or an in-memory-only singleton (loses
/// the session on every cold start). This is the mobile equivalent of the
/// web apps' httpOnly `esoko_session` cookie: same opaque token, same
/// Redis-backed session on the core-go side, just carried differently in
/// transport (see services/core-go/README.md and
/// docs/adr/0005-mobile-api-in-go.md).
class TokenStore {
  TokenStore._();
  static final TokenStore instance = TokenStore._();

  static const _key = 'esoko_session_token';

  final _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  Future<String?> read() => _storage.read(key: _key);

  Future<void> write(String token) => _storage.write(key: _key, value: token);

  Future<void> clear() => _storage.delete(key: _key);
}
