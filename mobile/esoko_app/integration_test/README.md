# Integration tests

Drives the real app on a real device or simulator through the Flutter
Driver/VM-service protocol — `tester.tap`/`enterText` against widget
finders, not synthetic OS mouse events aimed at a simulator window's
pixel coordinates. If you've ever watched an agent (or a human)
recompute tap coordinates from a screenshot's display scale factor
after a window moved four pixels, this is the fix: these tests don't
care where the simulator window is, whether it has focus, or whether
the Mac's screen is even unlocked.

`test/widget_test.dart` has been asking for this file since before
Money/Activity existed — see its own doc comment.

## What these are, and aren't

**Full-stack, not mocked.** `ApiClient` wraps `Dio` directly with no
injected adapter (see its own doc comment) — these tests hit a real
`core-go` over the network, with the same seeded demo data the mobile
team already signs in with by hand. That makes them slow relative to
`test/`'s unit and widget tests (seconds per test, not milliseconds)
and it means a backend outage fails them for a real reason, not a
flaky one. Don't add one here expecting CI-fast feedback — that's what
`test/` is for.

## Running them

1. Start (or point at) a `core-go` with the demo seed loaded — see
   `services/core-go/DEMO_ACCOUNTS.md` for which accounts exist and
   what each one is seeded to hold. `run6.log`-style manual sessions in
   this repo have used a second instance on `:4101` built from current
   source specifically to avoid disturbing a long-running dev
   container on `:4100` — do the same if you're not sure your
   container is current (`docker inspect core-go --format
   '{{.Created}}'` vs. `git log -1 -- services/core-go` will tell you
   fast).

2. Boot a simulator/device and note its id:

   ```bash
   xcrun simctl list devices | grep Booted
   ```

3. Run:

   ```bash
   flutter test integration_test/app_test.dart \
     -d <device-id> \
     --dart-define=API_BASE_URL=http://localhost:4101
   ```

   Omit `--dart-define` to let `ApiConfig.candidateHosts()` probe for
   itself, same as a normal `flutter run` — see `api_client.dart`'s own
   doc comment on what that costs on a real network.

## Writing a new one: the trap that will get you

**A `ListView` only builds elements inside its viewport plus cache
extent.** So `find.text('Chama')` on a tile below the fold returns
zero — not because the screen is wrong, but because that tile has no
element yet. Both of the first failures in this file were exactly
this, against screens that were rendering perfectly.

Use `_scrollTo` before asserting on anything that might be off-screen,
and `_scrollToAndTap` to tap it. The latter also nudges past the
bottom ~140pt of FAB and nav chrome, which is painted *over* the
scrollable at a screen-fixed position and will happily eat a tap on a
tile that `dragUntilVisible` considers perfectly visible.

## What's covered, and the one gap worth knowing about

`app_test.dart` exercises: sign-in reaching the four-destination shell
(Home/Money/Activity/Account, never a leftover "Settings"), all four
tabs rendering without throwing, Account no longer carrying Points or
History, the Chama rename end-to-end from the Home tile, and Tickets'
Browse/Your-tickets segment switch never pushing a second screen.

**Not covered on-device yet:** `bills_list_screen.dart`'s
urgency-within-bucket sort. The comparator itself is a one-line
`compareTo` on `daysUntilDue` — low risk — but confirming it on screen
needs a demo account seeded with more than one Overdue or Due-soon
bill, and none in `DEMO_ACCOUNTS.md` currently is. Add one there, then
extend the `Bills` group in `app_test.dart` to assert tile order
(`tester.widgetList(find.byType(EsokoListTile))` in the rendered
sequence) before trusting this on a new account.

## Seeded accounts used here

Keep this in sync with `services/core-go/DEMO_ACCOUNTS.md` — that file
is the source of truth, not this one.

| Who | Phone | PIN | Why this one |
|---|---|---|---|
| Demo Esther Muthoni | `+254700500017` | `500017` | Plain subject — no org grants, no staff duty. The right account for shell/navigation tests: nothing about `HatsIconButton` or `ActiveRole`'s institutional tints should be in play. |
