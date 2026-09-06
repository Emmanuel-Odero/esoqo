import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'ticketing_models.dart';
import 'ticketing_repository.dart';

final myTicketsProvider = FutureProvider.autoDispose<List<TicketRow>>(
  (ref) => ref.watch(ticketingRepositoryProvider).myTickets(),
);

/// GET /v1/me/tickets (authenticated) — every ticket ever issued to this
/// signed-in person, styled as a tear-off stub and QR-coded by its
/// `code` (the same string a gate scanner's check-in flow reads — see
/// Ticket.code in schema.prisma).
class MyTicketsScreen extends ConsumerWidget {
  const MyTicketsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(myTicketsProvider);
    return Scaffold(
      appBar: const EsokoAppBar(title: 'My tickets'),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myTicketsProvider),
        child: EsokoAsyncView(
          value: tickets,
          isEmpty: (list) => list.isEmpty,
          emptyMessage: 'No tickets yet.',
          emptyIcon: Icons.confirmation_num_outlined,
          onRetry: () => ref.invalidate(myTicketsProvider),
          data: (context, list) => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: ListView.separated(
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                itemCount: list.length,
                separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s5),
                itemBuilder: (context, i) => EsokoStagger(index: i, child: _TicketStub(ticket: list[i])),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TicketStub extends StatelessWidget {
  const _TicketStub({required this.ticket});
  final TicketRow ticket;

  @override
  Widget build(BuildContext context) {
    final valid = ticket.status == 'VALID';
    final accent = valid ? EsokoColors.navy : EsokoColors.text3;

    return Material(
      elevation: 2,
      shadowColor: Colors.black.withValues(alpha: 0.15),
      borderRadius: BorderRadius.circular(EsokoRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          // Stub head — ticket-class + status, on a navy band like a
          // real boarding pass/admission ticket.
          Container(
            padding: const EdgeInsets.all(EsokoSpacing.s4),
            color: accent,
            child: Row(
              children: [
                Icon(Icons.confirmation_num_rounded, color: Colors.white.withValues(alpha: 0.85), size: 20),
                const SizedBox(width: EsokoSpacing.s2),
                Expanded(
                  child: Text(ticket.className, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(EsokoRadius.pill),
                  ),
                  child: Text(ticket.status, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
                ),
              ],
            ),
          ),
          // Perforation — the tear-off line between stub head and body.
          _Perforation(color: accent),
          Container(
            color: Theme.of(context).cardColor,
            padding: const EdgeInsets.fromLTRB(EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s4),
            child: Column(
              children: [
                if (ticket.seatLabel != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: EsokoSpacing.s3),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.event_seat_outlined, size: 16, color: EsokoColors.text2),
                        const SizedBox(width: 6),
                        Text('Seat ${ticket.seatLabel}', style: TextStyle(color: EsokoColors.text2, fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                Semantics(
                  // A QR means nothing to a screen reader — expose the
                  // same check-in payload as labelled text instead.
                  label: valid
                      ? 'Ticket QR code for ${ticket.className}, code ${ticket.code}'
                      : 'Expired ticket for ${ticket.className}',
                  child: Container(
                    padding: const EdgeInsets.all(EsokoSpacing.s3),
                    decoration: BoxDecoration(
                      border: Border.all(color: EsokoColors.line),
                      borderRadius: BorderRadius.circular(EsokoRadius.md),
                    ),
                    child: valid
                        ? QrImageView(data: ticket.code, size: 148, backgroundColor: Colors.white)
                        : SizedBox(
                            width: 148,
                            height: 148,
                            child: Icon(Icons.block_flipped, size: 48, color: EsokoColors.line),
                          ),
                  ),
                ),
                const SizedBox(height: EsokoSpacing.s3),
                SelectableText(ticket.code, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700, letterSpacing: 1)),
                const SizedBox(height: EsokoSpacing.s1),
                EsokoAmountText(ticket.priceKes, fontSize: 14),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A row of small semicircular notches — the visual "tear here" line
/// between a ticket stub's header and its QR body.
class _Perforation extends StatelessWidget {
  const _Perforation({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 12,
      child: CustomPaint(
        painter: _PerforationPainter(bandColor: color, holeColor: Theme.of(context).scaffoldBackgroundColor),
        size: const Size(double.infinity, 12),
      ),
    );
  }
}

class _PerforationPainter extends CustomPainter {
  _PerforationPainter({required this.bandColor, required this.holeColor});
  final Color bandColor;
  final Color holeColor;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height / 2), Paint()..color = bandColor);
    const radius = 6.0;
    final count = (size.width / (radius * 3)).floor();
    final spacing = size.width / count;
    final holePaint = Paint()..color = holeColor;
    for (var i = 0; i <= count; i++) {
      canvas.drawCircle(Offset(i * spacing, 0), radius, holePaint);
    }
  }

  @override
  bool shouldRepaint(covariant _PerforationPainter oldDelegate) =>
      oldDelegate.bandColor != bandColor || oldDelegate.holeColor != holeColor;
}

