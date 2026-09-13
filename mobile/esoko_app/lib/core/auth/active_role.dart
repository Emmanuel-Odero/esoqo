import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_controller.dart';
import 'auth_state.dart';
import 'org_context_state.dart';
import 'scan_access.dart';

/// Who the person using the app is *right now*.
///
/// ## Why this exists
///
/// Switching into an org context repainted the app bar blue and
/// reordered six tiles. That was the whole of it: `HomeShell` held
/// `static const _screens = [HomeHubScreen(), ProfileScreen()]` — two
/// screens, for every role. So "acting as" worked correctly and felt
/// like nothing happened, which is the worst combination: the
/// machinery is right, and the person cannot tell.
///
/// A role is not a permission. The server decides what anyone may do
/// (see `scan_access.dart` — this is navigation, never a boundary).
/// A role is an answer to "what is this person in the middle of", and
/// it decides what the app leads with.
enum EsokoRole {
  /// No org context, nothing in hand. Browsing services.
  personal,

  /// Carrying parcels right now — and possibly somebody else's cash.
  /// Deliberately ranked above every org role below: a person with a
  /// package that has to reach a door today is the most time-pressured
  /// state this app can detect, whatever else they are.
  courier,

  /// On duty with a vehicle — collecting fares, declaring cash.
  crew,

  /// On duty checking people in — tickets, boarding passes.
  scanner,

  /// Running an organisation — takings, staff, fleet.
  manager,
}

/// The resolved role plus the context it came from.
class ActiveRole {
  const ActiveRole({
    required this.role,
    this.orgName,
    this.heldParcels = 0,
    this.holdingCash = false,
  });

  final EsokoRole role;

  /// Set when the role came from an org grant — what the app bar and
  /// the home lead say the person is acting as.
  final String? orgName;

  /// Parcels physically in this person's custody.
  final int heldParcels;

  /// Whether any of somebody else's cash-on-delivery money is on them.
  final bool holdingCash;

  bool get isPersonal => role == EsokoRole.personal;

  /// True while acting on an organisation's behalf — the condition for
  /// institutional (blue) chrome, per SCREEN_CONVENTIONS.md Rule 3.
  bool get isInstitutional =>
      role == EsokoRole.crew ||
      role == EsokoRole.scanner ||
      role == EsokoRole.manager;

  /// What the home screen leads with. Short enough for an app bar.
  String get title => switch (role) {
        EsokoRole.personal => 'Home',
        EsokoRole.courier => 'Your round',
        EsokoRole.crew => orgName ?? 'On duty',
        EsokoRole.scanner => orgName ?? 'Checking in',
        EsokoRole.manager => orgName ?? 'Your company',
      };

  /// One line under the title saying why this role is showing.
  String get because => switch (role) {
        EsokoRole.personal => 'Everything Esoko does, in one place.',
        EsokoRole.courier => holdingCash
            ? 'Parcels in your hands, and cash to hand in.'
            : 'Parcels in your hands.',
        EsokoRole.crew => 'Collecting fares and declaring cash.',
        EsokoRole.scanner => 'Checking people in.',
        EsokoRole.manager => 'Today’s takings, staff and fleet.',
      };
}

/// Resolves [ActiveRole] from what is already known — no new endpoint.
///
/// Ranked, not combined: a person can be all of these at once (a SACCO
/// manager who also drives and carries parcels), and the app has to
/// lead with one. Custody outranks duty, and duty outranks browsing,
/// because that is the order in which somebody else is waiting.
///
/// [heldParcels] and [holdingCash] are passed in rather than watched
/// here so this stays a pure function of its inputs — the parcels
/// providers are `autoDispose` and watching them from a global provider
/// would keep them alive for the whole session.
ActiveRole resolveActiveRole({
  required AuthState auth,
  required OrgContextState orgContext,
  int heldParcels = 0,
  bool holdingCash = false,
}) {
  final profile = auth is AuthSignedIn ? auth.profile : null;
  final active = orgContext.active;

  if (heldParcels > 0) {
    return ActiveRole(
      role: EsokoRole.courier,
      orgName: active?.orgName,
      heldParcels: heldParcels,
      holdingCash: holdingCash,
    );
  }

  if (active != null) {
    final role = switch (active.role) {
      'CREW' => EsokoRole.crew,
      'SCANNER' => EsokoRole.scanner,
      'MANAGER' || 'ADMIN' => EsokoRole.manager,
      // An unknown grant still means "acting as an org" — fall back to
      // the least-privileged surface rather than dropping the person
      // silently back to Personal, which would look like the switch
      // failed.
      _ => EsokoRole.scanner,
    };
    return ActiveRole(
      role: role,
      orgName: active.orgName,
      holdingCash: holdingCash,
    );
  }

  // No org context switched in, but an unrestricted crew capability is
  // still crew — this is the pre-org-context AGENT path, and someone
  // holding `fare.verify` is on a vehicle whether or not they used the
  // switcher (see scan_access.dart).
  if (canVerifyFare(profile)) {
    return ActiveRole(role: EsokoRole.crew, holdingCash: holdingCash);
  }

  return ActiveRole(role: EsokoRole.personal, holdingCash: holdingCash);
}

/// The role with no custody signals — enough for chrome (app bar tint,
/// nav) that must not keep the `autoDispose` parcels providers alive.
///
/// Screens that already watch those providers (the home) pass the
/// counts to [resolveActiveRole] directly instead.
final activeRoleProvider = Provider<ActiveRole>((ref) {
  return resolveActiveRole(
    auth: ref.watch(authControllerProvider),
    orgContext: ref.watch(orgContextControllerProvider),
  );
});
