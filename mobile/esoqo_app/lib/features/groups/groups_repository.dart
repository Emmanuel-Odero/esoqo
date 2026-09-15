import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';
import 'group_models.dart';

/// The contributions feature slice of the Riverpod convention (see
/// ARCHITECTURE.md): screens watch tiny `FutureProvider`s, and those
/// providers delegate to this repository. Nothing in presentation
/// touches [ApiClient] or raw maps — parsing, endpoint reshapes and
/// (later) caching live here.
final groupsRepositoryProvider = Provider<GroupsRepository>((ref) {
  return GroupsRepository(ref.watch(apiClientProvider));
});

class GroupsRepository {
  GroupsRepository(this._api);

  final ApiClient _api;

  /// GET /v1/me/groups — chamas, table banking and welfare groups the
  /// signed-in person belongs to.
  Future<List<GroupSummary>> myGroups() async {
    final res = await _api.get('/v1/me/groups');
    final list = (res['groups'] as List?) ?? const [];
    return list
        .map((e) => GroupSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/groups/search?q= — name search for self-serve joining.
  Future<List<GroupSummary>> searchGroups(String q) async {
    final res = await _api.get(
      '/v1/groups/search?q=${Uri.encodeQueryComponent(q)}',
    );
    final list = (res['groups'] as List?) ?? const [];
    return list
        .map((e) => GroupSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/groups/:id — header + member roster with roles.
  Future<GroupDetail> group(String id) async {
    final res = await _api.get('/v1/groups/$id');
    return GroupDetail.fromJson(res);
  }

  /// GET /v1/groups/:id/balance — the collective pool in KES.
  Future<double> groupBalance(String id) async {
    final res = await _api.get('/v1/groups/$id/balance');
    return (res['balanceKes'] as num?)?.toDouble() ?? 0;
  }

  /// GET /v1/groups/:id/contributions — everyone's contributions, newest
  /// first by core-go's ordering.
  Future<List<ContributionRow>> contributions(String id) async {
    final res = await _api.get('/v1/groups/$id/contributions');
    final list = (res['contributions'] as List?) ?? const [];
    return list
        .map((e) => ContributionRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/groups/:id/withdrawals — withdrawal requests with their
  /// signature tallies and standby window.
  Future<List<WithdrawalRow>> withdrawals(String id) async {
    final res = await _api.get('/v1/groups/$id/withdrawals');
    final list = (res['withdrawals'] as List?) ?? const [];
    return list
        .map((e) => WithdrawalRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/withdrawals/:id — one full row incl. per-signer decisions.
  Future<WithdrawalRow> withdrawal(String id) async {
    final res = await _api.get('/v1/withdrawals/$id');
    return WithdrawalRow.fromJson(res);
  }

  /// GET /v1/groups/:id/timeline — plain-language, member-visible feed;
  /// 403s for a non-member (dbx.GroupTimeline requires active
  /// membership), same as every other write in this file already does.
  Future<List<TimelineEntry>> timeline(String id) async {
    final res = await _api.get('/v1/groups/$id/timeline');
    final list = (res['entries'] as List?) ?? const [];
    return list
        .map((e) => TimelineEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /v1/groups — founds a group with the signed-in person as
  /// CHAIRPERSON; returns the new group id.
  Future<String> createGroup({
    required String kind,
    required String officialName,
    required String county,
  }) async {
    final res = await _api.post('/v1/groups', {
      'orgKind': kind,
      'officialName': officialName,
      'county': county,
    });
    return res['groupId'] as String? ?? '';
  }

  /// POST /v1/groups/:id/join — self-serve membership request.
  Future<void> joinGroup(String id) => _api.post('/v1/groups/$id/join');

  /// POST /v1/groups/:id/contributions — M-Pesa STK (confirms
  /// immediately) or a cash claim an officer verifies later. Returns the
  /// contribution's status ('CONFIRMED' vs 'PENDING').
  Future<String> contribute({
    required String groupId,
    required double amountKes,
    required String method,
  }) async {
    final res = await _api.post('/v1/groups/$groupId/contributions', {
      'amountKes': amountKes,
      'method': method,
    });
    return res['status'] as String? ?? 'PENDING';
  }

  /// POST /v1/groups/:id/withdrawals — officer-only; broadcasts to every
  /// eligible signer with a standby window before it can execute.
  Future<void> requestWithdrawal({
    required String groupId,
    required double amountKes,
    required String purpose,
    required String payeeName,
    String? payeeMsisdn,
  }) async {
    await _api.post('/v1/groups/$groupId/withdrawals', {
      'amountKes': amountKes,
      'purpose': purpose,
      'payeeName': payeeName,
      if (payeeMsisdn != null && payeeMsisdn.isNotEmpty)
        'payeeMsisdn': payeeMsisdn,
    });
  }

  /// POST /v1/withdrawals/:id/sign — live PIN re-entry, never a client
  /// "already verified" flag (see SignWithdrawal on the Go side).
  Future<void> signWithdrawal({
    required String withdrawalId,
    required String decision,
    required String pin,
  }) {
    return _api.post('/v1/withdrawals/$withdrawalId/sign', {
      'decision': decision,
      'pin': pin,
    });
  }
}
