import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show debugPrint;

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
      handler.next(options);
    }));
  }

  late final Dio _dio;
  final void Function()? _onUnauthorized;
  Future<void>? _baseUrlInit;
  List<String> _hostsTried = const [];

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
    final hosts = await ApiConfig.candidateHosts();
    _hostsTried = hosts;
    debugPrint('esoko/api: core-go candidates: ${hosts.join(', ')}');
    for (final host in hosts) {
      final base = 'http://$host:${ApiConfig.port}';
      final ok = await _probe(base);
      debugPrint('esoko/api: $base -> ${ok ? 'ALIVE' : 'no core-go'}');
      if (ok) {
        _dio.options.baseUrl = base;
        debugPrint('esoko/api: resolved base URL = $base');
        return;
      }
    }
    // Nothing answered — keep the first candidate so the request below
    // fails fast, and let the real error say which hosts were tried.
    _dio.options.baseUrl = 'http://${hosts.first}:${ApiConfig.port}';
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

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);

  Future<Map<String, dynamic>> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body);

  Future<Map<String, dynamic>> patch(String path, [Map<String, dynamic>? body]) =>
      _send('PATCH', path, body);

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
            ? '${e.message} Tried: ${_hostsTried.join(', ')}.'
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
