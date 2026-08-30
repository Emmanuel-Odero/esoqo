import 'package:dio/dio.dart';

import '../storage/token_store.dart';
import 'api_config.dart';
import 'api_exception.dart';

/// Thin wrapper around Dio for core-go's `/v1/*` REST surface.
///
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

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);

  Future<Map<String, dynamic>> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body);

  Future<Map<String, dynamic>> _send(String method, String path, [Map<String, dynamic>? body]) async {
    late final Response<dynamic> response;
    try {
      response = await _dio.request(path, data: body, options: Options(method: method));
    } on DioException catch (e) {
      throw ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: e.message ?? 'Could not reach Esoko. Check your connection.',
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
