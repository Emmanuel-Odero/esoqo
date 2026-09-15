import 'package:flutter/material.dart';

import '../../../core/theme/esoqo_tokens.dart';
import '../ticketing_models.dart';

class SeatButton extends StatelessWidget {
  const SeatButton({
    super.key,
    required this.seat,
    required this.selected,
    required this.onTap,
  });
  final SeatRow seat;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final taken = seat.status != 'AVAILABLE';
    // Available seats sit on the scheme surface, never a hardcoded
    // white — the seat map stays legible in dark mode.
    final Color bg = taken
        ? EsoqoColors.line
        : (selected
              ? EsoqoColors.green
              : Theme.of(context).colorScheme.surface);
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final Color? fg = taken
        ? muted?.withValues(alpha: 0.6)
        : (selected ? Colors.white : muted);
    return SizedBox(
      width: 36,
      height: 36,
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(EsoqoRadius.sm),
        child: InkWell(
          onTap: taken ? null : onTap,
          borderRadius: BorderRadius.circular(EsoqoRadius.sm),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EsoqoRadius.sm),
              border: Border.all(
                color: selected ? EsoqoColors.green : EsoqoColors.line,
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.event_seat, size: 14, color: fg),
                Text(
                  seat.label,
                  // Label voice: this is a 36pt cell holding an icon
                  // and a seat number, so the body face's reading
                  // line-height is height it cannot spare.
                  style: Theme.of(context).textTheme.labelSmall!.copyWith(
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
