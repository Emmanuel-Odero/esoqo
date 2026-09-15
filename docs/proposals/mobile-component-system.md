# Mobile component system — making screens do what they say

Status: proposal
Scope: `mobile/esoqo_app`
Supersedes nothing; extends `lib/core/widgets/SCREEN_CONVENTIONS.md`

---

## 1. The finding

Esoqo's mobile app **already has a design system**. `core/theme/esoqo_tokens.dart`
is a complete, well-reasoned token layer ported from `packages/ui/src/tokens.css`
— colour with documented semantics, a 4px spacing grid, a radius scale, three
typefaces, motion curves, four shadow levels. `core/widgets/` holds 35 shared
components behind a barrel export.

The system is not the problem. **Adoption is roughly 50%, and the raw Material
equivalent is used just as often.** Every screen is a coin flip.

| Concept | House component | Raw Material fallback | Adoption |
|---|---|---|---|
| Card surface | `EsoqoCard` — 55 uses | `Card(` 102 · `BoxDecoration` 46 · `Container(` 42 | **22%** |
| App bar | `EsoqoAppBar` — 46 uses | `AppBar(` — 45 uses | **51%** |
| List row | `EsoqoListTile` — 41 uses | `ListTile(` — 42 uses | **49%** |
| Button | `EsoqoLoadingButton` — 46 uses | `FilledButton` 21 · `OutlinedButton` 25 · `TextButton` 21 · `ElevatedButton` 2 · `InkWell` 11 · `GestureDetector` 1 | **36%** |
| Text input | `EsoqoFormField` — 66 uses | `TextField(` 9 · raw `InputDecoration` 19 | **70%** |
| Dropdown | `EsoqoDropdown` — 13 uses | `DropdownButton` — 9 uses | **59%** |
| Page chrome | `EsoqoServiceScaffold` 5 · `EsoqoAuthScaffold` 5 | `Scaffold(` — 59 uses across 53 of 51 screens | **14%** |

Typography shows the same split: **143 raw `TextStyle(`** constructions against
132 `textTheme` reads, across **19 distinct `fontSize` values** including 9,
10, 11, 11.5, 12, 12.5, 14, 14.5, 15, 17, 19, 26, 28, 30. That is not a type
scale; that is freehand.

Spacing is the one clear win — **677 `EsoqoSpacing` references** and very few
raw pixel paddings. It proves the team *will* use a token layer when it covers
the case. Which points straight at the cause.

---

## 2. Why it happened — this is a design defect, not a discipline failure

The components are named and shaped after **what they look like**, and they
expose **every decision as a parameter**. Neither the component nor the compiler
knows what the field is *for*, so correctness depends on each author
remembering, every time, at every call site.

### Evidence A — "enter an amount in KES", five screens, five implementations

| Screen | Label | Icon | Keyboard |
|---|---|---|---|
| `contribute_screen.dart:94` | `Amount (KES)` | `payments_outlined` | `numberWithOptions(decimal: true)` |
| `request_withdrawal_screen.dart:85` | `Amount (KES)` | `payments_outlined` | `numberWithOptions(decimal: true)` |
| `bill_funding_screen.dart:197` | `Amount (KES)` | `payments_outlined` | `TextInputType.number` — no decimal point |
| `allowance_batch_screen.dart:148` | `Amount per employee, KES` | *none* | `numberWithOptions(decimal: true)` |
| `voucher_wallet_screen.dart:137` | `Amount KES` | `payments_outlined` | **none — full QWERTY keyboard** |

A user topping up a voucher wallet is handed an alphabetic keyboard to type
money. That is shipped today.

### Evidence B — "enter an M-Pesa number", six screens, six implementations

| Screen | Label | Hint | Icon | Autofill |
|---|---|---|---|---|
| `esoqo_payer_fields.dart:42` | `M-Pesa phone number` | `+254 7…` | `phone_iphone_outlined` | ✅ |
| `parcel_payment_screen.dart:201` | `M-Pesa phone number` | `e.g. 0712345678` | `phone_outlined` | ❌ |
| `bill_funding_screen.dart:190` | `M-Pesa number` | *none* | `phone_outlined` | ❌ |
| `otp_sign_in_screen.dart:128` | `Phone number` | `+254 7…` | *none* | ✅ |
| `forgot_pin_screen.dart:88` | `Phone number` | `+254 7…` | *none* | ✅ |
| `org_staff_screen.dart:219` | `Phone number` | `+254 7…` | *none* | ❌ |

Three labels, three hint formats, two icons, autofill on half.

### Evidence C — the defaults are wrong in bulk

- **34 of 66** `EsoqoFormField` call sites set no `keyboardType` at all. The
  default is QWERTY, so **52% of every input in the app** opens the wrong
  keyboard unless the author remembered.
- **`inputFormatters` appears 0 times in the entire codebase.** Nothing stops a
  letter in an amount field, nothing normalises `+254` vs `07…`, nothing caps
  an OTP at 6 digits at the input layer.

### Evidence D — the gaps force the fallback

Read `EsoqoLoadingButton`: it is hardwired to `FilledButton`. The system has
**exactly one button** — primary, green, loading-aware. There is no secondary,
no tertiary, no destructive variant. So an author needing "Cancel" has nowhere
to go but raw `TextButton`, and an author needing "Edit" reaches for
`OutlinedButton`. **69 raw button uses are the direct, predictable consequence
of a one-variant button component.** The same holds for `EsoqoCard` (no
interactive/selected/status variants → `InkWell` + `BoxDecoration`).

`EsoqoFormField`'s own doc comment says it "only standardises which options
every field bothers to set." That is precisely the ceiling being hit: it
standardises the *shape* of the decision, not the *decision*.

**The rule this yields:** a component that offers a shape and delegates every
behavioural choice to the caller will diverge at every call site. A component
that encodes an intent cannot.

---

## 3. The recommendation

Four changes, in dependency order. Each is independently shippable.

### 3.1 — Rewrite the component API around intent, not appearance

Components get **named constructors describing purpose**. Keyboard, formatters,
capitalisation, length, autofill, validation, haptics, and semantics travel
*with the purpose*, decided once, in one file.

**Fields** — `core/widgets/esoqo_field.dart`

```dart
/// Every text input in the app. The unnamed constructor does not exist:
/// a field must declare what it collects, because what it collects is
/// what determines the keyboard, the formatter, and the validation. See
/// §2 of docs/proposals/mobile-component-system.md for the five
/// divergent "amount" fields this replaces.
class EsoqoField extends StatelessWidget {
  /// Money. Numeric keyboard with a decimal point, digits-and-one-dot
  /// formatter, "KES" prefix rendered as an affix (never baked into the
  /// label — that is why five screens had five different labels), mono
  /// typeface so digits align.
  const EsoqoField.amount({...});

  /// A Kenyan MSISDN. Phone keypad, telephone autofill, and a formatter
  /// that normalises 07…/+2547…/2547… to one canonical shape before it
  /// ever reaches a repository.
  const EsoqoField.phone({...});

  /// 4–6 digit PIN. Obscured, numeric, maxLength 6, autofill off,
  /// screenshot-safe, never suggests from the keyboard strip.
  const EsoqoField.pin({...});

  /// One-time code. Numeric, maxLength 6, `AutofillHints.oneTimeCode`
  /// so iOS offers the SMS code above the keyboard — currently wired
  /// nowhere, which costs every signing-in user a manual re-type.
  const EsoqoField.otp({...});

  /// A scannable/typed reference: PKG-…, a delivery code, an ESK-…
  /// payment ID. Upper-cased keyboard, mono face, trimmed, and a
  /// trailing scan affordance when a camera path exists for it.
  const EsoqoField.code({...});

  /// A person's name. Word capitalisation, name autofill.
  const EsoqoField.name({...});

  /// Free text — notes, addresses, descriptions. Sentence
  /// capitalisation, multiline, counter when a limit applies.
  const EsoqoField.text({...});

  /// Search. Search keyboard action, clear affordance, debounce owned
  /// here rather than re-implemented per screen.
  const EsoqoField.search({...});
}
```

The call site stops making decisions it should never have been asked to make:

```dart
// Before — voucher_wallet_screen.dart:135, QWERTY for money
EsoqoFormField(controller: _amount, label: 'Amount KES',
               hint: 'e.g. 200', icon: Icons.payments_outlined),

// After — the keyboard, formatter, prefix and alignment are not the
// screen's business, and cannot be got wrong.
EsoqoField.amount(controller: _amount, label: 'Top up'),
```

**Buttons** — `core/widgets/esoqo_button.dart`

Close the gap that generates the 69 fallbacks. Every variant keeps
`EsoqoLoadingButton`'s existing strengths — built-in `loading`, `EsoqoHaptics`,
the 0.97 press scale, the ≥44px target.

| Constructor | Role | Rendering |
|---|---|---|
| `EsoqoButton.primary` | The one action this screen exists for | Filled green, action shadow |
| `EsoqoButton.secondary` | A real alternative path | Outlined navy |
| `EsoqoButton.tertiary` | Dismiss, skip, "not now" | Text, no chrome |
| `EsoqoButton.destructive` | Ends/removes something | Filled red **+ mandatory confirm** |
| `EsoqoButton.institutional` | Acting as an org, not as yourself | Filled blue — encodes Rule 3 |

`destructive` requiring its confirmation sheet in the component is the point:
the dangerous thing becomes the one that is *harder* to do wrong, instead of
depending on whether an author remembered a dialog.

**Surfaces** — extend `EsoqoCard` with `.plain`, `.tappable` (ink + press
scale), `.selectable` (selected state), `.status` (tinted by
`EsoqoStatusTone`), `.institutional` (blue, per Rule 3). This absorbs the 46
`BoxDecoration` and 11 `InkWell` fallbacks.

**Page chrome** — one `EsoqoScreen` with `.list`, `.form`, `.detail`, `.action`,
`.result` variants owning `Scaffold` + app bar + `SafeArea` + scroll +
`AsyncView` wiring + keyboard-inset handling. Adoption here is 14%; this is why
`SCREEN_CONVENTIONS.md` Rule 1 (the double-app-bar bug) had to be written as
prose. A single owner of page chrome makes that rule structurally
unrepresentable rather than documented.

### 3.2 — Encode the type scale

Delete the 19 ad-hoc `fontSize` values. Name every role in `EsoqoTypography`,
expose through `Theme.of(context).textTheme`, and give money/IDs/codes a
dedicated `EsoqoAmountText`-backed mono style (partly built already). Raw
`TextStyle(fontSize:)` becomes a lint error outside `core/theme/`.

### 3.3 — Make the correct path the only path

Prose conventions did not hold — `SCREEN_CONVENTIONS.md` documents the same bug
class shipping **twice** (Rule 4: `org_duty_switcher_screen.dart` and
`parcels_hub_screen.dart`). Move enforcement into CI.

Add to `analysis_options.yaml`:

```yaml
linter:
  rules:
    always_declare_return_types: true
    prefer_single_quotes: true
    use_super_parameters: true

# Raw Material widgets that now have a house equivalent. Each entry is a
# fallback the audit in §2 actually found in the wild.
dart_code_metrics:  # or a custom_lint package — see §4
  rules:
    - banned-usage:
        entries:
          - ident: FilledButton      # → EsoqoButton.primary
          - ident: OutlinedButton    # → EsoqoButton.secondary
          - ident: TextButton        # → EsoqoButton.tertiary
          - ident: ElevatedButton    # → EsoqoButton.primary
          - ident: Card              # → EsoqoCard
          - ident: ListTile          # → EsoqoListTile
          - ident: TextField         # → EsoqoField.<intent>
          - ident: DropdownButton    # → EsoqoDropdown
          - ident: AppBar            # → EsoqoAppBar
        exclude: ['lib/core/widgets/**', 'lib/core/theme/**']
```

`core/widgets/` and `core/theme/` are the only places raw Material is legal.
Everywhere else, reaching for it is a build failure with a message naming the
replacement.

### 3.4 — Make drift visible and caught

- **A gallery screen** (`lib/gallery/`, debug builds only) rendering every
  component in every variant × state (idle / loading / error / disabled /
  empty / long-text / dark mode). Reviewing a component becomes looking at one
  screen instead of hunting 51.
- **Golden tests** over that gallery. A pixel change to a shared component fails
  CI with a visual diff. This is the highest-value test in the whole app: 35
  components used ~500 times means one golden guards hundreds of call sites.
- **Semantics in the component**, not per screen — labels, min tap targets,
  `MediaQuery.textScaler` tolerance to 200%, contrast. Accessibility becomes a
  property of the system rather than a per-screen afterthought.

---

## 3.5 — What is built

**`EsoqoField`** — intent-based inputs. No unnamed constructor: a field must
say what it collects. `.amount()`, `.phone()`, `.pin()`, `.otp()`, `.code()`,
`.name()`, `.text()`, `.quantity()`, `.identifier()`.

Two intents earned their existence during the migration rather than being
guessed up front:

- **`.identifier()`** — sign-in's "phone number or email" is neither `.phone()`
  nor `.text()`. Naming it stops the next person reaching for `.phone()` there
  and quietly locking out email sign-in.
- **`PinAutofill`** on `.pin()` — the three PIN moments genuinely differ.
  Entering a PIN should offer a password manager; *choosing* one should offer
  to save, not fill; a step-up prompt inside an open session should do neither,
  because filling it from the keychain defeats why it is being asked. A single
  default would have been wrong in two of the three.

**`EsoqoButton`** — `primary`, `secondary`, `tertiary`, `destructive`,
`institutional`, closing the gap that produced 69 raw Material buttons.
`destructive` **requires** a `confirm:` message, enforced by assertion: the
dangerous action must be the hardest one to take by accident, and leaving that
to whether an author remembered a dialog is how it gets forgotten. It also
fires `EsoqoHaptics.warn()` — a heavier knock than `confirm()` — before the
dialog, so the cue arrives before the words do.

**`EsoqoRoleLead` + `ActiveRole`** — see §3.6.

**Migrated so far:** the three auth screens, which every user meets first. That
wires `AutofillHints.oneTimeCode`, which existed nowhere before — every
signing-in person was re-typing a code they had just received.

## 3.6 — Roles, which was the real gap

The audit's sharpest finding was not a component: `HomeShell` held
`static const _screens = [HomeHubScreen(), ProfileScreen()]` — **two screens,
for every role**. Switching into an org repainted the app bar and reordered six
tiles. So "acting as" worked correctly and felt like nothing happened, which is
the worst combination available: the machinery is right and the person cannot
tell.

`core/auth/active_role.dart` resolves one of five roles from signals the home
screen already computed — **no new endpoint**. The hub was using held-parcel
count and the COD float to write a *tile subtitle*; those are now promoted to
decide the whole surface.

| Role | Leads with | Colour |
|---|---|---|
| `personal` | your name, your Esoqo id, services | navy |
| `courier` | parcels in hand, cash to hand in | **amber** |
| `crew` | the org, verify a fare | blue |
| `scanner` | the org, scan a ticket | blue |
| `manager` | the org, today's takings | blue |

Ranked, not combined. A SACCO manager who also drives and carries parcels is
all three at once, and the app has to lead with one: **custody outranks duty,
duty outranks browsing**, because that is the order in which somebody else is
waiting. Courier is amber rather than blue deliberately — that person is not
representing an institution, they are *carrying* something.

An unrecognised grant string still shows an org surface rather than dropping
silently back to Personal, which would look exactly like the switch failing.

Also fixed: **Scan was a tab that was not a destination.** Tapping it opened a
sheet and left the selection behind — a broken platform contract, and the code
apologised for it in two index expressions (`_index > 1 ? 1 : 0`,
`selectedIndex: _index == 2 ? 2 : 0`) that existed only to keep a
non-destination out of the destination index. It is now a centre-docked FAB:
still one tap from anywhere, no longer pretending to be a place.

**23 tests** — 14 on the role ranking, 9 on the lead card, including a
200%-text-scale check and a semantics assertion, since the card is the first
thing a screen reader reaches.

## 4. Sequencing

Nine weeks, each phase shippable on its own. Phases 0–2 deliver most of the
user-visible correction.

| Phase | Work | Outcome |
|---|---|---|
| **0 — Stop the bleed** (2 days) | `dart fix --apply` (clears 19 of 23 analyzer infos). Add `keyboardType` + formatters to the 34 bare fields and the 5 amount fields. Wire `AutofillHints.oneTimeCode` on OTP. | Wrong keyboards gone this week, before any refactor lands. |
| **1 — Build the system** (2 wks) | `EsoqoField`, `EsoqoButton`, extended `EsoqoCard`, `EsoqoScreen`, type scale. Gallery screen. Goldens. | New code has a correct path. Nothing migrated yet. |
| **2 — Migrate high-traffic** (2 wks) | Auth, Home, Parcels, Payments — the flows every user hits. | The consistency complaint is answered where it is felt. |
| **3 — Migrate the rest** (2 wks) | Shopping, Tickets, Groups, Bills, Fleet, Vouchers, Scan. | Adoption to ~100%. |
| **4 — Lock it** (1 wk) | Turn on the banned-usage lints. Fold the rules into `SCREEN_CONVENTIONS.md`. | Regression becomes impossible rather than discouraged. |
| **5 — Decompose** (2 wks) | With screens now thin, split the god files: `book_parcel_screen.dart` 986 → controller + steps; same for `schedule_booking` 714, `parcels_hub` 688, `profile` 610. | Logic out of `build()`; the 350 `setState` calls drop sharply. |

Tooling note for §3.3: prefer `custom_lint` + a small in-repo
`packages/esoqo_lints` over `dart_code_metrics` — it is maintained, runs in
`flutter analyze`, and lets the failure message name the replacement component
directly.

---

## 5. What this is measured against

Track these in CI; they are all greppable, so the gallery goldens and a nightly
script can publish them.

| Metric | Today | Target |
|---|---|---|
| House-component adoption (weighted) | ~50% | ≥95% |
| Raw `Card(` / `ListTile(` / `AppBar(` / `TextField(` in `features/` | 198 | 0 |
| Raw Material buttons in `features/` | 69 | 0 |
| Fields with no explicit keyboard intent | 34 of 66 (52%) | 0 |
| `inputFormatters` coverage on amount/phone/PIN/OTP | 0 | 100% |
| Distinct `fontSize` literals | 19 | 0 outside `core/theme/` |
| Raw `TextStyle(` in `features/` | 143 | 0 |
| Screens owning their own `Scaffold` | 53 | ≤5 |
| Golden tests | 0 | 1 per component variant |
| `flutter analyze` | 23 info | 0 |

---

## 6. What is explicitly not proposed

**Not a rewrite.** The token layer is correct and complete. The repository
layer, the backend contract knowledge encoded in the comments, and the domain
modelling are the expensive assets here and they are sound. This proposal
changes the *component API* and migrates call sites to it. Nothing below
`core/theme/` moves.

**Not a new design language.** Colours, spacing, radii, type and motion stay
exactly as `tokens.css` defines them. The complaint is not that the design is
wrong — it is that only half the screens use it.

**Not Material 3 defaults.** Falling back to stock Material is what produced the
divergence. The house components stay opinionated.

---

## 7. The principle to hold

> A component should make the right thing the easy thing, and the wrong thing
> impossible to express.

`EsoqoFormField` today lets any screen ask for money with an alphabetic
keyboard, and five screens did. `EsoqoField.amount()` cannot, because the
keyboard is not a parameter — it is part of what "amount" means.

Apply that test to every component added from here: *can a caller use this
correctly without knowing anything the component itself could have known?* If
not, the intent belongs in the constructor, not in the call site.
