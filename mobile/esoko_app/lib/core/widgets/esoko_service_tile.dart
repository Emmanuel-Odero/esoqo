import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_card.dart';
import 'esoko_quick_action_icon.dart';

/// One square in the home hub's services grid.
///
/// Replaces the full-width `EsokoListTile` row the hub used to stack
/// six of. That list was honest but expensive: each row carried an
/// icon, a title and a two-line subtitle, so three filled the screen
/// and reaching Parcels — the sixth — meant scrolling past everything
/// else. The grid trades the subtitle for density, which is the right
/// trade for a launcher: somebody opening this screen already knows
/// what "Bills" means, and the subtitle was answering a question they
/// stopped asking after the first week.
///
/// Same [heroTag] contract as before, so the icon still flies into
/// [EsokoServiceScaffold]'s app bar on push.
class EsokoServiceTile extends StatelessWidget {
  const EsokoServiceTile({
    super.key,
    required this.label,
    required this.icon,
    required this.heroTag,
    required this.onTap,
    this.badge,
    this.institutional = false,
  });

  final String label;
  final IconData icon;
  final String heroTag;
  final VoidCallback onTap;

  /// A live count worth seeing before the tap — parcels in your hands,
  /// bills due this week. Null renders nothing rather than a zero: an
  /// empty badge is noise, and "0" is a worse way of saying "nothing
  /// here" than saying nothing.
  final String? badge;

  /// Blue rather than green, per SCREEN_CONVENTIONS.md Rule 3 — for a
  /// tile that opens something belonging to an organisation rather
  /// than to the signed-in person.
  final bool institutional;

  @override
  Widget build(BuildContext context) {
    final accent = institutional ? EsokoColors.blue : null;

    return Semantics(
      button: true,
      label: badge == null ? label : '$label, $badge',
      child: EsokoCard(
        onTap: onTap,
        // No horizontal padding: at four-across the cell is ~77pt wide,
        // and Card's own 4pt margin plus a border already separate
        // neighbours. Spending another 8pt here is what pushed
        // "Transport" — the longest service name — into an ellipsis.
        padding: const EdgeInsets.symmetric(vertical: EsokoSpacing.s3),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Hero(
                  tag: heroTag,
                  child: EsokoQuickActionIcon(icon: icon, size: 40),
                ),
                if (badge != null)
                  Positioned(
                    top: -4,
                    right: -6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 1,
                      ),
                      constraints: const BoxConstraints(minWidth: 18),
                      decoration: BoxDecoration(
                        color: accent ?? EsokoColors.green,
                        borderRadius: BorderRadius.circular(EsokoRadius.pill),
                        border: Border.all(
                          color: Theme.of(context).cardColor,
                          width: 1.5,
                        ),
                      ),
                      child: Text(
                        badge!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          height: 1.3,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: EsokoSpacing.s2),
            // Flexible, not a bare Text: at large text scales the
            // label grows past whatever height the grid allotted, and
            // an unconstrained Text in a Column overflows rather than
            // ellipsising. This lets it take what's left and clip
            // gracefully instead — the same 200%-text-scale guarantee
            // role_lead_test.dart already holds EsokoRoleLead to.
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  // 11.5, not 12.5: "Transport" is the longest label
                  // the grid has to fit on one line in a ~69pt cell,
                  // and it is the measure every other label is cheap
                  // against.
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: accent,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
