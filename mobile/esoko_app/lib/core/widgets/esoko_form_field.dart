import 'package:flutter/material.dart';

/// The one text-field shape for every form — label, hint, leading icon,
/// keyboard, autofill and focus-action wired through one call site instead
/// of ~25 hand-rolled `TextField + InputDecoration` blocks. Visual styling
/// (fill, radius, border, padding) still comes from the theme's
/// `inputDecorationTheme`; this only standardises which options every
/// field bothers to set.
class EsokoFormField extends StatelessWidget {
  const EsokoFormField({
    super.key,
    this.controller,
    this.label,
    this.hint,
    this.icon,
    this.suffixIcon,
    this.keyboardType,
    this.textInputAction,
    this.autofillHints,
    this.obscureText = false,
    this.maxLength,
    this.enabled = true,
    this.onChanged,
    this.onSubmitted,
  });

  final TextEditingController? controller;
  final String? label;
  final String? hint;
  final IconData? icon;
  final Widget? suffixIcon;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final bool obscureText;
  final int? maxLength;
  final bool enabled;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      autofillHints: autofillHints,
      obscureText: obscureText,
      maxLength: maxLength,
      enabled: enabled,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: icon == null ? null : Icon(icon),
        suffixIcon: suffixIcon,
      ),
    );
  }
}
