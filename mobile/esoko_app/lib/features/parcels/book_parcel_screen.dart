import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_models.dart';
import 'parcel_pricing_screen.dart';
import 'parcels_repository.dart';

const _weightUnits = [('KG', 'kg'), ('G', 'g')];

/// Booking a parcel — sender's name/phone, receiver's, a plain-text
/// origin/destination (no geocoding, same reasoning as Bill.accountRef:
/// a human-readable description is more useful to a courier than a
/// lat/lng this app doesn't collect), and the parcel type/weight/
/// fragile flag that drives pricing. Weight is still optional — typing
/// one just auto-picks the matching parcel type (and its price band)
/// from the admin-configured brackets, same numbers
/// [ParcelPricingScreen] re-derives server-side; leaving it blank
/// falls back to picking a type by hand. Submitting here only creates
/// a DRAFT_PENDING_PAYMENT booking — [ParcelPricingScreen] then the
/// payment step are what make it real.
class BookParcelScreen extends ConsumerStatefulWidget {
  const BookParcelScreen({super.key});

  @override
  ConsumerState<BookParcelScreen> createState() => _BookParcelScreenState();
}

class _BookParcelScreenState extends ConsumerState<BookParcelScreen> {
  final _senderName = TextEditingController();
  final _senderMsisdn = TextEditingController();
  final _receiverName = TextEditingController();
  final _receiverMsisdn = TextEditingController();
  final _origin = TextEditingController();
  final _destination = TextEditingController();
  final _weight = TextEditingController();
  final _notes = TextEditingController();
  final _existingCode = TextEditingController();
  String _parcelType = parcelTypes.first.$1;
  String _weightUnit = 'KG';
  bool _fragile = false;
  bool _busy = false;
  String? _error;

  List<ParcelPricing> _pricing = const [];
  bool _pricingLoading = true;
  List<ParcelZone> _zones = const [];
  String? _originZoneId;
  String? _destinationZoneId;

  @override
  void initState() {
    super.initState();
    // Silent prefill from the signed-in profile, same pattern
    // checkout_screen.dart/schedule_booking_screen.dart already use —
    // still editable, just saves retyping what's already on file.
    final auth = ref.read(authControllerProvider);
    if (auth is AuthSignedIn) {
      _senderName.text = auth.profile.displayName;
      _senderMsisdn.text = auth.profile.msisdn ?? '';
    }
    _weight.addListener(_onWeightChanged);
    _loadPricing();
    _loadZones();
  }

  Future<void> _loadZones() async {
    try {
      final zones = await ref.read(parcelsRepositoryProvider).listZones();
      if (mounted) setState(() => _zones = zones);
    } on ApiException {
      // Zone selection is optional (see this screen's own doc comment
      // on graceful degradation) — a failed fetch just means no zone
      // picker shows, not a blocked booking.
    }
  }

  Future<void> _loadPricing() async {
    try {
      final pricing = await ref.read(parcelsRepositoryProvider).getAllPricing();
      if (!mounted) return;
      setState(() {
        _pricing = pricing;
        _pricingLoading = false;
      });
    } on ApiException {
      // The dropdown still works with the plain type names below —
      // only the weight/price preview needs this list, so a failed
      // fetch here shouldn't block booking.
      if (mounted) setState(() => _pricingLoading = false);
    }
  }

  /// The entered weight converted to kg — the unit toggle only affects
  /// how the number is typed, never what's sent to the server or
  /// matched against a bracket (both always kg).
  double? get _weightKg {
    final raw = double.tryParse(_weight.text.trim());
    if (raw == null) return null;
    return _weightUnit == 'G' ? raw / 1000 : raw;
  }

  void _onWeightChanged() {
    final kg = _weightKg;
    if (kg == null || _pricing.isEmpty) return;
    final match = matchParcelPricingForWeight(_pricing, kg);
    if (match != null && match.parcelType != _parcelType) {
      setState(() => _parcelType = match.parcelType);
    }
  }

  @override
  void dispose() {
    _weight.removeListener(_onWeightChanged);
    _senderName.dispose();
    _senderMsisdn.dispose();
    _receiverName.dispose();
    _receiverMsisdn.dispose();
    _origin.dispose();
    _destination.dispose();
    _weight.dispose();
    _notes.dispose();
    _existingCode.dispose();
    super.dispose();
  }

  Future<void> _book() async {
    if ([
      _senderName,
      _senderMsisdn,
      _receiverName,
      _receiverMsisdn,
      _origin,
      _destination,
    ].any((c) => c.text.trim().isEmpty)) {
      setState(() => _error = 'Fill in every field above.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final booked = await ref.read(parcelsRepositoryProvider).bookParcel(
            senderName: _senderName.text.trim(),
            senderMsisdn: _senderMsisdn.text.trim(),
            receiverName: _receiverName.text.trim(),
            receiverMsisdn: _receiverMsisdn.text.trim(),
            originLabel: _origin.text.trim(),
            destinationLabel: _destination.text.trim(),
            parcelType: _parcelType,
            weightKg: _weightKg,
            fragile: _fragile,
            notes: _notes.text.trim(),
            originZoneId: _originZoneId,
            destinationZoneId: _destinationZoneId,
            existingCode: _existingCode.text.trim(),
          );
      if (!mounted) return;
      // pushReplacement, not push — the booking form is done; the price
      // and payment steps that follow collapse into the same slot so a
      // final pop from the payment screen lands straight back on the
      // parcels hub, same "collapsed stage stack" shape checkout uses.
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => ParcelPricingScreen(
            code: booked.code,
            parcelType: _parcelType,
            originZoneId: _originZoneId,
            destinationZoneId: _destinationZoneId,
          ),
        ),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Send a parcel'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: ListView(
              padding: const EdgeInsets.all(EsokoSpacing.s5),
              children: [
                EsokoSubHeader('Sender'),
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormField(
                  controller: _senderName,
                  label: 'Your name',
                  icon: Icons.person_outline,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _senderMsisdn,
                  label: 'Your phone',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: EsokoSpacing.s5),
                EsokoSubHeader('Receiver'),
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormField(
                  controller: _receiverName,
                  label: 'Their name',
                  icon: Icons.person_outline,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _receiverMsisdn,
                  label: 'Their phone',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: EsokoSpacing.s5),
                EsokoSubHeader('Route'),
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormField(
                  controller: _origin,
                  label: 'Picking up from',
                  hint: 'e.g. Westlands, opposite Sarit',
                  icon: Icons.trip_origin,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _destination,
                  label: 'Delivering to',
                  hint: 'e.g. Kisumu, Milimani estate',
                  icon: Icons.place_outlined,
                ),
                if (_zones.isNotEmpty) ...[
                  const SizedBox(height: EsokoSpacing.s3),
                  Text(
                    'Optional — pick the nearest zone on each end for a '
                    'distance-aware price instead of the flat rate.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: EsokoSpacing.s2),
                  _zoneField(
                    label: 'Origin zone',
                    value: _originZoneId,
                    onChanged: (v) => setState(() => _originZoneId = v),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  _zoneField(
                    label: 'Destination zone',
                    value: _destinationZoneId,
                    onChanged: (v) => setState(() => _destinationZoneId = v),
                  ),
                ],
                const SizedBox(height: EsokoSpacing.s5),
                EsokoSubHeader('Parcel details'),
                const SizedBox(height: EsokoSpacing.s2),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: EsokoFormField(
                        controller: _weight,
                        label: 'Weight (optional)',
                        hint: 'e.g. 2.5',
                        icon: Icons.scale_outlined,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      ),
                    ),
                    const SizedBox(width: EsokoSpacing.s3),
                    // Fixed width, not a bare Row child — an
                    // un-widthed EsokoSegmentedToggle throws "BoxConstraints
                    // forces an infinite width" next to an Expanded
                    // sibling (see parcels_hub_screen.dart's identical
                    // fix for its "Accept" button, and
                    // SCREEN_CONVENTIONS.md).
                    SizedBox(
                      width: 96,
                      child: EsokoSegmentedToggle<String>(
                        selected: _weightUnit,
                        onChanged: (u) => setState(() {
                          _weightUnit = u;
                          _onWeightChanged();
                        }),
                        options: _weightUnits,
                      ),
                    ),
                  ],
                ),
                if (_weightKg != null && !_pricingLoading) ...[
                  const SizedBox(height: EsokoSpacing.s2),
                  Text(
                    'Matched to ${parcelTypeLabel(_parcelType)} based on that weight.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                const SizedBox(height: EsokoSpacing.s3),
                _parcelTypeField(),
                const SizedBox(height: EsokoSpacing.s2),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Fragile'),
                  value: _fragile,
                  onChanged: (v) => setState(() => _fragile = v),
                ),
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormField(
                  controller: _notes,
                  label: 'Notes (optional)',
                  hint: 'e.g. Call on arrival',
                ),
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormField(
                  controller: _existingCode,
                  label: 'Pre-printed label code (optional)',
                  hint: 'e.g. PKG-T7HZ967 — already on the parcel?',
                  icon: Icons.qr_code_2_outlined,
                ),
                if (_error != null) ...[
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoFormError(message: _error!),
                ],
                const SizedBox(height: EsokoSpacing.s5),
                EsokoLoadingButton(
                  label: 'Continue to pricing',
                  loading: _busy,
                  onPressed: _book,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// A plain, always-optional zone dropdown — `null` stays selectable
  /// (unlike [_parcelTypeField], nothing here forces a choice) so
  /// skipping zone selection entirely is one tap, not a dead end.
  Widget _zoneField({
    required String label,
    required String? value,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String?>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, prefixIcon: const Icon(Icons.map_outlined)),
      items: [
        const DropdownMenuItem<String?>(value: null, child: Text('None')),
        for (final z in _zones) DropdownMenuItem<String?>(value: z.id, child: Text(z.name)),
      ],
      onChanged: onChanged,
    );
  }

  /// A `DropdownButtonFormField` built by hand rather than through
  /// [EsokoDropdown] — that shared widget takes an `initialValue`
  /// (uncontrolled, form-field style) that can't be moved
  /// programmatically once built, and weight-driven auto-selection
  /// needs exactly that. The `key: ValueKey(_parcelType)` below is what
  /// makes it work: changing the key forces Flutter to treat a
  /// weight-driven change as a brand new field instance and pick up
  /// the new initialValue, the same trick FormField-based widgets
  /// always need for a value pushed in from outside.
  ///
  /// Each closed-field row stays a single line (selectedItemBuilder);
  /// the open menu's rows show that type's weight bracket and price
  /// range — the "show weight and price ranges when the dropdown
  /// appears" behaviour — sourced from admin-configured
  /// ParcelPricingRule, never a hardcoded guess.
  Widget _parcelTypeField() {
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    ParcelPricing? pricingFor(String type) {
      for (final p in _pricing) {
        if (p.parcelType == type) return p;
      }
      return null;
    }

    return DropdownButtonFormField<String>(
      key: ValueKey(_parcelType),
      initialValue: _parcelType,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: 'Parcel type',
        prefixIcon: const Icon(Icons.inventory_2_outlined),
      ),
      selectedItemBuilder: (context) => [
        for (final t in parcelTypes) Text(t.$2, overflow: TextOverflow.ellipsis),
      ],
      items: [
        for (final t in parcelTypes)
          DropdownMenuItem(
            value: t.$1,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: EsokoSpacing.s1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(t.$2, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Builder(builder: (context) {
                    final p = pricingFor(t.$1);
                    if (p == null) return const SizedBox.shrink();
                    return Text(
                      '${p.weightLabel} · KES ${p.minKes.toStringAsFixed(0)}–${p.maxKes.toStringAsFixed(0)}',
                      style: TextStyle(fontSize: 12, color: muted),
                    );
                  }),
                ],
              ),
            ),
          ),
      ],
      onChanged: (v) => setState(() => _parcelType = v ?? _parcelType),
    );
  }
}
