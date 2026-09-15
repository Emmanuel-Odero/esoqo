import 'dart:async';

import 'package:flutter/material.dart';

import 'esoqo_field.dart';

/// Search input with a conditional clear button — the shared shape for the
/// store directory and group-joining searches. `onChanged` receives trimmed
/// text; the parent owns the query state and passes the controller through
/// so the clear button can empty it.
///
/// Pass [debounce] (e.g. 350ms) when `onChanged` fans out to a network
/// refetch — without it every keystroke rebuilds the parent and re-fires
/// the provider, which is both chattery and janky. The clear button
/// always emits immediately, never debounced.
class EsoqoSearchField extends StatefulWidget {
  const EsoqoSearchField({
    super.key,
    required this.controller,
    required this.hint,
    this.label,
    required this.onChanged,
    this.onSubmitted,
    this.debounce,
  });

  final TextEditingController controller;
  final String hint;
  final String? label;
  final ValueChanged<String> onChanged;
  final ValueChanged<String>? onSubmitted;
  final Duration? debounce;

  @override
  State<EsoqoSearchField> createState() => _EsoqoSearchFieldState();
}

class _EsoqoSearchFieldState extends State<EsoqoSearchField> {
  Timer? _debounceTimer;

  @override
  void dispose() {
    _debounceTimer?.cancel();
    super.dispose();
  }

  void _emit(String value) {
    final debounce = widget.debounce;
    if (debounce == null) {
      widget.onChanged(value);
      return;
    }
    _debounceTimer?.cancel();
    _debounceTimer = Timer(debounce, () => widget.onChanged(value));
  }

  @override
  Widget build(BuildContext context) {
    return EsoqoField.search(
      controller: widget.controller,
      label: widget.label ?? 'Search',
      hint: widget.hint,
      onChanged: _emit,
      onSubmitted: widget.onSubmitted,
      suffixIcon: ListenableBuilder(
        listenable: widget.controller,
        builder: (context, _) => widget.controller.text.isEmpty
            ? const SizedBox.shrink()
            : IconButton(
                icon: const Icon(Icons.clear_rounded),
                tooltip: 'Clear search',
                onPressed: () {
                  _debounceTimer?.cancel();
                  widget.controller.clear();
                  widget.onChanged('');
                },
              ),
      ),
    );
  }
}
