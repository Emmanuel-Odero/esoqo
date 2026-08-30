import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;

/// Resolves core-go's base URL. Override at build/run time with
/// `--dart-define=API_BASE_URL=http://<host>:4100` — required for a
/// physical device (localhost means the device itself, not your Mac) and
/// recommended whenever core-go isn't on the default dev port.
///
/// Defaults assume `services/core-go` running locally per its own
/// README (`go run ./cmd/api`, or `docker compose up -d core-go`, both
/// exposing :4100 on the host):
///   - Web / iOS Simulator / macOS: localhost reaches the host directly.
///   - Android emulator: 10.0.2.2 is the documented alias for the host
///     loopback interface — localhost inside the emulator means the
///     emulator itself.
abstract final class ApiConfig {
  static const _override = String.fromEnvironment('API_BASE_URL');

  static String get baseUrl {
    if (_override.isNotEmpty) return _override;
    if (kIsWeb) return 'http://localhost:4100';
    if (Platform.isAndroid) return 'http://10.0.2.2:4100';
    return 'http://localhost:4100';
  }
}
