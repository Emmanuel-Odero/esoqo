/// Mirrors core-go's error envelope — {"error":{"code":"...","message":"..."}}
/// (see services/core-go/internal/httpapi's writeError) — so callers can
/// branch on `code` the same way the web apps branch on OtpError.code /
/// SetPinError.code etc.
class ApiException implements Exception {
  const ApiException({required this.statusCode, required this.code, required this.message});

  final int statusCode;
  final String code;
  final String message;

  bool get isNetworkError => statusCode == 0;

  @override
  String toString() => 'ApiException($statusCode, $code, $message)';
}
