import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';
import 'esoqo_card.dart';
import 'esoqo_quick_action_icon.dart';

/// One square in the home hub's services grid.
///
/// Replaces the full-width `EsoqoListTile` row the hub used to stack
/// six of. That list was honest but expensive: each row carried an
/// icon, a title and a two-line subtitle, so three filled the screen
/// and reaching Parcels — the sixth — meant scrolling past everything
/// else. The grid trades the subtitle for density, which is the right
/// trade for a launcher: somebody opening this screen already knows
/// what "Bills" means, and the subtitle was answering a question they
/// stopped asking after the first week.
///
/// Same [heroTag] contract as before, so the icon still flies into
/// [EsoqoServiceScaffold]'s app bar on push.
class EsoqoServiceTile extends StatelessWidget {
  const EsoqoServiceTile({
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
    final accent = institutional ? EsoqoColors.blue : null;

    return Semantics(
      button: true,
      label: badge == null ? label : '$label, $badge',
      child: EsoqoCard(
        onTap: onTap,
        // No horizontal padding: at four-across the cell is ~77pt wide,
        // and Card's own 4pt margin plus a border already separate
        // neighbours. Spending another 8pt here is what pushed
        // "Transport" — the longest service name — into an ellipsis.
        padding: const EdgeInsets.symmetric(vertical: EsoqoSpacing.s3),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Hero(
                  tag: heroTag,
                  child: EsoqoQuickActionIcon(icon: icon, size: 40),
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
                        color: accent ?? EsoqoColors.green,
                        borderRadius: BorderRadius.circular(EsoqoRadius.pill),
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
                          fontSize: EsoqoTypeScale.micro,
                          fontWeight: FontWeight.w700,
                          height: 1.3,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: EsoqoSpacing.s2),
            // Flexible, not a bare Text: at large text scales the
            // label grows past whatever height the grid allotted, and
            // an unconstrained Text in a Column overflows rather than
            // ellipsising. This lets it take what's left and clip
            // gracefully instead — the same 200%-text-scale guarantee
            // role_lead_test.dart already holds EsoqoRoleLead to.
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                // The label voice — micro, not meta: "Transport" is the
                // longest label the grid has to fit on one line in a
                // ~69pt cell, and it is the measure every other label
                // is cheap against. Its 1.2 line-height matters as much
                // as its size here: a bare TextStyle would merge with
                // the ambient DefaultTextStyle and inherit *body*
                // line-height (1.5), making an 11pt label 16.5pt tall,
                // which the Flexible then clips out of the tile's own
                // tap target.
                style: Theme.of(
                  context,
                ).textTheme.labelSmall!.copyWith(color: accent),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
