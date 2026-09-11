import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../storage/token_store.dart';
import 'api_config.dart';
import 'api_exception.dart';

/// Thin wrapper around Dio for core-go's `/v1/*` REST surface.
///
/// - Resolves the base URL lazily via [ApiConfig.candidateHosts] — on a
///   physical iPhone the machine running core-go depends on the network
///   the device is on (which hotspot direction, LAN, etc.), so the app
///   probes each candidate on GET /health and keeps the first that
///   answers. An explicit `--dart-define=API_BASE_URL` is used verbatim.
///   The winning host is cached (see [_cachedHost]/[_cacheHost]) and
///   tried alone on the next cold start before falling back to a full
///   re-probe — candidateHosts() can run to a couple hundred entries on
///   a plain /24 LAN, and firing that many concurrent connections on
///   every launch is real load on the WiFi radio right as the first
///   real request also needs to go out, which was itself producing
///   spurious connectionTimeout failures on otherwise-fine requests.
/// - Attaches `Authorization: Bearer <token>` from [TokenStore] on every
///   request that has one.
/// - On a 401, clears the stored token and calls [onUnauthorized] so the
///   app can react (drop to the sign-in screen) — same trigger the web
///   apps get implicitly from an expired/missing session cookie, made
///   explicit here since there's no browser to redirect for us.
/// - Normalises every non-2xx response and network failure into an
///   [ApiException], so callers never touch DioException directly.
class ApiClient {
  ApiClient({this._onUnauthorized}) {
    _dio = Dio(BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
      validateStatus: (_) => true, // handle status codes ourselves, below
    ));
    _dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) async {
      final token = await TokenStore.instance.read();
      if (token != null) options.headers['Authorization'] = 'Bearer $token';
      // A SUBJECT that has switched on org-staff duty (see
      // core/auth/org_context_state.dart) sends which org it means —
      // this is a convenience label, never a credential: core-go
      // re-checks the live activation + grant status on every request
      // regardless of what this header says.
      final orgContextRaw = await TokenStore.instance.readOrgContext();
      if (orgContextRaw != null) {
        try {
          final orgId = (jsonDecode(orgContextRaw) as Map<String, dynamic>)['orgId'] as String?;
          if (orgId != null) options.headers['X-Esoko-Org-Context'] = orgId;
        } catch (_) {
          // Malformed cache — ignore, just send the request without it.
        }
      }
      handler.next(options);
    }));
  }

  late final Dio _dio;
  final void Function()? _onUnauthorized;
  Future<void>? _baseUrlInit;
  List<String> _hostsTried = const [];

  static const _cachedHostKey = 'esoko_api_base_url';
  static const _hostCacheStorage = FlutterSecureStorage();

  /// Resolves the real base URL once, before the first request. Dio's
  /// `baseUrl` set in the constructor is only a placeholder until then.
  Future<void> _ensureBaseUrl() {
    return _baseUrlInit ??= _resolveBaseUrl();
  }

  Future<void> _resolveBaseUrl() async {
    if (ApiConfig.overrideUrl.isNotEmpty) {
      _dio.options.baseUrl = ApiConfig.overrideUrl;
      _hostsTried = [ApiConfig.overrideUrl];
      debugPrint('esoko/api: using --dart-define API_BASE_URL=${ApiConfig.overrideUrl}');
      return;
    }

    // Try last session's winner alone first — same host, same network,
    // most of the time (nobody switches WiFi between app launches most
    // days). One quick probe beats firing the whole candidate list.
    final cached = await _hostCacheStorage.read(key: _cachedHostKey);
    if (cached != null && await _probe(cached)) {
      _dio.options.baseUrl = cached;
      _hostsTried = [cached];
      debugPrint('esoko/api: reusing cached base URL = $cached');
      return;
    }

    final hosts = await ApiConfig.candidateHosts();
    _hostsTried = hosts;
    debugPrint('esoko/api: core-go candidates: ${hosts.join(', ')}');
    // Probed concurrently — take whichever answers first, rather than
    // walking the list one host at a time with a timeout each. This
    // list is deliberately bounded (see ApiConfig.candidateHosts); only
    // when *none* of it answers do we pay for the full /24 sweep below.
    var winner = await _firstAlive(hosts);
    if (winner == null) {
      final extended = await ApiConfig.extendedCandidateHosts();
      if (extended.isNotEmpty) {
        _hostsTried = [...hosts, ...extended];
        debugPrint('esoko/api: quick pass found nothing, sweeping ${extended.length} more');
        winner = await _firstAlive(extended);
      }
    }
    if (winner != null) {
      _dio.options.baseUrl = winner;
      debugPrint('esoko/api: resolved base URL = $winner');
      unawaited(_hostCacheStorage.write(key: _cachedHostKey, value: winner));
      return;
    }
    // Nothing answered — keep the first candidate so the request below
    // fails fast, and let the real error say which hosts were tried.
    _dio.options.baseUrl = 'http://${hosts.first}:${ApiConfig.port}';
  }

  /// Probes every host in [hosts] in parallel and resolves to the base URL
  /// of the first one that answers, or `null` if none do. Unlike
  /// `Future.any`, a losing (unreachable) probe doesn't end the race —
  /// only a successful one does, or the pool running dry.
  Future<String?> _firstAlive(List<String> hosts) {
    if (hosts.isEmpty) return Future.value(null);
    final completer = Completer<String?>();
    var remaining = hosts.length;
    for (final host in hosts) {
      final base = 'http://$host:${ApiConfig.port}';
      unawaited(_probe(base).then((ok) {
        if (completer.isCompleted) return;
        debugPrint('esoko/api: $base -> ${ok ? 'ALIVE' : 'no core-go'}');
        if (ok) {
          completer.complete(base);
        } else if (--remaining == 0) {
          completer.complete(null);
        }
      }));
    }
    return completer.future;
  }

  /// True when `GET /health` on [base] gets *any* HTTP response — the
  /// server is alive even if it reports not-ready. Only network-level
  /// failures (refused / unreachable / timeout) mark a candidate dead.
  Future<bool> _probe(String base) async {
    final previous = _dio.options.baseUrl;
    _dio.options.baseUrl = base;
    try {
      await _dio.get('/health', options: Options(
        connectTimeout: const Duration(milliseconds: 1500),
        receiveTimeout: const Duration(milliseconds: 2000),
      ));
      return true;
    } on DioException {
      return false;
    } finally {
      _dio.options.baseUrl = previous;
    }
  }

  /// A user-facing rendering of [_hostsTried] — the full list can now
  /// run to a couple hundred entries (a whole /24 sweep, see
  /// ApiConfig._physicalIosCandidates), which used to get dumped
  /// verbatim into the NETWORK_ERROR message and blow out any layout
  /// that rendered it (EsokoErrorView included). Callers still get the
  /// count for debugging; only the first few hosts are spelled out.
  String get _triedSummary {
    const shown = 4;
    if (_hostsTried.length <= shown) return _hostsTried.join(', ');
    final head = _hostsTried.take(shown).join(', ');
    return '$head, and ${_hostsTried.length - shown} more';
  }

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);

  Future<Map<String, dynamic>> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body);

  Future<Map<String, dynamic>> patch(String path, [Map<String, dynamic>? body]) =>
      _send('PATCH', path, body);

  Future<Map<String, dynamic>> delete(String path) => _send('DELETE', path);

  Future<Map<String, dynamic>> _send(String method, String path, [Map<String, dynamic>? body]) async {
    await _ensureBaseUrl();
    late final Response<dynamic> response;
    try {
      response = await _dio.request(path, data: body, options: Options(method: method));
    } on DioException catch (e) {
      throw ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: e.message != null
            ? '${e.message} Tried $_triedSummary.'
            : 'Could not reach Esoko. Check your connection.',
      );
    }

    final data = response.data;
    final json = data is Map<String, dynamic> ? data : <String, dynamic>{};

    if (response.statusCode == 401) {
      await TokenStore.instance.clear();
      _onUnauthorized?.call();
    }

    if ((response.statusCode ?? 0) >= 400) {
      final error = json['error'] as Map<String, dynamic>?;
      throw ApiException(
        statusCode: response.statusCode ?? 0,
        code: error?['code'] as String? ?? 'UNKNOWN',
        message: error?['message'] as String? ?? 'Something went wrong',
      );
    }

    return json;
  }
}
