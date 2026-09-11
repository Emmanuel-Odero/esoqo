import 'package:flutter/material.dart';

/// The one dropdown shape for every "pick one from a set" field —
/// label, optional leading icon, hint/disabled state — replacing the
/// hand-written `DropdownButtonFormField` + `InputDecoration(labelText:)`
/// blocks (add_bill, org_fleet, fare_pay, create_group, voucher_wallet)
/// that each re-decided the label treatment. Visual styling (fill,
/// radius, focus ring) still comes from the theme's `inputDecorationTheme`
/// via the material field, same as [EsokoFormField].
class EsokoDropdown<T> extends StatelessWidget {
  const EsokoDropdown({
    super.key,
    required this.label,
    required this.items,
    this.initialValue,
    this.onChanged,
    this.icon,
    this.hint,
    this.enabled = true,
  });

  final String label;
  final List<DropdownMenuItem<T>> items;
  final T? initialValue;
  final ValueChanged<T?>? onChanged;
  final IconData? icon;
  final String? hint;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<T>(
      initialValue: initialValue,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: icon == null ? null : Icon(icon),
      ),
      items: items,
      onChanged: enabled ? onChanged : null,
    );
  }
}