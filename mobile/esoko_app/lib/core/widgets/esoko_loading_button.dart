import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_haptics.dart';

/// Primary action button with a built-in loading state — while `loading`
/// the button disables and shows a 20px on-colour spinner in place of its
/// icon (or label, for icon-less buttons). Replaces the
/// `onPressed: _loading ? null : _submit` + child-ternary every form wrote
/// for itself (7 files). Minimum 44px height comes from the theme's
/// `filledButtonTheme`.
///
/// Matches web's `.btn-p` feel: a green glow shadow at rest and a quick
/// scale-down on press (tokens.css `.btn:active { scale(.97) }`).
class EsokoLoadingButton extends StatefulWidget {
  const EsokoLoadingButton({
    super.key,
    required this.label,
    this.icon,
    required this.onPressed,
    this.loading = false,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool loading;

  @override
  State<EsokoLoadingButton> createState() => _EsokoLoadingButtonState();
}

class _EsokoLoadingButtonState extends State<EsokoLoadingButton> {
  bool _pressed = false;

  void _press() {
    if (widget.loading) return;
    EsokoHaptics.confirm();
    widget.onPressed?.call();
  }

  Widget _build(BuildContext context) {
    final onPrimary = Theme.of(context).colorScheme.onPrimary;
    final spinner = SizedBox(
      height: 20,
      width: 20,
      child: CircularProgressIndicator(strokeWidth: 2, color: onPrimary),
    );
    if (widget.loading) {
      if (widget.icon == null) {
        return FilledButton(onPressed: null, child: spinner);
      }
      return FilledButton.icon(onPressed: null, icon: spinner, label: Text(widget.label));
    }
    if (widget.icon == null) {
      return FilledButton(onPressed: widget.onPressed == null ? null : _press, child: Text(widget.label));
    }
    return FilledButton.icon(
      onPressed: widget.onPressed == null ? null : _press,
      icon: Icon(widget.icon, size: 18),
      label: Text(widget.label),
    );
  }

  @override
  Widget build(BuildContext context) {
    final shadow = EsokoShadows.action;
    return AnimatedScale(
      scale: _pressed ? 0.97 : 1.0,
      duration: EsokoMotion.fast,
      curve: EsokoMotion.easeOut,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(EsokoRadius.md),
          boxShadow: widget.loading ? const [] : shadow,
        ),
        child: Listener(
          onPointerDown: (_) => setState(() => _pressed = true),
          onPointerUp: (_) => setState(() => _pressed = false),
          onPointerCancel: (_) => setState(() => _pressed = false),
          child: _build(context),
        ),
      ),
    );
  }
}
