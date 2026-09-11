import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';

/// One history item — a store order or a ticket booking, whichever
/// GET /v1/me/history's Kind says (see dbx.HistoryItem).
class HistoryItem {
  HistoryItem({
    required this.kind,
    required this.id,
    required this.title,
    required this.status,
    required this.totalKes,
    required this.occurredAt,
  });

  factory HistoryItem.fromJson(Map<String, dynamic> json) => HistoryItem(
    kind: json['kind'] as String,
    id: json['id'] as String,
    title: json['title'] as String,
    status: json['status'] as String,
    totalKes: json['totalKes'] as String,
    occurredAt:
        DateTime.tryParse(json['occurredAt'] as String? ?? '') ??
        DateTime.now(),
  );

  final String kind;
  final String id;
  final String title;
  final String status;
  final String totalKes;
  final DateTime occurredAt;
}

/// The Settings tab's data slice of the Riverpod convention — history
/// and loyalty-point fetches live here, away from the screen.
final profileRepositoryProvider = Provider<ProfileRepository>((ref) {
  return ProfileRepository(ref.watch(apiClientProvider));
});

class ProfileRepository {
  ProfileRepository(this._api);

  final ApiClient _api;

  /// GET /v1/me/history — store orders and ticket bookings mixed.
  Future<List<HistoryItem>> myHistory() async {
    final res = await _api.get('/v1/me/history');
    final items = (res['items'] as List?) ?? const [];
    return items
        .map((e) => HistoryItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/me/points — loyalty points across shops and tickets.
  Future<int> myPoints() async {
    final res = await _api.get('/v1/me/points');
    return res['totalPoints'] as int? ?? 0;
  }
}
