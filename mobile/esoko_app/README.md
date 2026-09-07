# esoko_app

Esoko's Flutter client — Android, iOS, and (once the Android toolchain is
set up — see below) a Wear OS companion. Talks to `services/core-go`
(see `docs/adr/0005-mobile-api-in-go.md`), never to the TypeScript apps
directly.

## Architecture

```
lib/
  core/
    theme/     — EsokoColors/EsokoSpacing/EsokoRadius, ported from
                 packages/ui/src/tokens.css (same source of truth as the
                 web apps — kept in sync by hand, see esoko_tokens.dart's
                 own note on why there's no shared build step)
    api/       — ApiClient (Dio wrapper around core-go's /v1/* REST
                 surface), ApiConfig (base URL resolution per platform),
                 ApiException (mirrors core-go's {"error":{code,message}})
    auth/      — AuthController (Riverpod Notifier) + AuthState
                 (Unknown/SignedOut/SignedIn), one method per
                 /v1/auth/* endpoint
    storage/   — TokenStore (flutter_secure_storage — Keychain/Keystore,
                 never SharedPreferences)
    router.dart — go_router with an auth-aware redirect
  features/
    auth/      — sign_in_screen (identifier+PIN), otp_sign_in_screen
                 (phone → code → optional set-PIN), forgot_pin_screen
    home/      — home_shell (bottom nav), record_screen (real data from
                 GET /v1/me), coming_soon_screen (honest placeholder —
                 see below)
  watch/       — Wear OS companion entry point (see "Wear OS" below)
```

## What's real vs. placeholder

**Real, working end to end against core-go**: sign-up/sign-in by OTP,
PIN sign-in, forgot-PIN, sign-out, "Your record" (GET /v1/me), session
persistence across app restarts.

**Honest placeholders** (`ComingSoonScreen`, not fake data): Groups,
Shopping, Tickets. `core-go` doesn't serve those domains yet — Phase 1 in
the plan this app was scaffolded from. These screens say so explicitly
rather than showing fabricated chama balances, products or bookings.

## Running it

```bash
cd mobile/esoko_app
flutter pub get

# core-go must be reachable — either:
#   cd ../../services/core-go && go run ./cmd/api   (host, :4100)
# or:
#   docker compose up -d core-go                    (repo root)

flutter run -d chrome                    # web — localhost:4100 default
flutter run -d <ios-simulator-or-device> # iOS — localhost:4100 default
flutter run -d <android-emulator>        # Android — 10.0.2.2:4100 default
```

**Physical iPhone (hotspot, either direction):** the app probes a short
list of likely hosts (`GET /health`) and keeps the first that answers —
the Wi-Fi gateway covers the *Mac-hosted* hotspot, and gateway+1/+2 cover
the *iPhone-hosted* hotspot where the Mac is the first DHCP client
(172.20.10.2). iOS prompts once for local-network access (the
`NSLocalNetworkUsageDescription` in Info.plist); accept it. core-go is
reachable either way since it binds `:4100` on all interfaces.

**Other physical devices, or when the phone itself is the hotspot:** the
app can't guess the machine running core-go — override with its IP:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.x.x:4100
```

`ApiConfig` (`lib/core/api/api_config.dart`) documents the per-platform
resolution in full.

## Wear OS

Wear OS is Android with a round-screen UI (`lib/watch/`, a second entry
point sharing `core/api` and `core/auth`) — **not** a separate Flutter
toolchain, unlike watchOS (which Flutter cannot target at all; see
docs/adr/0005-mobile-api-in-go.md's "smartwatch scope" decision). It
needs the Android SDK, which this scaffold does **not** have installed
yet:

```bash
flutter doctor    # confirms: "Unable to locate Android SDK"
```

Install Android Studio (or just the command-line tools +
`sdkmanager --install "platforms;android-34" "platform-tools" "build-tools;34.0.0"`),
then `flutter doctor --android-licenses`, then a Wear OS build target can
be added to `android/` (`flutter build apk --flavor wear -t lib/watch/main_wear.dart`,
once that flavor is wired up — not done yet, since there's no toolchain
here to test it against). Until then, `lib/watch/` holds Dart source only
— written but unbuilt.

## Known gaps

- No Android SDK on this machine yet — Android and Wear OS builds are
  unverified (iOS Simulator, a physical iPhone, and Chrome are all
  confirmed working).
- Groups/Shopping/Tickets are placeholders, waiting on core-go's Phase 1.
- `flutter_secure_storage` on web falls back to browser storage (not a
  true secure enclave) — acceptable for local dev, worth revisiting
  before a real web deployment carries a production session token.
