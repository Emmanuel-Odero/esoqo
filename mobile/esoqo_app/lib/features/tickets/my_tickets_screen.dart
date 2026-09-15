import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoqo_tokens.dart';
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
      child: EsoqoAsyncView(
        value: tickets,
        isEmpty: (list) => list.isEmpty,
        emptyMessage: 'No tickets yet.',
        emptyIcon: Icons.confirmation_num_outlined,
        onRetry: () => ref.invalidate(myTicketsProvider),
        data: (context, list) => Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 840),
            child: ListView(
              padding: const EdgeInsets.all(EsoqoSpacing.s4),
              children: [
                const _TodaysJourneySection(),
                _PaymentPlansSection(onChanged: () => _refreshAll(ref)),
                for (var i = 0; i < list.length; i++) ...[
                  if (i > 0) const SizedBox(height: EsoqoSpacing.s5),
                  EsoqoStagger(index: i, child: _TicketStub(ticket: list[i])),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A paid, boarded-or-boarding transport booking departing today —
/// the one thing worth surfacing above everything else you've ever
/// bought a ticket for. No new endpoint: [MyBookingRich.departAt]
/// already comes back on every row of [myBookingsProvider], which
/// this segment was already fetching for the payment-plans section
/// below; this just reads the field nobody had used yet.
///
/// Renders nothing outside a travel day, same "nothing until it's
/// real" rule as [_PaymentPlansSection] — a permanent empty journey
/// card would be noise for the far more common event ticket.
class _TodaysJourneySection extends ConsumerWidget {
  const _TodaysJourneySection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bookings = ref.watch(myBookingsProvider).valueOrNull;
    if (bookings == null) return const SizedBox.shrink();

    final now = DateTime.now();
    final today = bookings.where((b) {
      if (b.status != 'PAID' || b.routeFrom == null || b.routeTo == null) {
        return false;
      }
      final depart = DateTime.tryParse(b.departAt)?.toLocal();
      return depart != null &&
          depart.year == now.year &&
          depart.month == now.month &&
          depart.day == now.day;
    }).toList()
      ..sort((a, b) => a.departAt.compareTo(b.departAt));
    if (today.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: EsoqoSpacing.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const EsoqoSubHeader("Today's journey"),
          const SizedBox(height: EsoqoSpacing.s2),
          for (var i = 0; i < today.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: EsoqoSpacing.s3),
              child: EsoqoAttentionCard(
                when: _departureWhen(today[i].departAt, now),
                title: '${today[i].routeFrom} → ${today[i].routeTo}',
                detail: today[i].orgName,
                accent: EsoqoColors.green,
              ),
            ),
        ],
      ),
    );
  }
}

/// "Boarding now" inside 30 minutes of departure, otherwise the clock
/// time — a countdown is useful right before a bus leaves and noise
/// every other time this screen is opened today.
String _departureWhen(String departAt, DateTime now) {
  final depart = DateTime.tryParse(departAt)?.toLocal();
  if (depart == null) return 'Today';
  final until = depart.difference(now);
  if (until.inMinutes <= 30 && until.inMinutes >= -15) return 'Boarding now';
  if (until.isNegative) return 'Departed';
  final hh = depart.hour.toString().padLeft(2, '0');
  final mm = depart.minute.toString().padLeft(2, '0');
  return 'Departs $hh:$mm';
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
      padding: const EdgeInsets.only(bottom: EsoqoSpacing.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const EsoqoSubHeader('Payment plans'),
          const SizedBox(height: EsoqoSpacing.s2),
          for (var i = 0; i < openPlans.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: EsoqoSpacing.s3),
              child: EsoqoStagger(
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
    return EsoqoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(b.listingTitle, style: Theme.of(context).textTheme.titleMedium),
          Text(b.where, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: EsoqoSpacing.s3),
          ClipRRect(
            borderRadius: BorderRadius.circular(EsoqoRadius.pill),
            child: LinearProgressIndicator(
              value: b.progress,
              minHeight: 8,
              backgroundColor: EsoqoColors.line,
              valueColor: AlwaysStoppedAnimation(scheme.primary),
            ),
          ),
          const SizedBox(height: EsoqoSpacing.s2),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'KES ${b.amountPaidKes} of ${b.totalKes} paid',
                style: TextStyle(fontSize: EsoqoTypeScale.meta, color: muted, fontWeight: FontWeight.w600),
              ),
              Text(
                'KES ${balance.toStringAsFixed(0)} left',
                style: TextStyle(fontSize: EsoqoTypeScale.meta, color: scheme.primary, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          if (b.balanceDueBy != null) ...[
            const SizedBox(height: 4),
            Text(
              'Due by ${b.balanceDueBy}',
              style: TextStyle(fontSize: EsoqoTypeScale.micro, color: muted),
            ),
          ],
          const SizedBox(height: EsoqoSpacing.s3),
          EsoqoButton.primary(
            expand: false,
            label: 'Pay towards balance',
            loading: _busy,
            onPressed: _payBalance,
          ),
          if (_notice != null) ...[
            const SizedBox(height: EsoqoSpacing.s2),
            Text(_notice!, style: Theme.of(context).textTheme.bodySmall),
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
    // EsoqoColors.text — not .text3, which is a medium-lightness grey
    // that gave the white stub-head text (below) under 2.2:1 contrast
    // once a ticket expired, in *both* themes (this band is deliberately
    // always dark, like a real boarding-pass stub, so the fix isn't
    // brightness-conditional — .text3 was just too light a colour for a
    // white-on-top background to begin with).
    final accent = valid ? EsoqoColors.navy : EsoqoColors.text;

    return Material(
      elevation: 2,
      shadowColor: Colors.black.withValues(alpha: 0.15),
      borderRadius: BorderRadius.circular(EsoqoRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          // Stub head — ticket-class + status, on a navy band like a
          // real boarding pass/admission ticket.
          Container(
            padding: const EdgeInsets.all(EsoqoSpacing.s4),
            color: accent,
            child: Row(
              children: [
                Icon(
                  Icons.confirmation_num_rounded,
                  color: Colors.white.withValues(alpha: 0.85),
                  size: 20,
                ),
                const SizedBox(width: EsoqoSpacing.s2),
                Expanded(
                  child: Text(
                    ticket.className,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: EsoqoTypeScale.subTitle,
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
                    borderRadius: BorderRadius.circular(EsoqoRadius.pill),
                  ),
                  child: Text(
                    ticket.status,
                    style: EsoqoTypography.eyebrow(color: Colors.white),
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
              EsoqoSpacing.s5,
              EsoqoSpacing.s5,
              EsoqoSpacing.s5,
              EsoqoSpacing.s4,
            ),
            child: Column(
              children: [
                if (ticket.seatLabel != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: EsoqoSpacing.s3),
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
                    padding: const EdgeInsets.all(EsoqoSpacing.s3),
                    decoration: BoxDecoration(
                      border: Border.all(color: EsoqoColors.line),
                      borderRadius: BorderRadius.circular(EsoqoRadius.md),
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
                              color: EsoqoColors.line,
                            ),
                          ),
                  ),
                ),
                const SizedBox(height: EsoqoSpacing.s3),
                SelectableText(
                  ticket.code,
                  style: EsoqoTypography.code(),
                ),
                const SizedBox(height: EsoqoSpacing.s1),
                EsoqoAmountText(ticket.priceKes, fontSize: EsoqoTypeScale.label),
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
