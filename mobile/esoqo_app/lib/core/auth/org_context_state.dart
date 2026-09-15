import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../api/providers.dart';
import '../storage/token_store.dart';
import 'auth_controller.dart';
import 'auth_state.dart';

/// One org a signed-in person can additionally act as staff for — see
/// GET /v1/me/org-grants. `active` mirrors core-go's own live check
/// (Redis activation + Postgres grant status), not a locally-cached
/// guess; the switcher re-fetches this on open.
class OrgGrant {
  const OrgGrant({
    required this.orgId,
    required this.orgName,
    required this.role,
    required this.status,
    required this.active,
    this.crewMemberId,
  });

  factory OrgGrant.fromJson(Map<String, dynamic> json) => OrgGrant(
    orgId: json['orgId'] as String,
    orgName: json['orgName'] as String? ?? 'Organisation',
    role: json['role'] as String,
    status: json['status'] as String,
    active: json['active'] as bool? ?? false,
    crewMemberId: json['crewMemberId'] as String?,
  );

  final String orgId;
  final String orgName;
  final String role; // SCANNER | MANAGER | ADMIN | CREW
  final String status; // active | suspended
  final bool active;

  /// Set only for role == CREW and only once a manager has linked this
  /// grant to a CrewMember — see dbx.CreateOrgStaffGrant. Null means
  /// "can declare cash, can't close a trip yet", same fail-closed
  /// contract the old AGENT CREW login had.
  final String? crewMemberId;

  bool get suspended => status == 'suspended';
}

/// The one org context currently switched in on this device, if any.
/// Cached in [TokenStore] only so [ApiClient] can attach the header and
/// the switcher can render without a network round trip first — never
/// trusted as proof of anything by itself.
class ActiveOrgContext {
  const ActiveOrgContext({
    required this.orgId,
    required this.orgName,
    required this.role,
    this.crewMemberId,
  });

  factory ActiveOrgContext.fromJson(Map<String, dynamic> json) =>
      ActiveOrgContext(
        orgId: json['orgId'] as String,
        orgName: json['orgName'] as String,
        role: json['role'] as String,
        crewMemberId: json['crewMemberId'] as String?,
      );

  Map<String, dynamic> toJson() => {
    'orgId': orgId,
    'orgName': orgName,
    'role': role,
    'crewMemberId': crewMemberId,
  };

  final String orgId;
  final String orgName;
  final String role;
  final String? crewMemberId;

  bool get isCrew => role == 'CREW';
}

class OrgContextState {
  const OrgContextState({
    this.grants = const [],
    this.active,
    this.loading = false,
    this.error,
  });

  final List<OrgGrant> grants;
  final ActiveOrgContext? active;
  final bool loading;

  /// Set when [OrgContextController.refreshGrants] fails — surfaced by
  /// the switcher instead of the old silent swallow, which used to leave
  /// a screen showing nothing useful with no way to tell "still loading"
  /// from "the request actually failed".
  final String? error;

  OrgContextState copyWith({
    List<OrgGrant>? grants,
    ActiveOrgContext? active,
    bool clearActive = false,
    bool? loading,
    String? error,
    bool clearError = false,
  }) => OrgContextState(
    grants: grants ?? this.grants,
    active: clearActive ? null : (active ?? this.active),
    loading: loading ?? this.loading,
    error: clearError ? null : (error ?? this.error),
  );
}

/// One controller for the "am I also on duty somewhere" switcher — see
/// docs/proposals/esoqo-unified-crew-identity.md. Every activation is
/// OTP-gated (no PIN fast path, by design: an unlocked phone alone must
/// never be enough to also act as staff), and every deactivation/expiry
/// requires OTP again next time, suspension or not.
class OrgContextController extends Notifier<OrgContextState> {
  late final ApiClient _api;

  @override
  OrgContextState build() {
    _api = ref.read(apiClientProvider);
    // A signed-out SUBJECT can't have a live org context either — reset
    // in lockstep rather than waiting for a stale switcher to notice on
    // its own next open. Covers both an explicit sign-out and a 401
    // (see core/api/providers.dart's onUnauthorized). The reverse edge
    // (sign-in) reconciles local vs. server state too (see
    // _reconcileOnSignIn), so the Home app bar's duty chip and
    // Settings' "My companies & roles" have data the moment either
    // renders, instead of only after the switcher screen has been
    // opened once.
    ref.listen(authControllerProvider, (previous, next) {
      if (next is AuthSignedOut) {
        state = const OrgContextState();
      } else if (next is AuthSignedIn && previous is! AuthSignedIn) {
        _reconcileOnSignIn();
      }
    });
    // ref.listen only fires on a *future* transition — a cold start
    // where AuthController has already resolved to AuthSignedIn by the
    // time this controller builds would otherwise never see that edge.
    // Deferred to a microtask either way: touching `state` (which both
    // _reconcileOnSignIn and _restoreActive do) synchronously here runs
    // before build() has returned an initial state to the Notifier,
    // which throws "Tried to read the state of an uninitialized
    // provider".
    if (ref.read(authControllerProvider) is AuthSignedIn) {
      Future.microtask(_reconcileOnSignIn);
    } else {
      // Not signed in yet on this build — still worth restoring
      // whatever this device last had switched in, so it's ready the
      // instant sign-in resolves instead of racing it.
      Future.microtask(_restoreActive);
    }
    return const OrgContextState();
  }

  /// Cold start / fresh sign-in: restores whatever this device last had
  /// locally switched in, then reconciles that against the server's
  /// live truth. A grant can be live on the server (Redis activation +
  /// Postgres grant both still good) while this device's local cache
  /// has nothing for it — [switchToPersonal] only ever clears the
  /// *local* cache by design (see its own comment), a fresh install's
  /// Keychain can come back empty, or the activation could have been
  /// made from a different device entirely. Without this reconcile,
  /// screens that ask the server directly (Settings' "My companies &
  /// roles", via [refreshGrants]) truthfully show "On duty", while
  /// everything keyed off the local `active`/profile capabilities
  /// instead — the Home app bar's tint, the "Scan to verify" CTA,
  /// crew-only routes — never catches up: the exact "screen view
  /// changes, the actions under the role don't" split this fixes. Only
  /// auto-resumes when exactly one grant is live — with two, which one
  /// to silently pick is a real choice, left to the switcher instead of
  /// guessed here.
  Future<void> _reconcileOnSignIn() async {
    await _restoreActive();
    await refreshGrants();
    if (state.active == null) {
      final live = state.grants.where((g) => g.active).toList();
      if (live.length == 1) {
        await resumeIfLive(live.first);
      }
    }
  }

  Future<void> _restoreActive() async {
    final raw = await TokenStore.instance.readOrgContext();
    if (raw == null) return;
    try {
      state = state.copyWith(
        active: ActiveOrgContext.fromJson(
          jsonDecode(raw) as Map<String, dynamic>,
        ),
      );
    } catch (_) {
      await TokenStore.instance.clearOrgContext();
    }
  }

  /// Loads every org this person holds a staff grant for, and whether
  /// each is currently switched in — the switcher's data source.
  Future<void> refreshGrants() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      final result = await _api.get('/v1/me/org-grants');
      final grants = (result['grants'] as List? ?? [])
          .map((g) => OrgGrant.fromJson(g as Map<String, dynamic>))
          .toList();
      state = state.copyWith(grants: grants, loading: false, clearError: true);
    } on ApiException catch (e) {
      state = state.copyWith(loading: false, error: e.message);
    } catch (e) {
      state = state.copyWith(
        loading: false,
        error: 'Could not load your roles — $e',
      );
    }
  }

  /// Step 1: sends an OTP to the caller's own verified number. Fails
  /// with SUSPENDED/NO_GRANT from core-go if there's nothing to
  /// activate — see handleOrgContextActivateRequest.
  Future<void> requestActivation(String orgId) =>
      _api.post('/v1/org-context/activate/request', {'orgId': orgId});

  /// Step 2: correct code switches the context in, TTL-bound (30-90
  /// days server-side, config.Config.OrgContextActivationDays) — once
  /// it lapses, or if an admin suspends it sooner, it always needs OTP
  /// again next time, no "remember me" fast path.
  Future<void> verifyActivation(String orgId, String code) async {
    final result = await _api.post('/v1/org-context/activate/verify', {
      'orgId': orgId,
      'code': code,
    });
    final grant = state.grants.firstWhere(
      (g) => g.orgId == orgId,
      orElse: () => OrgGrant(
        orgId: orgId,
        orgName: 'Organisation',
        role: result['role'] as String? ?? '',
        status: 'active',
        active: true,
      ),
    );
    final active = ActiveOrgContext(
      orgId: orgId,
      orgName: grant.orgName,
      role: result['role'] as String? ?? grant.role,
      crewMemberId: grant.crewMemberId,
    );
    await TokenStore.instance.writeOrgContext(jsonEncode(active.toJson()));
    state = state.copyWith(active: active);
    await refreshGrants();
    // The layered staff capabilities (see core-go's
    // layerOrgStaffCapabilities) only show up in GET /v1/me's response
    // once the header is sent — refresh now so canVerifyFare and
    // similar checks reflect duty status immediately, not after the
    // next unrelated /v1/me call.
    await _refreshProfileBestEffort();
  }

  /// Checks whether [orgId]'s activation is still live server-side
  /// (core-go's Redis+Postgres check, GET /v1/org-context/status) and,
  /// if so, switches the display to it *without* another OTP — this is
  /// the fix for "we already verified, why does switching keep asking
  /// again": earlier, going back to Personal called [deactivate] (which
  /// really does end the activation), so the very next switch back into
  /// the same org found nothing live and demanded OTP again, every
  /// single time, even within the 30–90 day window that activation was
  /// supposed to last. [switchToPersonal] below no longer does that —
  /// this method is what a re-selected, still-live org grant uses to
  /// resume instantly. Returns false (never throws) when the activation
  /// has genuinely lapsed or been suspended, so the caller falls back to
  /// the OTP flow.
  Future<bool> resumeIfLive(OrgGrant grant) async {
    try {
      final result = await _api.get(
        '/v1/org-context/status?orgId=${grant.orgId}',
      );
      if (result['active'] != true) return false;
    } catch (_) {
      return false;
    }
    final active = ActiveOrgContext(
      orgId: grant.orgId,
      orgName: grant.orgName,
      role: grant.role,
      crewMemberId: grant.crewMemberId,
    );
    await TokenStore.instance.writeOrgContext(jsonEncode(active.toJson()));
    state = state.copyWith(active: active);
    await _refreshProfileBestEffort();
    return true;
  }

  /// "Switch back to Personal" — a *display* change only. Deliberately
  /// does not call the server: the org's activation keeps running for
  /// its full 30–90 day TTL in the background, so switching to this org
  /// again later (via [resumeIfLive]) doesn't need a fresh OTP. Ending
  /// the activation itself — the thing that actually forces the next
  /// switch-in through OTP again — is [endDuty] below, a distinct,
  /// deliberate action (see CrewShiftScreen's "End duty").
  Future<void> switchToPersonal() async {
    await TokenStore.instance.clearOrgContext();
    state = state.copyWith(clearActive: true);
    await _refreshProfileBestEffort();
  }

  /// The real, deliberate end of an org context — kills the activation
  /// server-side (core-go's Redis key), so the *next* switch-in, for
  /// this device or any other, needs a fresh OTP regardless of how much
  /// of the TTL was left. This is what "End duty" actually means; a
  /// plain "switch to Personal" (see [switchToPersonal]) is not this.
  Future<void> endDuty(String orgId) async {
    await _api.post('/v1/org-context/deactivate', {'orgId': orgId});
    if (state.active?.orgId == orgId) {
      await TokenStore.instance.clearOrgContext();
      state = state.copyWith(clearActive: true);
    }
    await refreshGrants();
    await _refreshProfileBestEffort();
  }

  /// Best-effort, but tries twice: this is the *only* thing that
  /// closes the gap between "switched in" and "the role's capabilities
  /// actually work" (app bar tint, Scan-to-verify CTA, crew-only
  /// routes), and a transient failure here used to leave that gap open
  /// silently, forever — nothing else in the app retries a stale
  /// profile on its own. A short backoff covers the case a cold-start
  /// caller hits most: the base URL is still being resolved (see
  /// ApiClient._resolveBaseUrl) when the first attempt fires.
  Future<void> _refreshProfileBestEffort() async {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        await ref.read(authControllerProvider.notifier).refreshProfile();
        return;
      } catch (_) {
        if (attempt == 0) await Future.delayed(const Duration(seconds: 1));
      }
    }
    // Still best-effort after the retry — the next natural /v1/me call
    // (e.g. opening Settings) catches up anyway.
  }
}

final orgContextControllerProvider =
    NotifierProvider<OrgContextController, OrgContextState>(
      OrgContextController.new,
    );
