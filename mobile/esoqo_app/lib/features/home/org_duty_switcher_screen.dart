import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/org_context_state.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../fleet/crew_shift_screen.dart';

/// Opens the quick "which account am I acting as" picker as a bottom
/// sheet — the surface [HatsIconButton] opens, and what Settings'
/// "My companies & roles" card's "Switch duty" button opens too, so
/// there's exactly one switcher implementation, not two that could
/// drift apart.
Future<void> showHatsQuickSwitchSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const _HatsSheet(),
  );
}

/// The "which hat am I wearing" entry point — a plain Esoqo account
/// (person + gear, `Icons.manage_accounts`) wherever an account switch
/// should be reachable — the Home app bar, and CrewShiftScreen (staying
/// on duty must never mean losing the way back to other roles).
/// Deliberately icon-only, no label/chip text: this is a
/// regular-account-only affordance for people who hold more than one
/// hat (their own account plus at least one staff grant) — anyone else
/// never sees it at all, so it reads as "yes, there's more here" rather
/// than permanent chrome everyone has to parse.
class HatsIconButton extends ConsumerWidget {
  const HatsIconButton({super.key, this.color});

  /// Override the icon's colour — callers on a non-navy bar (e.g. a
  /// blue "on duty" bar) need a colour that still reads against their
  /// own background, not the navy-tuned default.
  final Color? color;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(orgContextControllerProvider);
    if (state.grants.isEmpty) return const SizedBox.shrink();

    return IconButton(
      icon: const Icon(Icons.manage_accounts_outlined),
      tooltip: state.active != null ? 'Switched to: ${state.active!.orgName}' : 'Switch to…',
      color: color ?? (state.active != null ? EsoqoColors.blue2 : Colors.white),
      onPressed: () => showHatsQuickSwitchSheet(context),
    );
  }
}

/// Full-page fallback for the `/org-duty` deep link — same content as
/// the bottom sheet, just given a Scaffold + app bar for a direct
/// navigation target instead of a modal.
class OrgDutySwitcherScreen extends StatelessWidget {
  const OrgDutySwitcherScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Switch to'),
      body: const SafeArea(child: _HatsList()),
    );
  }
}

class _HatsSheet extends StatelessWidget {
  const _HatsSheet();

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.65,
      minChildSize: 0.45,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => Column(
        children: [
          const SizedBox(height: EsoqoSpacing.s2),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: EsoqoColors.line,
              borderRadius: BorderRadius.circular(EsoqoRadius.pill),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(EsoqoSpacing.s4),
            child: Text('Switch to', style: Theme.of(context).textTheme.titleMedium),
          ),
          Expanded(child: _HatsList(scrollController: scrollController)),
        ],
      ),
    );
  }
}

/// One row's live status — a plain enum instead of scattered booleans,
/// so every possible state (and therefore every possible thing the
/// person sees on screen) is enumerable and each one maps to an
/// unambiguous visual. This is the direct answer to "the screen shows
/// nothing after clicking, so I click again" — every state below is
/// rendered, none of them is invisible, and once a row enters
/// [requesting] the *entire list* is dimmed and un-tappable so a second
/// tap physically cannot register.
enum _RowStatus { idle, active, suspended, requesting }

/// The "Personal Esoqo account" + role rows. Three real bugs fixed
/// here, on top of the wording/labelling change:
///
/// 1. An earlier version hid the whole list behind `state.loading`, so
///    a slow/failed fetch rendered nothing at all — no spinner, no
///    error, just the app bar. The personal-account row is now
///    unconditional and a failed fetch shows the real error message.
/// 2. Tapping a row used to open a *second* modal bottom sheet (the OTP
///    step) stacked on top of this one, which from inside an
///    already-open sheet read as "nothing happened, it just stacked".
///    The OTP entry now swaps in *in place* of the row list.
/// 3. `_switchIn`/`_switchOut` only caught [ApiException] — any other
///    failure (a raw socket/timeout error, a JSON shape surprise) threw
///    into an unawaited Future and vanished with zero visible feedback,
///    which is the single most likely explanation for "I tapped it and
///    nothing happened, so I tapped it again". Both now catch
///    everything, always end in a terminal, visible state, and a
///    request that's taking unusually long says so explicitly instead
///    of spinning forever.
class _HatsList extends ConsumerStatefulWidget {
  const _HatsList({this.scrollController});
  final ScrollController? scrollController;

  @override
  ConsumerState<_HatsList> createState() => _HatsListState();
}

class _HatsListState extends ConsumerState<_HatsList> {
  /// Non-null while any switch request is in flight — gates every row's
  /// tappability, not just the one being switched, so a second tap
  /// during a slow network call is structurally impossible rather than
  /// just discouraged.
  String? _requestingOrgId;

  /// Set once a switch-in request has succeeded and the OTP step should
  /// replace the list in place.
  OrgGrant? _verifying;

  /// Surfaced under the busy row once a request has been in flight
  /// longer than [_slowRequestAfter] — turns "is this stuck?" into an
  /// explicit, honest answer instead of silence.
  bool _requestIsSlow = false;
  Timer? _slowRequestTimer;
  static const _slowRequestAfter = Duration(seconds: 6);

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(orgContextControllerProvider.notifier).refreshGrants());
  }

  @override
  void dispose() {
    _slowRequestTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final verifying = _verifying;
    if (verifying != null) {
      return _OtpStep(
        orgName: verifying.orgName,
        orgId: verifying.orgId,
        onDone: (success) {
          setState(() => _verifying = null);
          if (success) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Switched to ${verifying.orgName}')),
            );
            if (verifying.role == 'CREW') {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CrewShiftScreen()));
            }
          }
        },
      );
    }

    final state = ref.watch(orgContextControllerProvider);
    final busy = _requestingOrgId != null;
    return RefreshIndicator(
      onRefresh: () => ref.read(orgContextControllerProvider.notifier).refreshGrants(),
      child: AbsorbPointer(
        absorbing: busy,
        child: ListView(
          controller: widget.scrollController,
          padding: const EdgeInsets.all(EsoqoSpacing.s4),
          children: [
            const EsoqoSectionHeader(title: 'Current'),
            _personalAccountTile(state),
            const SizedBox(height: EsoqoSpacing.s4),
            if (state.error != null)
              EsoqoFormError(message: state.error!)
            else if (state.loading && state.grants.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: EsoqoSpacing.s4),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (state.grants.isNotEmpty) ...[
              const EsoqoSectionHeader(title: 'Roles'),
              for (final grant in state.grants) _grantTile(context, grant),
            ] else
              const EsoqoEmptyState(
                message: 'No other roles yet — an organisation admin adds you once you have an Esoqo account.',
              ),
          ],
        ),
      ),
    );
  }

  /// "Personal Esoqo account" — the default identity, always available,
  /// clearly marked as the active one whenever no org context is
  /// switched on. Naming it "Personal Esoqo account" instead of the
  /// bare pronoun "You" is deliberate: next to a list of named
  /// organisations, "You" reads as a placeholder that got left in,
  /// while "Personal Esoqo account" reads as one option among several,
  /// consistently named the same way the others are.
  Widget _personalAccountTile(OrgContextState state) {
    final isActive = state.active == null;
    return EsoqoListTile(
      title: 'Personal Esoqo account',
      subtitle: isActive ? 'Currently active' : 'Your own account — always available',
      icon: Icons.person,
      trailing: isActive ? const Icon(Icons.check_circle, color: EsoqoColors.green) : null,
      // Free, instant, no OTP — this only changes which context is
      // *displayed*; the org's own activation (if any) keeps running in
      // the background for its full TTL. See switchToPersonal's own
      // comment for why this is deliberately not the same thing as
      // ending duty.
      onTap: isActive || _requestingOrgId != null ? null : () => _switchToPersonal(),
    );
  }

  Widget _grantTile(BuildContext context, OrgGrant grant) {
    final state = ref.read(orgContextControllerProvider);
    final isActive = state.active?.orgId == grant.orgId;
    final status = grant.suspended
        ? _RowStatus.suspended
        : _requestingOrgId == grant.orgId
            ? _RowStatus.requesting
            : isActive
                ? _RowStatus.active
                : _RowStatus.idle;

    return Padding(
      padding: const EdgeInsets.only(bottom: EsoqoSpacing.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          EsoqoListTile(
            title: grant.orgName,
            subtitle: grant.suspended ? 'Suspended — contact your organisation\'s admin' : grant.role,
            icon: Icons.badge_outlined,
            // Blue, not green — SCREEN_CONVENTIONS.md: this row is about
            // an organisation, not the signed-in person's own record.
            iconColor: EsoqoColors.blue,
            iconBackground: EsoqoColors.blueTint,
            // A full button used to sit in `trailing` — ListTile can't
            // size an unconstrained button next to a long subtitle and
            // throws "Trailing widget consumes the entire tile width"
            // at layout time, which renders as a silently blank tile.
            // The action was always redundant with `onTap` anyway.
            trailing: switch (status) {
              _RowStatus.requesting =>
                const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
              _RowStatus.suspended => const EsoqoStatusPill(label: 'Suspended', color: Colors.red),
              _RowStatus.active => const Icon(Icons.check_circle, color: EsoqoColors.green),
              _RowStatus.idle => const Icon(Icons.chevron_right, size: 20),
            },
            onTap: status == _RowStatus.suspended || status == _RowStatus.requesting
                ? null
                : (status == _RowStatus.active ? () => _switchToPersonal() : () => _switchIn(grant)),
          ),
          if (status == _RowStatus.requesting) ...[
            const SizedBox(height: EsoqoSpacing.s1),
            Padding(
              padding: const EdgeInsets.only(left: EsoqoSpacing.s4),
              child: Text(
                _requestIsSlow ? 'Still working on it — this is taking longer than usual…' : 'Working on it…',
                style: TextStyle(fontSize: EsoqoTypeScale.labelSmall, color: Theme.of(context).textTheme.bodySmall?.color),
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _beginRequest(String orgId) {
    setState(() {
      _requestingOrgId = orgId;
      _requestIsSlow = false;
    });
    _slowRequestTimer?.cancel();
    _slowRequestTimer = Timer(_slowRequestAfter, () {
      if (mounted) setState(() => _requestIsSlow = true);
    });
  }

  void _endRequest() {
    _slowRequestTimer?.cancel();
    if (mounted) setState(() => _requestingOrgId = null);
  }

  /// Always free, always local — see switchToPersonal's own comment.
  Future<void> _switchToPersonal() async {
    await ref.read(orgContextControllerProvider.notifier).switchToPersonal();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Switched to Personal Esoqo account')));
  }

  /// Tries to resume a still-live activation first — the actual fix for
  /// "we already verified, why is it asking again": only a genuinely
  /// lapsed or suspended activation falls through to the OTP flow.
  Future<void> _switchIn(OrgGrant grant) async {
    _beginRequest(grant.orgId);
    final controller = ref.read(orgContextControllerProvider.notifier);

    bool resumed;
    try {
      resumed = await controller.resumeIfLive(grant);
    } catch (_) {
      resumed = false;
    }
    if (resumed) {
      _endRequest();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Switched to ${grant.orgName}')));
      return;
    }

    try {
      await controller.requestActivation(grant.orgId);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_describe(e))));
      _endRequest();
      return;
    }
    _endRequest();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Code sent — check your messages.')));
    setState(() => _verifying = grant);
  }

  /// Turns any exception into copy a person can act on — the earlier
  /// version only handled [ApiException], so anything else (a plain
  /// socket error, a timeout, a JSON surprise) propagated silently with
  /// no message shown at all.
  String _describe(Object e) => switch (e) {
        ApiException e => e.message,
        _ => 'Could not reach Esoqo. Check your connection and try again.',
      };
}

/// The OTP step — replaces the role list in place (see _HatsListState's
/// own doc comment for why this is no longer a second stacked sheet).
/// Wrapped in a scroll view and keyboard-aware padding so the keyboard
/// opening can never overflow this fixed-height sheet — an overflow
/// here would hit the exact same silent-blank-render failure mode as
/// the ListTile bug above, just triggered by the keyboard instead of a
/// long subtitle.
class _OtpStep extends ConsumerStatefulWidget {
  const _OtpStep({required this.orgName, required this.orgId, required this.onDone});

  final String orgName;
  final String orgId;

  /// Called once with whether activation actually succeeded — the
  /// parent handles the snackbar/navigation, this widget only owns the
  /// code-entry form.
  final ValueChanged<bool> onDone;

  @override
  ConsumerState<_OtpStep> createState() => _OtpStepState();
}

class _OtpStepState extends ConsumerState<_OtpStep> {
  final _codeController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(orgContextControllerProvider.notifier).verifyActivation(widget.orgId, _codeController.text.trim());
      widget.onDone(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not verify that code. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: EdgeInsets.only(
        left: EsoqoSpacing.s4,
        right: EsoqoSpacing.s4,
        top: EsoqoSpacing.s4,
        bottom: MediaQuery.of(context).viewInsets.bottom + EsoqoSpacing.s4,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: _loading ? null : () => widget.onDone(false),
              ),
              Expanded(
                child: Text('Verify it\'s you', style: Theme.of(context).textTheme.titleMedium),
              ),
            ],
          ),
          const SizedBox(height: EsoqoSpacing.s2),
          Text('Enter the code we sent you to switch to ${widget.orgName}.'),
          const SizedBox(height: EsoqoSpacing.s4),
          EsoqoField.otp(
            controller: _codeController,
            label: '6-digit code',
            onSubmitted: (_) => _verify(),
          ),
          if (_error != null) EsoqoFormError(message: _error!),
          const SizedBox(height: EsoqoSpacing.s4),
          EsoqoButton.primary(expand: false, label: 'Verify', loading: _loading, onPressed: _verify),
        ],
      ),
    );
  }
}
