import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'ticketing_models.dart';

final myTicketsProvider = FutureProvider.autoDispose<List<TicketRow>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/me/tickets');
  final list = (res['tickets'] as List?) ?? const [];
  return list.map((e) => TicketRow.fromJson(e as Map<String, dynamic>)).toList();
});

/// GET /v1/me/tickets (authenticated) — every ticket ever issued to this
/// signed-in person, QR-coded by its `code` (the same string a gate
/// scanner's check-in flow reads — see Ticket.code in schema.prisma).
class MyTicketsScreen extends ConsumerWidget {
  const MyTicketsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(myTicketsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My tickets')),
      body: tickets.when(
        data: (list) => list.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(EsokoSpacing.s8),
                  child: Text('No tickets yet.', style: TextStyle(color: EsokoColors.text2)),
                ),
              )
            : ListView.separated(
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                itemCount: list.length,
                separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s3),
                itemBuilder: (context, i) => _TicketCard(ticket: list[i]),
              ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load your tickets.', style: TextStyle(color: EsokoColors.red))),
      ),
    );
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.ticket});
  final TicketRow ticket;

  @override
  Widget build(BuildContext context) {
    final valid = ticket.status == 'VALID';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(EsokoSpacing.s5),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(ticket.className, style: Theme.of(context).textTheme.titleMedium),
                      if (ticket.seatLabel != null) Text('Seat ${ticket.seatLabel}', style: TextStyle(color: EsokoColors.text2)),
                      Text('KES ${ticket.priceKes}', style: TextStyle(color: EsokoColors.green)),
                    ],
                  ),
                ),
                Chip(
                  label: Text(ticket.status),
                  backgroundColor: valid ? EsokoColors.greenTint : EsokoColors.line,
                  labelStyle: TextStyle(color: valid ? EsokoColors.green : EsokoColors.text3, fontSize: 11),
                ),
              ],
            ),
            const SizedBox(height: EsokoSpacing.s4),
            if (valid)
              QrImageView(data: ticket.code, size: 160, backgroundColor: Colors.white)
            else
              Icon(Icons.qr_code_2, size: 160, color: EsokoColors.line),
            const SizedBox(height: EsokoSpacing.s2),
            SelectableText(ticket.code, style: const TextStyle(fontFamily: 'monospace')),
          ],
        ),
      ),
    );
  }
}
