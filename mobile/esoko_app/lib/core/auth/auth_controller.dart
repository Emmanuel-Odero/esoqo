import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../api/providers.dart';
import '../storage/token_store.dart';
import 'auth_state.dart';

/// One controller for every OTP/PIN/session call against core-go's
/// `/v1/auth/*` — see services/core-go/README.md for the endpoint list
/// and docs/adr/0005-mobile-api-in-go.md for why this exists as a
/// separate Go service rather than more TypeScript.
class AuthController extends Notifier<AuthState> {
  late final ApiClient _api;

  @override
  AuthState build() {
    // Shared with every other screen (see core/api/providers.dart) —
    // its onUnauthorized reads back into this controller via
    // signOutLocally, so a 401 anywhere in the app drops straight to
    // sign-in without each feature needing its own 401 handling.
    _api = ref.read(apiClientProvider);
    // Fire-and-forget: check for a stored token from a previous session.
    _restore();
    return const AuthUnknown();
  }

  /// Drops local session state without calling the sign-out endpoint —
  /// used when core-go itself just told us the session is gone (a 401),
  /// so calling sign-out again would just 401 a second time.
  void signOutLocally() {
    state = const AuthSignedOut();
  }

  Future<void> _restore() async {
    final token = await TokenStore.instance.read();
    if (token == null) {
      state = const AuthSignedOut();
      return;
    }
    try {
      final me = await _api.get('/v1/me');
      state = AuthSignedIn(EsokoProfile.fromJson(me));
    } on ApiException {
      await TokenStore.instance.clear();
      state = const AuthSignedOut();
    }
  }

  /// Step 1 of sign-up/sign-in-by-OTP — POST /v1/auth/otp. Purpose is
  /// "SIGN_IN" for the combined sign-up-or-sign-in flow (see
  /// handleVerifyOtp's own comment on core-go's side), "PIN_RESET" for
  /// the forgot-PIN flow.
  Future<void> requestOtp({required String msisdn, required String purpose}) async {
    await _api.post('/v1/auth/otp', {'msisdn': msisdn, 'purpose': purpose});
  }

  /// Step 2 of the OTP sign-up/sign-in flow — a correct code both
  /// verifies the number AND signs the person in (auto-provisioning a
  /// bare Party+Person on first use). Returns whether they already have
  /// a PIN set, so the UI knows whether to prompt for one.
  Future<bool> verifyOtpAndSignIn({required String msisdn, required String code}) async {
    final result = await _api.post('/v1/auth/verify-otp', {
      'msisdn': msisdn,
      'purpose': 'SIGN_IN',
      'code': code,
    });
    await _completeSignIn(result['token'] as String);
    return result['hasPinSet'] as bool? ?? false;
  }

  /// Returning-user PIN sign-in — phone or email + PIN.
  Future<void> signIn({required String identifier, required String pin}) async {
    final result = await _api.post('/v1/auth/sign-in', {'identifier': identifier, 'pin': pin});
    await _completeSignIn(result['token'] as String);
  }

  /// Forgot-PIN flow, step 2 — verifies the PIN_RESET code and sets a new
  /// PIN in one call, signing the person in immediately.
  Future<void> resetPin({required String msisdn, required String code, required String pin}) async {
    final result = await _api.post('/v1/auth/pin/reset', {'msisdn': msisdn, 'code': code, 'pin': pin});
    await _completeSignIn(result['token'] as String);
  }

  /// Sets/replaces a PIN for the currently signed-in person (not the
  /// forgot-PIN flow — that's [resetPin]).
  Future<void> setPin(String pin) => _api.post('/v1/auth/set-pin', {'pin': pin});

  Future<void> signOut() async {
    try {
      await _api.post('/v1/auth/sign-out');
    } on ApiException {
      // A Redis hiccup must not block the app from dropping its own
      // token anyway — same reasoning as the web apps' sign-out route.
    }
    await TokenStore.instance.clear();
    state = const AuthSignedOut();
  }

  Future<void> _completeSignIn(String token) async {
    await TokenStore.instance.write(token);
    final me = await _api.get('/v1/me');
    state = AuthSignedIn(EsokoProfile.fromJson(me));
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);
