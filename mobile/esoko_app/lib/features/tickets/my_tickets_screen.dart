import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'ticketing_models.dart';
import 'ticketing_repository.dart';

final myTicketsProvider = FutureProvider.autoDispose<List<TicketRow>>(
  (ref) => ref.watch(ticketingRepositoryProvider).myTickets(),
);

/// GET /v1/me/bookings — every booking ever placed, used here only for
/// its open installment plans (a plan has no tickets to show in
/// myTicketsProvider until its balance clears — see MyBookingRich's own
/// doc comment).
final myBookingsProvider = FutureProvider.autoDispose<List<MyBookingRich>>(
  (ref) => ref.watch(ticketingRepositoryProvider).myBookings(),
);

/// GET /v1/me/tickets (authenticated) — every ticket ever issued to this
/// signed-in person, styled as a tear-off stub and QR-coded by its
/// `code` (the same string a gate scanner's check-in flow reads — see
/// Ticket.code in schema.prisma). Payment plans still being paid off
/// (lipa pole pole) show above the tickets, since they're not tickets
/// yet — nothing is issued until the balance clears.
///
/// Bar-less and scaffold-less on purpose: this is one segment of
/// [ListingListScreen]'s Browse/Your tickets toggle, not a screen of
/// its own — see SCREEN_CONVENTIONS.md Rule 1 on a wrapped body never
/// building its own app bar.
class YourTicketsBody extends ConsumerWidget {
  const YourTicketsBody({super.key});

  void _refreshAll(WidgetRef ref) {
    ref.invalidate(myTicketsProvider);
    ref.invalidate(myBookingsProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(myTicketsProvider);
    return RefreshIndicator(
      onRefresh: () async => _refreshAll(ref),
      child: EsokoAsyncView(
        value: tickets,
        isEmpty: (list) => list.isEmpty,
        emptyMessage: 'No tickets yet.',
        emptyIcon: Icons.confirmation_num_outlined,
        onRetry: () => ref.invalidate(myTicketsProvider),
        data: (context, list) => Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 840),
            child: ListView(
              padding: const EdgeInsets.all(EsokoSpacing.s4),
              children: [
                _PaymentPlansSection(onChanged: () => _refreshAll(ref)),
                for (var i = 0; i < list.length; i++) ...[
                  if (i > 0) const SizedBox(height: EsokoSpacing.s5),
                  EsokoStagger(index: i, child: _TicketStub(ticket: list[i])),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Renders nothing at all when there are no open plans — this section
/// exists for the minority of people mid-instalment, not as a permanent
/// fixture everyone scrolls past.
class _PaymentPlansSection extends ConsumerWidget {
  const _PaymentPlansSection({required this.onChanged});
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bookings = ref.watch(myBookingsProvider);
    final openPlans = bookings.valueOrNull?.where((b) => b.isOpenPlan).toList();
    if (openPlans == null || openPlans.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const EsokoSubHeader('Payment plans'),
          const SizedBox(height: EsokoSpacing.s2),
          for (var i = 0; i < openPlans.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: EsokoSpacing.s3),
              child: EsokoStagger(
                index: i,
                child: _InstallmentPlanCard(
                  booking: openPlans[i],
                  onChanged: onChanged,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// "Lipa pole pole" in progress — the same progress-bar-plus-fraction
/// treatment group_detail_screen.dart already uses for withdrawal
/// signature quorum, applied here to KES paid vs owed instead of
/// signers vs threshold. Same underlying idea either way: a target
/// being filled in, not a status word alone.
class _InstallmentPlanCard extends ConsumerStatefulWidget {
  const _InstallmentPlanCard({required this.booking, required this.onChanged});
  final MyBookingRich booking;
  final VoidCallback onChanged;

  @override
  ConsumerState<_InstallmentPlanCard> createState() => _InstallmentPlanCardState();
}

class _InstallmentPlanCardState extends ConsumerState<_InstallmentPlanCard> {
  bool _busy = false;
  String? _notice;

  Future<void> _payBalance() async {
    final amount = await showAmountDialog(context, title: 'Pay towards balance');
    if (amount == null) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      final placed = await ref
          .read(ticketingRepositoryProvider)
          .payInstallmentBalance(bookingId: widget.booking.id, amountKes: amount);
      if (placed.paymentError != null) {
        setState(() => _notice = placed.paymentError);
      } else {
        setState(
          () => _notice = placed.status == 'PAID'
              ? 'Paid in full — your ticket is ready.'
              : 'Payment recorded.',
        );
        widget.onChanged();
      }
    } on ApiException catch (e) {
      setState(() => _notice = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;
    final scheme = Theme.of(context).colorScheme;
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final balance = b.totalKesValue - b.paidKesValue;
    return EsokoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(b.listingTitle, style: Theme.of(context).textTheme.titleMedium),
          Text(b.where, style: TextStyle(color: muted, fontSize: 12.5)),
          const SizedBox(height: EsokoSpacing.s3),
          ClipRRect(
            borderRadius: BorderRadius.circular(EsokoRadius.pill),
            child: LinearProgressIndicator(
              value: b.progress,
              minHeight: 8,
              backgroundColor: EsokoColors.line,
              valueColor: AlwaysStoppedAnimation(scheme.primary),
            ),
          ),
          const SizedBox(height: EsokoSpacing.s2),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'KES ${b.amountPaidKes} of ${b.totalKes} paid',
                style: TextStyle(fontSize: 12.5, color: muted, fontWeight: FontWeight.w600),
              ),
              Text(
                'KES ${balance.toStringAsFixed(0)} left',
                style: TextStyle(fontSize: 12.5, color: scheme.primary, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          if (b.balanceDueBy != null) ...[
            const SizedBox(height: 4),
            Text(
              'Due by ${b.balanceDueBy}',
              style: TextStyle(fontSize: 11.5, color: muted),
            ),
          ],
          const SizedBox(height: EsokoSpacing.s3),
          EsokoButton.primary(
            expand: false,
            label: 'Pay towards balance',
            loading: _busy,
            onPressed: _payBalance,
          ),
          if (_notice != null) ...[
            const SizedBox(height: EsokoSpacing.s2),
            Text(_notice!, style: TextStyle(fontSize: 12.5, color: muted)),
          ],
        ],
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
    // EsokoColors.text — not .text3, which is a medium-lightness grey
    // that gave the white stub-head text (below) under 2.2:1 contrast
    // once a ticket expired, in *both* themes (this band is deliberately
    // always dark, like a real boarding-pass stub, so the fix isn't
    // brightness-conditional — .text3 was just too light a colour for a
    // white-on-top background to begin with).
    final accent = valid ? EsokoColors.navy : EsokoColors.text;

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
                Icon(
                  Icons.confirmation_num_rounded,
                  color: Colors.white.withValues(alpha: 0.85),
                  size: 20,
                ),
                const SizedBox(width: EsokoSpacing.s2),
                Expanded(
                  child: Text(
                    ticket.className,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(EsokoRadius.pill),
                  ),
                  child: Text(
                    ticket.status,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Perforation — the tear-off line between stub head and body.
          _Perforation(color: accent),
          Container(
            color: Theme.of(context).cardColor,
            padding: const EdgeInsets.fromLTRB(
              EsokoSpacing.s5,
              EsokoSpacing.s5,
              EsokoSpacing.s5,
              EsokoSpacing.s4,
            ),
            child: Column(
              children: [
                if (ticket.seatLabel != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: EsokoSpacing.s3),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.event_seat_outlined,
                          size: 16,
                          color: Theme.of(context).textTheme.bodySmall?.color,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          'Seat ${ticket.seatLabel}',
                          style: TextStyle(
                            color: Theme.of(context).textTheme.bodySmall?.color,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
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
                        ? QrImageView(
                            data: ticket.code,
                            size: 148,
                            backgroundColor: Colors.white,
                          )
                        : SizedBox(
                            width: 148,
                            height: 148,
                            child: Icon(
                              Icons.block_flipped,
                              size: 48,
                              color: EsokoColors.line,
                            ),
                          ),
                  ),
                ),
                const SizedBox(height: EsokoSpacing.s3),
                SelectableText(
                  ticket.code,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1,
                  ),
                ),
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
        painter: _PerforationPainter(
          bandColor: color,
          holeColor: Theme.of(context).scaffoldBackgroundColor,
        ),
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
    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, size.height / 2),
      Paint()..color = bandColor,
    );
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
