import 'package:flutter/material.dart';

import '../../../core/theme/esoko_tokens.dart';
import '../ticketing_models.dart';

class TicketClassOption extends StatelessWidget {
  const TicketClassOption({
    super.key,
    required this.ticketClass,
    required this.selected,
    required this.onTap,
  });
  final TicketClass ticketClass;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    return Material(
      // Alpha wash of primary, not the fixed EsokoColors.greenTint — see
      // the identical fix in order_detail_screen's timeline/pickup-code
      // card: a fixed pastel only reads right on a light surface.
      color: selected
          ? scheme.primary.withValues(alpha: isDark ? 0.20 : 0.12)
          : Theme.of(context).cardColor,
      borderRadius: BorderRadius.circular(EsokoRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          margin: const EdgeInsets.only(bottom: EsokoSpacing.s2),
          padding: const EdgeInsets.all(EsokoSpacing.s3),
          decoration: BoxDecoration(
            border: Border.all(
              color: selected ? scheme.primary : EsokoColors.line,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.check_circle : Icons.circle_outlined,
                color: selected ? scheme.primary : muted,
                size: 22,
              ),
              const SizedBox(width: EsokoSpacing.s3),
              Icon(
                ticketClass.seated
                    ? Icons.event_seat_outlined
                    : Icons.groups_outlined,
                color: muted,
                size: 18,
              ),
              const SizedBox(width: EsokoSpacing.s2),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      ticketClass.name,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    if (ticketClass.amenities.isNotEmpty)
                      Text(
                        ticketClass.amenities.join(' · '),
                        style: TextStyle(fontSize: 11, color: muted),
                      ),
                  ],
                ),
              ),
              Text(
                'KES ${ticketClass.priceKes}',
                style: TextStyle(
                  color: scheme.primary,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
