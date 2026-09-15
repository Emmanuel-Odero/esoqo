import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_haptics.dart';
import 'esoko_icon.dart';

/// What a button is *for*, which decides how it looks.
///
/// `EsokoLoadingButton` — which this replaced — was hardwired to
/// `FilledButton`. The system had exactly one button, so an author
/// needing "Cancel" had nowhere to go but a raw `TextButton`, and one
/// needing "Edit" reached for `OutlinedButton`. The audit counted **69
/// raw Material buttons across 30 files**: not carelessness, just the
/// predictable consequence of a one-variant component.
///
/// Colour follows SCREEN_CONVENTIONS.md Rule 3 — green is the action
/// *you* are taking, blue belongs to an institution, red is attention
/// only.
enum EsokoButtonRole {
  /// The one thing this screen exists for. At most one per screen.
  primary,

  /// A real alternative path — "Save as draft", "Pay later".
  secondary,

  /// Dismiss, skip, "not now". Carries no chrome so it never competes.
  tertiary,

  /// Ends or removes something. Red, and [EsokoButton] refuses to fire
  /// it without a confirmation step.
  destructive,

  /// An action taken *as an organisation* rather than as yourself —
  /// approving a withdrawal, verifying a fare on duty. Blue, because
  /// the thing being acted on belongs to an institution.
  institutional,
}

/// The app's button.
///
/// Every variant keeps what `EsokoLoadingButton` got right: a built-in
/// `loading` state, [EsokoHaptics] on press, the 0.97 press scale from
/// tokens.css, and a ≥44px target from the theme.
class EsokoButton extends StatefulWidget {
  const EsokoButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.role = EsokoButtonRole.primary,
    this.icon,
    this.esokoIcon,
    this.loading = false,
    this.expand = true,
    this.confirm,
    this.gatedElsewhere = false,
  }) : assert(
          role != EsokoButtonRole.destructive || confirm != null || gatedElsewhere,
          'A destructive button needs a confirm: message. Ending something '
          'must be harder than doing it by accident — see EsokoButtonRole. '
          'If the action is already gated by a PIN prompt or its own dialog, '
          'pass gatedElsewhere: true instead of confirming twice.',
        );

  const EsokoButton.primary({
    Key? key,
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    EsokoIconName? esokoIcon,
    bool loading = false,
    bool expand = true,
  }) : this(
          key: key,
          label: label,
          onPressed: onPressed,
          icon: icon,
          esokoIcon: esokoIcon,
          loading: loading,
          expand: expand,
        );

  const EsokoButton.secondary({
    Key? key,
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    EsokoIconName? esokoIcon,
    bool loading = false,
    bool expand = true,
  }) : this(
          key: key,
          label: label,
          onPressed: onPressed,
          role: EsokoButtonRole.secondary,
          icon: icon,
          esokoIcon: esokoIcon,
          loading: loading,
          expand: expand,
        );

  const EsokoButton.tertiary({
    Key? key,
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    bool loading = false,
    bool expand = false,
  }) : this(
          key: key,
          label: label,
          onPressed: onPressed,
          role: EsokoButtonRole.tertiary,
          icon: icon,
          loading: loading,
          expand: expand,
        );

  /// [confirm] is the question a person is asked before this fires. It
  /// is required, by assertion: the dangerous action is the one that
  /// must be hardest to take by accident, and leaving that to whether
  /// an author remembered a dialog is how it gets forgotten.
  ///
  /// Use [EsokoButton.destructiveGated] instead when the action already
  /// has a gate of its own — a PIN prompt, a dialog that collects a
  /// reason. Two confirmations in a row train people to tap through
  /// both, which costs more safety than the second one buys.
  const EsokoButton.destructive({
    Key? key,
    required String label,
    required VoidCallback? onPressed,
    required String confirm,
    IconData? icon,
    bool loading = false,
    bool expand = true,
  }) : this(
          key: key,
          label: label,
          onPressed: onPressed,
          role: EsokoButtonRole.destructive,
          confirm: confirm,
          icon: icon,
          loading: loading,
          expand: expand,
        );

  /// Red, like [EsokoButton.destructive], but without adding a
  /// confirmation of its own — for actions already gated by a PIN
  /// prompt or a dialog that collects something. The colour still says
  /// what the action is; the gate just lives at the other end.
  const EsokoButton.destructiveGated({
    Key? key,
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    bool loading = false,
    bool expand = true,
  }) : this(
          key: key,
          label: label,
          onPressed: onPressed,
          role: EsokoButtonRole.destructive,
          gatedElsewhere: true,
          icon: icon,
          loading: loading,
          expand: expand,
        );

  const EsokoButton.institutional({
    Key? key,
    required String label,
    required VoidCallback? onPressed,
    IconData? icon,
    EsokoIconName? esokoIcon,
    bool loading = false,
    bool expand = true,
  }) : this(
          key: key,
          label: label,
          onPressed: onPressed,
          role: EsokoButtonRole.institutional,
          icon: icon,
          esokoIcon: esokoIcon,
          loading: loading,
          expand: expand,
        );

  final String label;
  final VoidCallback? onPressed;
  final EsokoButtonRole role;
  final IconData? icon;
  final EsokoIconName? esokoIcon;
  final bool loading;

  /// Fill the available width. True for the variants that are usually a
  /// screen's commit action, false for tertiary, which usually sits
  /// beside something.
  final bool expand;

  /// Required for [EsokoButtonRole.destructive] unless
  /// [gatedElsewhere]; ignored for every other role.
  final String? confirm;

  /// The caller confirms this action itself — see
  /// [EsokoButton.destructiveGated]. Suppresses the built-in dialog so
  /// a person is not asked the same question twice.
  final bool gatedElsewhere;

  @override
  State<EsokoButton> createState() => _EsokoButtonState();
}

class _EsokoButtonState extends State<EsokoButton> {
  bool _pressed = false;

  Future<void> _press() async {
    if (widget.loading || widget.onPressed == null) return;

    if (widget.role == EsokoButtonRole.destructive && !widget.gatedElsewhere) {
      EsokoHaptics.warn();
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(widget.label),
          content: Text(widget.confirm!),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: EsokoColors.red),
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(widget.label),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    } else if (widget.role == EsokoButtonRole.destructive) {
      // Gated elsewhere, so no dialog here — but the press should still
      // feel like the dangerous one it is.
      EsokoHaptics.warn();
    } else {
      EsokoHaptics.confirm();
    }
    widget.onPressed?.call();
  }

  Widget? _leading(Color onColor) {
    if (widget.loading) {
      return SizedBox(
        height: 18,
        width: 18,
        child: CircularProgressIndicator(strokeWidth: 2, color: onColor),
      );
    }
    if (widget.esokoIcon != null) return EsokoIcon(widget.esokoIcon!, size: 18);
    if (widget.icon != null) return Icon(widget.icon, size: 18);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final enabled = widget.onPressed != null && !widget.loading;

    final (Color? fill, Color content, bool outlined, bool bare) =
        switch (widget.role) {
      EsokoButtonRole.primary => (null, scheme.onPrimary, false, false),
      EsokoButtonRole.secondary => (null, EsokoColors.navy, true, false),
      EsokoButtonRole.tertiary => (null, EsokoColors.navy, false, true),
      EsokoButtonRole.destructive => (EsokoColors.red, Colors.white, false, false),
      EsokoButtonRole.institutional => (EsokoColors.blue, Colors.white, false, false),
    };

    final leading = _leading(content);
    final labelText = Text(widget.label);

    Widget button;
    if (bare) {
      button = leading == null
          ? TextButton(onPressed: enabled ? _press : null, child: labelText)
          : TextButton.icon(
              onPressed: enabled ? _press : null,
              icon: leading,
              label: labelText,
            );
    } else if (outlined) {
      button = leading == null
          ? OutlinedButton(onPressed: enabled ? _press : null, child: labelText)
          : OutlinedButton.icon(
              onPressed: enabled ? _press : null,
              icon: leading,
              label: labelText,
            );
    } else {
      final style = fill == null
          ? null
          : FilledButton.styleFrom(backgroundColor: fill, foregroundColor: content);
      button = leading == null
          ? FilledButton(
              style: style,
              onPressed: enabled ? _press : null,
              child: labelText,
            )
          : FilledButton.icon(
              style: style,
              onPressed: enabled ? _press : null,
              icon: leading,
              label: labelText,
            );
    }

    // Only the filled variants carry the action glow — an outlined or
    // bare button sitting under a shadow reads as a card, not a control.
    if (!outlined && !bare) {
      button = DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(EsokoRadius.md),
          boxShadow: widget.loading || !enabled ? const [] : EsokoShadows.action,
        ),
        child: button,
      );
    }

    button = AnimatedScale(
      scale: _pressed ? 0.97 : 1.0,
      duration: EsokoMotion.fast,
      curve: EsokoMotion.easeOut,
      child: Listener(
        onPointerDown: (_) => setState(() => _pressed = true),
        onPointerUp: (_) => setState(() => _pressed = false),
        onPointerCancel: (_) => setState(() => _pressed = false),
        child: button,
      ),
    );

    return widget.expand
        ? SizedBox(width: double.infinity, child: button)
        : button;
  }
}
