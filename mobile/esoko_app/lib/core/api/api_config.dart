import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:network_info_plus/network_info_plus.dart';

/// Resolves core-go's base URL. Override at build/run time with
/// `--dart-define=API_BASE_URL=http://<host>:4100` — recommended whenever
/// core-go isn't on the default dev port, and required when no candidate
/// below can reach it (e.g. both devices on a router where the machine
/// running the server isn't the gateway).
///
/// Defaults assume `services/core-go` running locally per its own
/// README (`go run ./cmd/api`, or `docker compose up -d core-go`, both
/// exposing :4100 on all interfaces — core-go binds `:4100`, so any
/// device that can route to the host can reach it):
///   - Web / iOS Simulator / macOS: localhost reaches the host directly.
///   - Android emulator: 10.0.2.2 is the documented alias for the host
///     loopback interface — localhost inside the emulator means the
///     emulator itself.
///   - Physical iPhone: localhost means the iPhone itself. [candidateHosts]
///     computes the hosts most likely to be the dev machine and the app
///     probes each one until core-go answers (see ApiClient):
///       · the Wi-Fi gateway — the Mac, when the Mac hosts the hotspot;
///       · gateway +1/+2 — the Mac, when the Mac is a client of the
///         iPhone's hotspot and gets the first DHCP addresses.
abstract final class ApiConfig {
  static const _override = String.fromEnvironment('API_BASE_URL');

  /// core-go's default port (see services/core-go/internal/config).
  static const int port = 4100;

  /// Raw `--dart-define=API_BASE_URL=...` value, or empty. When set it is
  /// an explicit instruction and is used verbatim (no probing).
  static const String overrideUrl = _override;

  static Uri _uri(String host) => Uri(scheme: 'http', host: host, port: port);

  /// True on the iOS simulator, where localhost reaches the host Mac and
  /// the gateway is the real router — never the Mac. Detected via the
  /// `SIMULATOR_*` environment variables Xcode injects into simulator
  /// processes (absent on physical devices).
  static bool get _isIosSimulator =>
      Platform.isIOS && Platform.environment.containsKey('SIMULATOR_DEVICE_NAME');

  /// Synchronous fallback per platform — good for anything that isn't a
  /// physical iPhone on a shared network. ApiClient swaps in the probed
  /// host from [candidateHosts] before the first real request.
  static String get baseUrl {
    if (_override.isNotEmpty) return _override;
    if (kIsWeb) return _uri('localhost').toString();
    if (Platform.isAndroid) return _uri('10.0.2.2').toString();
    return _uri('localhost').toString();
  }

  /// Hosts to try, best first. ApiClient probes each on [port] and uses
  /// the first that answers; the last entry is always a platform default
  /// so the resolved URL still points somewhere sane if nothing answers.
  /// The [overrideUrl], when set, is an explicit instruction handled
  /// separately — it is never probed.
  static Future<List<String>> candidateHosts() async {
    if (kIsWeb) return const ['localhost'];
    if (Platform.isAndroid) return const ['10.0.2.2'];
    if (Platform.isIOS && !_isIosSimulator) {
      final hosts = <String>[];
      try {
        final gateway = await NetworkInfo().getWifiGatewayIP();
        if (gateway != null && gateway.isNotEmpty) {
          hosts.add(gateway);
          // gateway +1 and +2: when this iPhone is the hotspot, the
          // first DHCP client (usually the Mac running core-go) gets
          // the address just after the gateway, e.g. 172.20.10.2.
          hosts.addAll(
            [1, 2].map((n) => _bumpLastOctet(gateway, n)).whereType<String>(),
          );
        }
      } catch (_) {
        // Fall through to the platform default; the probe will surface a
        // clear NETWORK_ERROR if the chosen host was genuinely wrong.
      }
      hosts.add('localhost');
      return hosts;
    }
    return const ['localhost'];
  }

  /// Returns `octet address + delta` if that stays inside a valid host
  /// range (1–254), else null — avoids probing broadcast (.255) or
  /// network (.0) addresses.
  static String? _bumpLastOctet(String host, int delta) {
    final dot = host.lastIndexOf('.');
    if (dot <= 0) return null;
    final last = int.tryParse(host.substring(dot + 1));
    if (last == null || last <= 0 || last >= 255) return null;
    final bumped = last + delta;
    if (bumped < 1 || bumped > 254) return null;
    return '${host.substring(0, dot)}.$bumped';
  }
}