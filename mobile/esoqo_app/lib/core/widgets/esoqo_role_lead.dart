import 'package:flutter/material.dart';

import '../auth/active_role.dart';
import '../theme/esoqo_tokens.dart';
import 'esoqo_icon.dart';

/// The first thing on the home screen, and the one part of it that
/// changes with who you are.
///
/// Before this, home opened with the same greeting card and the same
/// six service tiles for everybody — a launcher. A courier with three
/// parcels and somebody else's cash in their pocket had to recognise
/// "Parcels" among six tiles, tap in, and find the list. The signals
/// needed to do better were already being computed: the hub used
/// `heldCount` and the COD float to write a *tile subtitle*.
///
/// So this promotes them. The role decides the colour, the words and
/// the actions; [ActiveRole] decides the role. Nothing here queries
/// anything — it is given what the home already knows.
///
/// Colour follows SCREEN_CONVENTIONS.md Rule 3: navy is the person's
/// own home, blue means you are acting for an institution, amber means
/// you are carrying something that has to reach somebody today.
class EsoqoRoleLead extends StatelessWidget {
  const EsoqoRoleLead({
    super.key,
    required this.role,
    required this.displayName,
    this.esoqoId,
    this.primaryLabel,
    this.onPrimary,
    this.secondaryLabel,
    this.onSecondary,
    this.detail,
  });

  final ActiveRole role;
  final String displayName;
  final String? esoqoId;

  /// The one thing this role is most likely to be opening the app to do.
  final String? primaryLabel;
  final VoidCallback? onPrimary;

  final String? secondaryLabel;
  final VoidCallback? onSecondary;

  /// A live figure worth stating before any tap — "KES 4,200 to hand
  /// in", "12 checked in today".
  final String? detail;

  /// Courier gets amber rather than blue: they are not acting *for* an
  /// institution, they are holding something. Amber is this system's
  /// "attention, but not an error" (see EsoqoColors), which is exactly
  /// what a parcel and somebody else's cash are.
  (Color, Color) get _colours => switch (role.role) {
        EsoqoRole.personal => (EsoqoColors.navy, EsoqoColors.navy2),
        EsoqoRole.courier => (EsoqoColors.amber, EsoqoColors.amberWarm),
        EsoqoRole.crew ||
        EsoqoRole.scanner ||
        EsoqoRole.manager =>
          (EsoqoColors.blue, EsoqoColors.navy3),
      };

  EsoqoIconName get _icon => switch (role.role) {
        EsoqoRole.personal => EsoqoIconName.grid,
        EsoqoRole.courier => EsoqoIconName.box,
        EsoqoRole.crew => EsoqoIconName.truck,
        EsoqoRole.scanner => EsoqoIconName.qr,
        EsoqoRole.manager => EsoqoIconName.building,
      };

  @override
  Widget build(BuildContext context) {
    final (from, to) = _colours;
    final onColour = Colors.white;

    return Semantics(
      container: true,
      label: '${role.title}. ${role.because}',
      child: Container(
        padding: const EdgeInsets.all(EsoqoSpacing.s5),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(EsoqoRadius.xl),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [from, to],
          ),
          boxShadow: EsoqoShadows.sheet,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        role.isPersonal ? 'Hello,' : 'Acting as',
                        style: TextStyle(
                          color: onColour.withValues(alpha: 0.75),
                          fontSize: EsoqoTypeScale.meta,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        role.isPersonal ? displayName : role.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: onColour,
                          fontFamily: EsoqoFonts.display,
                          fontSize: EsoqoTypeScale.sectionTitle,
                          height: EsoqoTypography.headlineHeight,
                          fontWeight: EsoqoTypography.headlineWeight,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: EsoqoSpacing.s3),
                // Decorative: the label above already says the role, so
                // a screen reader announcing the icon too would just
                // repeat it.
                ExcludeSemantics(
                  child: Container(
                    padding: const EdgeInsets.all(EsoqoSpacing.s3),
                    decoration: BoxDecoration(
                      color: onColour.withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(EsoqoRadius.lg),
                    ),
                    child: EsoqoIcon(_icon, size: 22, color: onColour),
                  ),
                ),
              ],
            ),
            const SizedBox(height: EsoqoSpacing.s3),
            Text(
              role.because,
              style: TextStyle(
                color: onColour.withValues(alpha: 0.85),
                fontSize: EsoqoTypeScale.meta,
                height: 1.35,
              ),
            ),
            if (detail != null) ...[
              const SizedBox(height: EsoqoSpacing.s3),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: EsoqoSpacing.s3,
                  vertical: EsoqoSpacing.s2,
                ),
                decoration: BoxDecoration(
                  color: onColour.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(EsoqoRadius.md),
                ),
                child: Text(
                  detail!,
                  style: EsoqoTypography.mono(
                    fontSize: EsoqoTypeScale.label,
                    fontWeight: FontWeight.w600,
                    color: onColour,
                  ),
                ),
              ),
            ],
            if (esoqoId != null && role.isPersonal) ...[
              const SizedBox(height: EsoqoSpacing.s2),
              Text(
                esoqoId!,
                style: EsoqoTypography.mono(
                  fontSize: EsoqoTypeScale.meta,
                  color: onColour.withValues(alpha: 0.7),
                ),
              ),
            ],
            if (onPrimary != null) ...[
              const SizedBox(height: EsoqoSpacing.s4),
              Row(
                children: [
                  Expanded(
                    child: _LeadAction(
                      label: primaryLabel!,
                      onTap: onPrimary!,
                      background: onColour,
                      foreground: from,
                    ),
                  ),
                  if (onSecondary != null) ...[
                    const SizedBox(width: EsoqoSpacing.s2),
                    Expanded(
                      child: _LeadAction(
                        label: secondaryLabel!,
                        onTap: onSecondary!,
                        background: onColour.withValues(alpha: 0.18),
                        foreground: onColour,
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A button that has to sit on a saturated gradient, where neither the
/// theme's filled nor its outlined style reads. Kept private so it
/// cannot become a fourth way to draw a button elsewhere — everything
/// off this card uses [EsoqoButton].
class _LeadAction extends StatelessWidget {
  const _LeadAction({
    required this.label,
    required this.onTap,
    required this.background,
    required this.foreground,
  });

  final String label;
  final VoidCallback onTap;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: background,
      borderRadius: BorderRadius.circular(EsoqoRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(EsoqoRadius.md),
        child: Container(
          // 44px min height, same target every EsoqoButton keeps.
          constraints: const BoxConstraints(minHeight: 44),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: EsoqoSpacing.s3),
          child: Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: foreground,
              fontSize: EsoqoTypeScale.label,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}
