import 'dart:io' show Platform, NetworkInterface, InternetAddressType;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:network_info_plus/network_info_plus.dart';

/// Resolves core-go's base URL. Override at build/run time with
/// `--dart-define=API_BASE_URL=http://<host>:4100` — recommended whenever
/// core-go isn't on the default dev port, and required when no candidate
/// below can reach it (e.g. both devices on a router where the machine
/// running the server isn't on the device's own subnet).
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
///     computes the hosts most likely to be the dev machine from the
///     Wi-Fi gateway *and* the device's own interface addresses, and the
///     app probes each one until core-go answers (see ApiClient):
///       · the Wi-Fi gateway — the Mac, when the Mac hosts the hotspot;
///       · the whole 172.20.10.0/28 block — the subnet iOS personal
///         hotspots (and macOS Internet Sharing) use. When the Mac joined
///         *this* iPhone's hotspot it is somewhere in .2–.14 (the Mac's
///         DHCP lease here was 172.20.10.13), which no single-host guess
///         covers — so the app probes all 13 others of the block;
///       · each other interface's .1/.2/.3 as a scratch /24 guess.
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
    if (Platform.isIOS && !_isIosSimulator) return _physicalIosCandidates();
    return const ['localhost'];
  }

  static Future<List<String>> _physicalIosCandidates() async {
    final hosts = <String>[];
    void add(String host) {
      if (host.isNotEmpty && !hosts.contains(host)) hosts.add(host);
    }

    // 1. The Wi-Fi gateway == the Mac when the Mac hosts the hotspot, or
    //    the router when both are on the same LAN.
    try {
      final gateway = await NetworkInfo().getWifiGatewayIP();
      if (gateway != null && gateway.isNotEmpty) {
        add(gateway);
        if (_isHotspotSubnet(gateway)) _addHotspotNeighbors(gateway, add);
      }
    } catch (_) {
      // Some networks report no gateway (or iOS denies the read when
      // local-network access is off) — keep going; the own-interface
      // guesses below still cover the common setups.
    }

    // 2. Every local IPv4 the device has. The iOS personal-hotspot subnet
    //    is 172.20.10.0/28 — the iPhone serves it when it *is* the hotspot
    //    (its own address on the hotspot interface is 172.20.10.1), so the
    //    Mac that joined it is somewhere in .2–.14 even when DHCP lands it
    //    well away from .2. Outside that subnet, guess the classic /24
    //    .1/.2/.3.
    try {
      final interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4);
      for (final iface in interfaces) {
        for (final addr in iface.addresses) {
          if (addr.isLoopback) continue;
          final ip = addr.address;
          if (_isHotspotSubnet(ip)) {
            _addHotspotNeighbors(ip, add);
          } else {
            for (final delta in [1, 2, 3]) {
              final candidate = _rewriteLastOctet(ip, delta);
              if (candidate != null) add(candidate);
            }
          }
        }
      }
    } catch (_) {
      // Fall through; hosts may still contain the gateway from step 1.
    }

    add('10.0.2.2'); // Android-emulator alias, harmless on iOS (refused)
    add('localhost');
    return hosts;
  }

  /// 172.20.10.0/28 — the one subnet iOS personal hotspots (and macOS
  /// Internet Sharing hosting a hotspot) both use, so the full 16-address
  /// block can be probed from [neighbor] without knowing the netmask.
  static bool _isHotspotSubnet(String ip) => ip.startsWith('172.20.10.');

  /// Adds the other usable hosts of a /28 hotspot block (.1 gateway
  /// through .14 — .0 and .15 are network/broadcast) around [neighbor].
  static void _addHotspotNeighbors(String neighbor, void Function(String) add) {
    final dot = neighbor.lastIndexOf('.');
    if (dot <= 0) return;
    final prefix = neighbor.substring(0, dot);
    for (var last = 1; last <= 14; last++) {
      add('$prefix.$last');
    }
  }

  /// Returns the IPv4 with its last octet replaced by [newLast] when that
  /// is a valid host address (1–254), else null — avoids probing the
  /// network (.0) or broadcast (.255) address of a subnet guess.
  static String? _rewriteLastOctet(String host, int newLast) {
    final dot = host.lastIndexOf('.');
    if (dot <= 0) return null;
    if (newLast < 1 || newLast > 254) return null;
    return '${host.substring(0, dot)}.$newLast';
  }
}