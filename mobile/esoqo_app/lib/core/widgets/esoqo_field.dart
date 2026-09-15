import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/esoqo_tokens.dart';

/// Which autofill behaviour a PIN field should have — see
/// [EsoqoField.pin].
enum PinAutofill { none, signIn, create }

/// Every text input in the app, named for what it collects.
///
/// ## Why there is no unnamed constructor
///
/// `EsoqoFormField` — which this replaced — took `keyboardType`,
/// `textCapitalization`, `maxLength` and `autofillHints` as optional
/// parameters, which meant every call site re-decided them. The audit
/// found what that costs:
///
///   * **34 of 66** call sites set no `keyboardType` at all, so more than
///     half the inputs in the app opened a QWERTY keyboard whatever they
///     collected. `voucher_wallet_screen.dart` asked for money that way.
///   * `inputFormatters` appeared **zero** times in the entire codebase,
///     so nothing stopped letters in an amount or normalised a phone
///     number.
///   * "Enter an amount in KES" existed five times with five different
///     labels, icons and keyboards; "enter an M-Pesa number" six times.
///
/// None of that is carelessness — it is what happens when a component
/// asks each caller to re-derive the same decision. So here the decision
/// travels with the intent: a field must say what it is for, and the
/// keyboard, formatter, capitalisation, length and autofill follow from
/// that in one place.
///
/// The rule to hold when adding one: *can a caller use this correctly
/// without knowing something the component itself could have known?* If
/// not, it belongs in the constructor.
///
/// See docs/proposals/mobile-component-system.md.
class EsoqoField extends StatelessWidget {
  const EsoqoField._({
    super.key,
    required this.label,
    required this.keyboardType,
    this.controller,
    this.hint,
    this.icon,
    this.suffixIcon,
    this.helper,
    this.errorText,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
    this.autofillHints,
    this.obscureText = false,
    this.maxLength,
    this.maxLines = 1,
    this.inputFormatters = const [],
    this.enabled = true,
    this.autofocus = false,
    this.prefixText,
    this.suffixText,
    this.mono = false,
    this.onChanged,
    this.onSubmitted,
  });

  /// Money. Numeric keyboard with a decimal point, digits-and-one-dot
  /// only, a `KES` prefix rendered as an affix, and the mono face so
  /// digits line up.
  ///
  /// The prefix is an affix rather than part of the label because that
  /// is what let five screens drift to "Amount (KES)", "Amount KES" and
  /// "Amount per employee, KES". The currency is not the label's job.
  factory EsoqoField.amount({
    Key? key,
    TextEditingController? controller,
    String label = 'Amount',
    String? hint,
    String? helper,
    String? errorText,
    bool enabled = true,
    bool autofocus = false,
    TextInputAction? textInputAction,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: hint,
    helper: helper,
    errorText: errorText,
    enabled: enabled,
    autofocus: autofocus,
    prefixText: 'KES ',
    mono: true,
    icon: Icons.payments_outlined,
    keyboardType: const TextInputType.numberWithOptions(decimal: true),
    textInputAction: textInputAction ?? TextInputAction.done,
    inputFormatters: [_DecimalAmountFormatter()],
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// A Kenyan phone number. Phone keypad, telephone autofill, and a
  /// formatter that keeps it to the characters a number can contain.
  ///
  /// One label and one hint, because six screens had three of each.
  factory EsoqoField.phone({
    Key? key,
    TextEditingController? controller,
    String label = 'Phone number',
    String? helper,
    String? errorText,
    bool enabled = true,
    bool autofocus = false,
    TextInputAction? textInputAction,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: '07… or +254…',
    helper: helper,
    errorText: errorText,
    enabled: enabled,
    autofocus: autofocus,
    mono: true,
    icon: Icons.phone_outlined,
    keyboardType: TextInputType.phone,
    textInputAction: textInputAction ?? TextInputAction.done,
    autofillHints: const [AutofillHints.telephoneNumber],
    maxLength: 15,
    inputFormatters: [
      FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
    ],
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// A 4–6 digit PIN. Obscured, numeric, digits only.
  ///
  /// [autofill] is explicit because the three PIN moments in this app
  /// genuinely differ, and defaulting all of them the same way would be
  /// wrong in two of the three:
  ///
  ///   * [PinAutofill.signIn] — the credential being *entered*. A
  ///     password manager should offer it.
  ///   * [PinAutofill.create] — a PIN being *chosen*. The OS should
  ///     offer to save it, not to fill it.
  ///   * [PinAutofill.none] — a re-confirmation, or a step-up prompt
  ///     inside an already-open session. Filling that from the keychain
  ///     defeats the reason it is being asked for at all.
  factory EsoqoField.pin({
    Key? key,
    TextEditingController? controller,
    String label = 'PIN',
    String? helper,
    String? errorText,
    bool enabled = true,
    bool autofocus = false,
    PinAutofill autofill = PinAutofill.none,
    TextInputAction? textInputAction,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    helper: helper,
    errorText: errorText,
    enabled: enabled,
    autofocus: autofocus,
    mono: true,
    icon: Icons.lock_outline,
    keyboardType: TextInputType.number,
    textInputAction: textInputAction ?? TextInputAction.done,
    obscureText: true,
    maxLength: 6,
    autofillHints: switch (autofill) {
      PinAutofill.none => null,
      PinAutofill.signIn => const [AutofillHints.password],
      PinAutofill.create => const [AutofillHints.newPassword],
    },
    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// Sign-in's "phone number or email" — one box that accepts either.
  ///
  /// Its own intent rather than a variant of [phone] or [text]: the
  /// keyboard has to carry both `@` and digits, so it is
  /// `emailAddress`, and no formatter may run because there is no one
  /// shape to enforce. Naming it stops the next person reaching for
  /// `.phone()` here and quietly locking out email sign-in.
  factory EsoqoField.identifier({
    Key? key,
    TextEditingController? controller,
    String label = 'Phone number or email',
    String? errorText,
    bool enabled = true,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: '07… or you@example.com',
    errorText: errorText,
    enabled: enabled,
    icon: Icons.alternate_email,
    keyboardType: TextInputType.emailAddress,
    textInputAction: TextInputAction.next,
    autofillHints: const [AutofillHints.username],
    onSubmitted: onSubmitted,
  );

  /// A one-time code from an SMS.
  ///
  /// [AutofillHints.oneTimeCode] is the whole point: iOS offers the code
  /// above the keyboard and Android autofills it, so nobody has to leave
  /// the app to read their own message. It was wired nowhere before
  /// this, which cost every signing-in person a manual re-type.
  factory EsoqoField.otp({
    Key? key,
    TextEditingController? controller,
    String label = 'Code',
    String? helper,
    String? errorText,
    bool enabled = true,
    bool autofocus = true,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: '6 digits',
    helper: helper,
    errorText: errorText,
    enabled: enabled,
    autofocus: autofocus,
    mono: true,
    icon: Icons.sms_outlined,
    keyboardType: TextInputType.number,
    textInputAction: TextInputAction.done,
    autofillHints: const [AutofillHints.oneTimeCode],
    maxLength: 6,
    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// A scannable or dictated reference — PKG-…, a delivery code, an
  /// ESK-… payment id. Upper-cased because these are always upper case
  /// on a label, and a lower-case keyboard makes somebody reach for
  /// shift on every character.
  factory EsoqoField.code({
    Key? key,
    TextEditingController? controller,
    String label = 'Code',
    String? hint,
    String? helper,
    String? errorText,
    Widget? suffixIcon,
    bool enabled = true,
    bool autofocus = false,
    int? maxLength,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: hint,
    helper: helper,
    errorText: errorText,
    suffixIcon: suffixIcon,
    enabled: enabled,
    autofocus: autofocus,
    mono: true,
    icon: Icons.qr_code_2_outlined,
    keyboardType: TextInputType.text,
    textInputAction: TextInputAction.done,
    textCapitalization: TextCapitalization.characters,
    maxLength: maxLength,
    inputFormatters: [_UpperCaseFormatter()],
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// A person's name.
  factory EsoqoField.name({
    Key? key,
    TextEditingController? controller,
    String label = 'Name',
    String? hint,
    String? helper,
    String? errorText,
    bool enabled = true,
    bool autofocus = false,
    TextInputAction? textInputAction,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: hint,
    helper: helper,
    errorText: errorText,
    enabled: enabled,
    autofocus: autofocus,
    icon: Icons.person_outline,
    keyboardType: TextInputType.name,
    textInputAction: textInputAction ?? TextInputAction.next,
    textCapitalization: TextCapitalization.words,
    autofillHints: const [AutofillHints.name],
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// Free text — a note, an address, a description.
  factory EsoqoField.text({
    Key? key,
    TextEditingController? controller,
    required String label,
    String? hint,
    String? helper,
    String? errorText,
    IconData? icon,
    bool enabled = true,
    bool autofocus = false,
    int maxLines = 1,
    int? maxLength,
    TextInputAction? textInputAction,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: hint,
    helper: helper,
    errorText: errorText,
    icon: icon,
    enabled: enabled,
    autofocus: autofocus,
    maxLines: maxLines,
    maxLength: maxLength,
    keyboardType: maxLines > 1 ? TextInputType.multiline : TextInputType.text,
    textInputAction: textInputAction ??
        (maxLines > 1 ? TextInputAction.newline : TextInputAction.next),
    textCapitalization: TextCapitalization.sentences,
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// A measurement with a unit — a parcel's weight, a distance. Decimal
  /// keyboard and a digits-and-one-dot formatter like [amount], but the
  /// affix is the unit rather than a currency, because the number is not
  /// money and must not pick up money's `KES`.
  factory EsoqoField.measure({
    Key? key,
    TextEditingController? controller,
    required String label,
    required String unit,
    String? hint,
    String? helper,
    String? errorText,
    IconData? icon,
    bool enabled = true,
    TextInputAction? textInputAction,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: hint,
    helper: helper,
    errorText: errorText,
    enabled: enabled,
    mono: true,
    suffixText: unit,
    icon: icon,
    keyboardType: const TextInputType.numberWithOptions(decimal: true),
    textInputAction: textInputAction ?? TextInputAction.next,
    inputFormatters: [_DecimalAmountFormatter()],
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// A search box. Search keyboard action and the magnifier, so a list
  /// filter never has to re-decide either; [suffixIcon] is where the
  /// clear affordance goes.
  factory EsoqoField.search({
    Key? key,
    TextEditingController? controller,
    String label = 'Search',
    String? hint,
    Widget? suffixIcon,
    bool enabled = true,
    bool autofocus = false,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    hint: hint,
    suffixIcon: suffixIcon,
    enabled: enabled,
    autofocus: autofocus,
    icon: Icons.search_rounded,
    keyboardType: TextInputType.text,
    textInputAction: TextInputAction.search,
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  /// A whole-number quantity — seats, parcels, capacity. Not money.
  factory EsoqoField.quantity({
    Key? key,
    TextEditingController? controller,
    required String label,
    String? helper,
    String? errorText,
    bool enabled = true,
    ValueChanged<String>? onChanged,
    ValueChanged<String>? onSubmitted,
  }) => EsoqoField._(
    key: key,
    controller: controller,
    label: label,
    helper: helper,
    errorText: errorText,
    enabled: enabled,
    mono: true,
    keyboardType: TextInputType.number,
    textInputAction: TextInputAction.done,
    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );

  final TextEditingController? controller;
  final String label;
  final String? hint;
  final String? helper;
  final String? errorText;
  final IconData? icon;
  final Widget? suffixIcon;
  final String? prefixText;
  final String? suffixText;
  final TextInputType keyboardType;
  final TextInputAction? textInputAction;
  final TextCapitalization textCapitalization;
  final Iterable<String>? autofillHints;
  final bool obscureText;
  final int? maxLength;
  final int maxLines;
  final List<TextInputFormatter> inputFormatters;
  final bool enabled;
  final bool autofocus;
  final bool mono;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      textCapitalization: textCapitalization,
      autofillHints: autofillHints,
      obscureText: obscureText,
      maxLength: maxLength,
      maxLines: obscureText ? 1 : maxLines,
      inputFormatters: inputFormatters,
      enabled: enabled,
      autofocus: autofocus,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      style: mono ? EsoqoTypography.mono(fontSize: EsoqoTypeScale.subTitle) : null,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        helperText: helper,
        errorText: errorText,
        prefixText: prefixText,
        prefixStyle: prefixText == null
            ? null
            : EsoqoTypography.mono(
                fontSize: EsoqoTypeScale.subTitle,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        prefixIcon: icon == null ? null : Icon(icon),
        suffixText: suffixText,
        suffixStyle: suffixText == null
            ? null
            : EsoqoTypography.mono(
                fontSize: EsoqoTypeScale.subTitle,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        suffixIcon: suffixIcon,
        // The character counter is noise on a field whose length is a
        // rule rather than a budget (a PIN, an OTP, a phone number) —
        // the user is not choosing how much to write.
        counterText: '',
      ),
    );
  }
}

/// Digits and at most one decimal point, at most two places after it.
///
/// Stops the two things an amount field must never accept: a letter, and
/// a third decimal place that the server would then have to round on the
/// user's behalf.
class _DecimalAmountFormatter extends TextInputFormatter {
  static final _valid = RegExp(r'^\d*\.?\d{0,2}$');

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    if (newValue.text.isEmpty) return newValue;
    return _valid.hasMatch(newValue.text) ? newValue : oldValue;
  }
}

/// Upper-cases as you type, keeping the caret where it was.
class _UpperCaseFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final upper = newValue.text.toUpperCase();
    if (upper == newValue.text) return newValue;
    return TextEditingValue(text: upper, selection: newValue.selection);
  }
}
