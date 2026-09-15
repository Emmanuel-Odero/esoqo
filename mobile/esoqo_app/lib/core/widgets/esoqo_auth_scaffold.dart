import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_logo.dart';

/// The one screen shell for every auth-flow screen — sign in, sign in
/// with a code, reset your PIN. Before this, only `SignInScreen` had a
/// deliberate look (a big centred logo, a headline); the OTP and
/// forgot-PIN screens each hand-rolled their own `Scaffold` around a
/// navy `EsokoAppBar` instead, so stepping from "Sign in" into "Sign in
/// with a code" read as leaving the app rather than continuing the
/// same flow.
///
/// This isn't just a shared header snippet — it's the whole shell,
/// deliberately, because the header alone didn't fix the real problem:
/// vertically *centring* an auth form (what all three screens used to
/// do) is the wrong call for this content shape. A form's height
/// changes as steps reveal more fields (phone → code → set a PIN), so
/// a centred column visibly re-settles to a new position every step;
/// centring also fights the keyboard, which shoves a centred column up
/// and off-balance the moment a field gets focus. Real auth screens
/// (Stripe, banking apps, App Store sign-in) anchor to the top for
/// exactly this reason — content holds still, the keyboard just
/// reveals more of the scroll region below it. Anchoring top also
/// means a lone back arrow never again floats alone in a sea of empty
/// space above it, which is what made the OTP/forgot-PIN screens look
/// broken rather than merely differently-styled.
///
/// [onBack] is left null on the flow's own entry point (plain
/// `SignInScreen` has nowhere to go back to); every screen reached by
/// pushing on top of it passes `Navigator.of(context).pop`.
class EsokoAuthScaffold extends StatelessWidget {
  const EsokoAuthScaffold({
    super.key,
    required this.title,
    required this.subtitle,
    required this.children,
    this.onBack,
  });

  final String title;
  final String subtitle;
  final List<Widget> children;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                EsokoSpacing.s6,
                EsokoSpacing.s3,
                EsokoSpacing.s6,
                EsokoSpacing.s6,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Header(title: title, subtitle: subtitle, onBack: onBack),
                  ...children,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.title, required this.subtitle, this.onBack});

  final String title;
  final String subtitle;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final onBack = this.onBack;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // No reserved space when there's no back arrow — a screen
        // either always has one or never does (it doesn't gain or lose
        // one at runtime), so there's no in-place "jump" to guard
        // against; reserving the row anyway just pushed the root sign
        // in screen's logo needlessly further down the one time it
        // matters most (first thing anyone sees).
        if (onBack != null) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: IconButton(
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
              visualDensity: VisualDensity.compact,
            ),
          ),
          const SizedBox(height: EsokoSpacing.s4),
        ],
        const EsokoBrandLockup(
          size: 44,
          mainAxisAlignment: MainAxisAlignment.center,
        ),
        const SizedBox(height: EsokoSpacing.s5),
        Text(title, style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: EsokoSpacing.s2),
        Text(subtitle),
        const SizedBox(height: EsokoSpacing.s6),
      ],
    );
  }
}
