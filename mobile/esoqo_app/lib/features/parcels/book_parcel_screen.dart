import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/money/money.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_models.dart';
import 'parcel_payment_screen.dart';
import 'parcels_repository.dart';

const _weightUnits = [('KG', 'kg'), ('G', 'g')];

/// Booking a parcel, priced before anything is written.
///
/// The order here is the point. This screen used to POST a
/// DRAFT_PENDING_PAYMENT parcel the moment you tapped "Continue to
/// pricing" — a booking created just to find out what one costs, which
/// is where the admin console's stale-draft KPI and its nightly sweeper
/// came from. Now the price is a live read that re-runs as the sender
/// edits (GET /v1/parcels/pricing is public and takes no session), and
/// exactly one commit at the end books it and sets its price together.
///
/// It also stops asking for four PII fields before showing a number.
/// Step one is what's being sent and where; step two is who. Someone
/// who doesn't like the price never types a phone number at all.
class BookParcelScreen extends ConsumerStatefulWidget {
  const BookParcelScreen({super.key});

  @override
  ConsumerState<BookParcelScreen> createState() => _BookParcelScreenState();
}

enum _Step { what, who }

class _BookParcelScreenState extends ConsumerState<BookParcelScreen> {
  _Step _step = _Step.what;

  final _senderName = TextEditingController();
  final _senderMsisdn = TextEditingController();
  final _receiverName = TextEditingController();
  final _receiverMsisdn = TextEditingController();
  final _origin = TextEditingController();
  final _destination = TextEditingController();
  final _weight = TextEditingController();
  final _notes = TextEditingController();
  final _existingCode = TextEditingController();
  final _declaredValue = TextEditingController();

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

  List<ParcelAgent> _agents = const [];
  bool _collectFromAgent = false;
  String? _destinationAgentId;

  List<ParcelCoverageTier> _tiers = const [];
  String? _coverageTierId;

  // Cash on delivery — the buyer pays the seller for the goods (and
  // optionally the dispatch fee) at the door instead of the seller
  // prepaying now. Only offered once the policy loads and says it's on.
  ParcelCodPolicy? _codPolicy;
  bool _isCod = false;
  final _codAmount = TextEditingController();

  // A real pin for the pickup end. Only the origin is offered here:
  // the sender is standing at it, so "use my location" is honest and
  // one tap. Asking them to pin a destination they are not at would be
  // asking them to guess, and a confidently wrong pin is worse for a
  // courier than the free-text label they would otherwise read.
  Position? _originPin;
  bool _pinning = false;
  String? _pinError;

  /// The live quote. Null until the first one lands.
  ParcelPricing? _quote;
  bool _quoteLoading = false;
  BargainReason? _selectedReason;

  Timer? _quoteDebounce;
  // Guards against a slow earlier quote landing after a fast later one
  // and showing a price for inputs the sender has already moved on from.
  int _quoteSeq = 0;

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
    _declaredValue.addListener(_onDeclaredValueChanged);
    _loadPricing();
    _loadZones();
    _loadAgents();
    _loadTiers();
    _loadCodPolicy();
  }

  @override
  void dispose() {
    _quoteDebounce?.cancel();
    _weight.removeListener(_onWeightChanged);
    _declaredValue.removeListener(_onDeclaredValueChanged);
    _senderName.dispose();
    _senderMsisdn.dispose();
    _receiverName.dispose();
    _receiverMsisdn.dispose();
    _origin.dispose();
    _destination.dispose();
    _weight.dispose();
    _notes.dispose();
    _existingCode.dispose();
    _declaredValue.dispose();
    _codAmount.dispose();
    super.dispose();
  }

  // ── Loads ───────────────────────────────────────────────────────────

  Future<void> _loadZones() async {
    try {
      final zones = await ref.read(parcelsRepositoryProvider).listZones();
      if (mounted) setState(() => _zones = zones);
    } on ApiException {
      // Zone selection is optional — a failed fetch just means no zone
      // picker shows, not a blocked booking.
    }
  }

  Future<void> _loadAgents() async {
    try {
      final agents = await ref.read(parcelsRepositoryProvider).listAgents();
      if (mounted) {
        setState(() => _agents = agents.where((a) => !a.isFull).toList());
      }
    } on ApiException {
      // No pickup points means doorstep is the only option, which is
      // exactly how this worked before the agent network existed.
    }
  }

  Future<void> _loadTiers() async {
    try {
      final tiers = await ref
          .read(parcelsRepositoryProvider)
          .listCoverageTiers(_declaredValueKes ?? 0);
      if (mounted) setState(() => _tiers = tiers);
    } on ApiException {
      // Cover is optional; without the rate card the section stays hidden.
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
      _scheduleQuote();
    } on ApiException {
      if (mounted) setState(() => _pricingLoading = false);
    }
  }

  Future<void> _loadCodPolicy() async {
    try {
      final policy = await ref.read(parcelsRepositoryProvider).getCodPolicy();
      if (mounted) setState(() => _codPolicy = policy);
    } on ApiException {
      // No policy loaded means no COD offer — falls back to the
      // always-available prepay/pay-in-person path.
    }
  }

  // ── Derived values ──────────────────────────────────────────────────

  /// The entered weight converted to kg — the unit toggle only affects
  /// how the number is typed, never what's sent to the server or
  /// matched against a bracket (both always kg).
  double? get _weightKg {
    final raw = double.tryParse(_weight.text.trim());
    if (raw == null) return null;
    return _weightUnit == 'G' ? raw / 1000 : raw;
  }

  double? get _declaredValueKes {
    final raw = double.tryParse(_declaredValue.text.trim());
    return (raw == null || raw <= 0) ? null : raw;
  }

  double? get _codAmountKes {
    final raw = double.tryParse(_codAmount.text.trim());
    return (raw == null || raw <= 0) ? null : raw;
  }

  ParcelAgent? get _chosenAgent {
    if (!_collectFromAgent || _destinationAgentId == null) return null;
    for (final a in _agents) {
      if (a.id == _destinationAgentId) return a;
    }
    return null;
  }

  Money get _payableKes {
    final q = _quote;
    if (q == null) return Money.zero;
    return _selectedReason == null ? q.minKes : q.priceForReason(_selectedReason!);
  }

  void _onWeightChanged() {
    final kg = _weightKg;
    if (kg != null && _pricing.isNotEmpty) {
      final match = matchParcelPricingForWeight(_pricing, kg);
      if (match != null && match.parcelType != _parcelType) {
        setState(() => _parcelType = match.parcelType);
      }
    }
    _scheduleQuote();
  }

  void _onDeclaredValueChanged() {
    // Clearing the value clears the cover with it — a tier selected
    // against a value that no longer exists can't be priced, and the
    // server rejects that pair anyway.
    if (_declaredValueKes == null && _coverageTierId != null) {
      setState(() => _coverageTierId = null);
    }
    _loadTiers();
    _scheduleQuote();
  }

  /// Debounced because it re-runs on every edit to a type, zone, agent
  /// or declared value.
  void _scheduleQuote() {
    _quoteDebounce?.cancel();
    _quoteDebounce = Timer(const Duration(milliseconds: 350), _refreshQuote);
  }

  Future<void> _refreshQuote() async {
    final mine = ++_quoteSeq;
    if (mounted) setState(() => _quoteLoading = true);
    try {
      final quote = await ref.read(parcelsRepositoryProvider).getPricing(
            _parcelType,
            originZoneId: _originZoneId,
            destinationZoneId: _destinationZoneId,
            destinationAgentId: _collectFromAgent ? _destinationAgentId : null,
            declaredValueKes: _coverageTierId == null ? null : _declaredValueKes,
            coverageTierId: _coverageTierId,
          );
      if (!mounted || mine != _quoteSeq) return;
      setState(() {
        _quote = quote;
        _quoteLoading = false;
        _error = null;
        // A bargain reason picked against the old band may no longer
        // exist in the new one; dropping it is safer than carrying a
        // reason the server would reject at price time.
        if (_selectedReason != null &&
            !quote.bargainReasons.any((r) => r.reason == _selectedReason!.reason)) {
          _selectedReason = null;
        }
      });
    } on ApiException catch (e) {
      if (!mounted || mine != _quoteSeq) return;
      setState(() {
        _quoteLoading = false;
        _error = e.message;
      });
    }
  }

  // ── Commit ──────────────────────────────────────────────────────────

  void _continueToWho() {
    if (_origin.text.trim().isEmpty || _destination.text.trim().isEmpty) {
      setState(() => _error = 'Say where it is coming from and going to.');
      return;
    }
    if (_collectFromAgent && _destinationAgentId == null) {
      setState(() => _error = 'Choose a pickup point.');
      return;
    }
    if (_coverageTierId != null && _declaredValueKes == null) {
      setState(() => _error = 'Say what the contents are worth.');
      return;
    }
    setState(() {
      _error = null;
      _step = _Step.who;
    });
  }

  /// The one and only write: books the parcel and sets its price
  /// together, then goes straight to payment. A sender who changed
  /// their mind at the price step leaves nothing behind.
  Future<void> _bookAndPay() async {
    if ([
      _senderName,
      _senderMsisdn,
      _receiverName,
      _receiverMsisdn,
    ].any((c) => c.text.trim().isEmpty)) {
      setState(() => _error = 'Fill in both names and both phone numbers.');
      return;
    }
    final quote = _quote;
    if (quote == null) {
      setState(() => _error = 'Waiting for a price — try again in a moment.');
      return;
    }
    if (_isCod && _codAmountKes == null) {
      setState(() => _error = "Say what the buyer owes for the goods.");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repo = ref.read(parcelsRepositoryProvider);
      final booked = await repo.bookParcel(
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
        originLat: _originPin?.latitude,
        originLng: _originPin?.longitude,
        existingCode: _existingCode.text.trim(),
        destinationAgentId: _collectFromAgent ? _destinationAgentId : null,
        declaredValueKes: _coverageTierId == null ? null : _declaredValueKes,
        coverageTierId: _coverageTierId,
      );
      await repo.setPrice(
        code: booked.code,
        priceKes: _payableKes,
        bargainReason: _selectedReason?.reason,
      );
      if (_isCod) {
        // Delivery fee is always bundled into what the courier collects
        // at the door — see dbx.ConfirmParcelCodBooking's own comment:
        // that's what makes it possible to confirm this booking with
        // nothing prepaid. A seller who wants to prepay the fee and
        // only collect the goods value on delivery isn't offered that
        // here; it's a real combination the backend supports but not
        // one this first pass exposes.
        await repo.setCod(
          code: booked.code,
          codAmountKes: _codAmountKes!,
          collectDeliveryFee: true,
        );
        await repo.confirmCod(booked.code);
        if (!mounted) return;
        Navigator.of(context).pop(booked.code);
        return;
      }
      if (!mounted) return;
      // pushReplacement, not push — the booking form is done; payment
      // collapses into the same slot so a final pop lands back on the
      // parcels hub, the same collapsed-stage stack checkout uses.
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => ParcelPaymentScreen(
            code: booked.code,
            priceKes: _payableKes,
          ),
        ),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ── Build ───────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: EsoqoAppBar(
        title: _step == _Step.what ? 'Send a parcel' : 'Who is it for?',
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: ListView(
              padding: const EdgeInsets.all(EsoqoSpacing.s5),
              children: _step == _Step.what
                  ? _whatFields(context)
                  : _whoFields(context),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _whatFields(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    return [
      EsoqoSubHeader('Route'),
      const SizedBox(height: EsoqoSpacing.s2),
      EsoqoField.text(
        controller: _origin,
        label: 'Picking up from',
        hint: 'e.g. Westlands, opposite Sarit',
        icon: Icons.trip_origin,
      ),
      const SizedBox(height: EsoqoSpacing.s3),
      EsoqoField.text(
        controller: _destination,
        label: 'Delivering to',
        hint: 'e.g. Kisumu, Milimani estate',
        icon: Icons.place_outlined,
      ),
      const SizedBox(height: EsoqoSpacing.s3),
      // Roughly four in five Kenyans have no formal street address, and
      // addressing failure is this market's biggest cause of delivery
      // failure. A pin is what the courier's maps app can actually
      // route to; the text above is what a human reads on arrival.
      // Both are kept — neither replaces the other.
      _originPinField(context),
      if (_zones.isNotEmpty) ...[
        const SizedBox(height: EsoqoSpacing.s3),
        Text(
          'Pick the nearest hub on each end for a distance-aware price '
          'instead of the flat rate.',
          style: small,
        ),
        const SizedBox(height: EsoqoSpacing.s2),
        _zoneField(
          label: 'Origin hub',
          value: _originZoneId,
          onChanged: (v) => setState(() {
            _originZoneId = v;
            _scheduleQuote();
          }),
        ),
        const SizedBox(height: EsoqoSpacing.s3),
        _zoneField(
          label: 'Destination hub',
          value: _destinationZoneId,
          onChanged: (v) => setState(() {
            _destinationZoneId = v;
            _scheduleQuote();
          }),
        ),
      ],

      const SizedBox(height: EsoqoSpacing.s5),
      EsoqoSubHeader('Parcel details'),
      const SizedBox(height: EsoqoSpacing.s2),
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: EsoqoField.measure(
              controller: _weight,
              label: 'Weight (optional)',
              unit: 'kg',
              hint: 'e.g. 2.5',
              icon: Icons.scale_outlined,
            ),
          ),
          const SizedBox(width: EsoqoSpacing.s3),
          // Fixed width, not a bare Row child — an un-widthed
          // EsoqoSegmentedToggle throws "BoxConstraints forces an
          // infinite width" next to an Expanded sibling (see
          // SCREEN_CONVENTIONS.md).
          SizedBox(
            width: 96,
            child: EsoqoSegmentedToggle<String>(
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
        const SizedBox(height: EsoqoSpacing.s2),
        Text('Matched to ${parcelTypeLabel(_parcelType)}.', style: small),
      ],
      const SizedBox(height: EsoqoSpacing.s3),
      _parcelTypeField(),
      const SizedBox(height: EsoqoSpacing.s2),
      SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        title: const Text('Fragile'),
        value: _fragile,
        onChanged: (v) => setState(() => _fragile = v),
      ),

      // The cheap leg, offered as a real choice rather than buried.
      // Agent collection is what makes this competitive on price, so
      // the saving is stated at the point of choosing.
      if (_agents.isNotEmpty) ...[
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoSubHeader('How should it be delivered?'),
        const SizedBox(height: EsoqoSpacing.s2),
        _choiceCard(
          selected: !_collectFromAgent,
          title: 'To the door',
          subtitle: 'A courier brings it to the address above.',
          onTap: () => setState(() {
            _collectFromAgent = false;
            _destinationAgentId = null;
            _scheduleQuote();
          }),
        ),
        const SizedBox(height: EsoqoSpacing.s2),
        _choiceCard(
          selected: _collectFromAgent,
          title: 'Collect from a pickup point',
          subtitle: (_quote?.agentDropDiscountPct ?? 0) > 0
              ? 'The receiver picks it up from a nearby shop — '
                  '${_quote!.agentDropDiscountPct.toStringAsFixed(0)}% cheaper.'
              : 'The receiver picks it up from a nearby shop.',
          onTap: () => setState(() {
            _collectFromAgent = true;
            _scheduleQuote();
          }),
        ),
        if (_collectFromAgent) ...[
          const SizedBox(height: EsoqoSpacing.s3),
          DropdownButtonFormField<String>(
            initialValue: _destinationAgentId,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Pickup point',
              prefixIcon: Icon(Icons.storefront_outlined),
            ),
            items: [
              for (final a in _agents)
                DropdownMenuItem(
                  value: a.id,
                  child: Text('${a.name} — ${a.locationHint}',
                      overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (v) => setState(() {
              _destinationAgentId = v;
              _scheduleQuote();
            }),
          ),
          if (_chosenAgent?.openingHours != null) ...[
            const SizedBox(height: EsoqoSpacing.s1),
            Text('Open ${_chosenAgent!.openingHours}', style: small),
          ],
          if ((_chosenAgent?.holdingFeeKes ?? Money.zero).isPositive) ...[
            const SizedBox(height: EsoqoSpacing.s1),
            Text(
              'The receiver pays KES '
              '${_chosenAgent!.holdingFeeKes.format()} at the shop.',
              style: small,
            ),
          ],
        ],
      ],

      // Cover — optional, off by default. A sender who doesn't want it
      // never has to dismiss anything; a sender shipping something
      // valuable doesn't find out afterwards that nobody carried the risk.
      if (_tiers.isNotEmpty) ...[
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoSubHeader('Cover (optional)'),
        const SizedBox(height: EsoqoSpacing.s2),
        EsoqoField.amount(
          controller: _declaredValue,
          label: 'What are the contents worth?',
          hint: 'e.g. 8000',
        ),
        if (_declaredValueKes != null) ...[
          const SizedBox(height: EsoqoSpacing.s2),
          _choiceCard(
            selected: _coverageTierId == null,
            title: 'No cover',
            subtitle: 'Standard care, no payout if something goes wrong.',
            trailing: 'KES 0',
            onTap: () => setState(() {
              _coverageTierId = null;
              _scheduleQuote();
            }),
          ),
          for (final t in _tiers) ...[
            const SizedBox(height: EsoqoSpacing.s2),
            _choiceCard(
              selected: _coverageTierId == t.id,
              title: t.name,
              subtitle: t.capsDeclaredAmount
                  ? 'Covers up to KES ${t.coveredAmountKes.format()} '
                      'of the KES ${_declaredValueKes!.toStringAsFixed(0)} you declared'
                  : 'Covers the full KES ${t.coveredAmountKes.format()}',
              trailing: t.feeForValueKes.isPositive
                  ? '+KES ${t.feeForValueKes.format()}'
                  : 'Free',
              onTap: () => setState(() {
                _coverageTierId = t.id;
                _scheduleQuote();
              }),
            ),
          ],
        ],
      ],

      // The bargain engine, moved forward. No competitor in this market
      // lets a sender name a price, so it belongs where the sender is
      // deciding — not on a screen after they have already committed.
      if ((_quote?.bargainReasons.isNotEmpty ?? false)) ...[
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoSubHeader('Make an offer'),
        const SizedBox(height: EsoqoSpacing.s2),
        _choiceCard(
          selected: _selectedReason == null,
          title: 'Standard price',
          subtitle: _quote!.weightLabel,
          trailing: 'KES ${_quote!.minKes.format()}',
          onTap: () => setState(() => _selectedReason = null),
        ),
        for (final r in _quote!.bargainReasons) ...[
          const SizedBox(height: EsoqoSpacing.s2),
          _choiceCard(
            selected: _selectedReason?.reason == r.reason,
            title: r.reason,
            subtitle: '${r.extraDiscountPct.toStringAsFixed(0)}% off the usual minimum',
            trailing: 'KES ${_quote!.priceForReason(r).format()}',
            onTap: () => setState(() => _selectedReason = r),
          ),
        ],
      ],

      const SizedBox(height: EsoqoSpacing.s4),
      EsoqoField.text(
        controller: _notes,
        label: 'Notes for the courier (optional)',
        hint: 'e.g. Call on arrival',
      ),
      const SizedBox(height: EsoqoSpacing.s3),
      EsoqoField.code(
        controller: _existingCode,
        label: 'Pre-printed label code (optional)',
        hint: 'e.g. PKG-T7HZ967 — already on the parcel?',
      ),

      const SizedBox(height: EsoqoSpacing.s5),
      _priceSummary(context),
      if (_error != null) ...[
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoFormError(message: _error!),
      ],
      const SizedBox(height: EsoqoSpacing.s4),
      EsoqoButton.primary(
        expand: false,
        label: 'Continue',
        loading: _quoteLoading && _quote == null,
        onPressed: _continueToWho,
      ),
    ];
  }

  List<Widget> _whoFields(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    return [
      _priceSummary(context),
      const SizedBox(height: EsoqoSpacing.s5),
      EsoqoSubHeader('Sender'),
      const SizedBox(height: EsoqoSpacing.s2),
      EsoqoField.name(
        controller: _senderName,
        label: 'Your name',
      ),
      const SizedBox(height: EsoqoSpacing.s3),
      EsoqoField.phone(
        controller: _senderMsisdn,
        label: 'Your phone',
        textInputAction: TextInputAction.next,
      ),
      const SizedBox(height: EsoqoSpacing.s5),
      EsoqoSubHeader('Receiver'),
      const SizedBox(height: EsoqoSpacing.s2),
      EsoqoField.name(
        controller: _receiverName,
        label: 'Their name',
      ),
      const SizedBox(height: EsoqoSpacing.s3),
      EsoqoField.phone(
        controller: _receiverMsisdn,
        label: 'Their phone',
      ),
      const SizedBox(height: EsoqoSpacing.s2),
      Text(
        'We text the receiver their delivery code and a tracking link, so '
        'make sure this number is right.',
        style: small,
      ),
      if (_codPolicy?.enabled == true) ...[
        const SizedBox(height: EsoqoSpacing.s5),
        EsoqoSubHeader('Payment'),
        const SizedBox(height: EsoqoSpacing.s2),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          title: const Text('Buyer pays cash on delivery'),
          subtitle: const Text(
            "Nothing to pay now — the courier collects it, delivery fee "
            "included, when they hand the parcel over.",
          ),
          value: _isCod,
          onChanged: (v) => setState(() => _isCod = v),
        ),
        if (_isCod) ...[
          const SizedBox(height: EsoqoSpacing.s2),
          EsoqoField.amount(
            controller: _codAmount,
            label: 'Amount the buyer owes',
          ),
          const SizedBox(height: EsoqoSpacing.s2),
          Text(
            'Up to KES ${_codPolicy!.maxAmountKes.format()}. '
            '${_codPolicy!.handlingFeePct > 0 ? '${_codPolicy!.handlingFeePct.toStringAsFixed(0)}% handling fee deducted from your payout.' : ''}',
            style: small,
          ),
        ],
      ],
      if (_error != null) ...[
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoFormError(message: _error!),
      ],
      const SizedBox(height: EsoqoSpacing.s5),
      EsoqoButton.primary(
        expand: false,
        label: 'Pay KES ${_payableKes.format()}',
        loading: _busy,
        onPressed: _bookAndPay,
      ),
      const SizedBox(height: EsoqoSpacing.s2),
      Center(
        child: EsoqoButton.tertiary(
          label: 'Back to the price',
          onPressed: _busy ? null : () => setState(() => _step = _Step.what),
        ),
      ),
      const SizedBox(height: EsoqoSpacing.s2),
      Text(
        'Nothing is booked until this payment goes through.',
        style: small,
        textAlign: TextAlign.center,
      ),
    ];
  }

  /// The running total, broken down. Shown on both steps so the number
  /// never changes shape between deciding and paying.
  Widget _priceSummary(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    final quote = _quote;
    if (quote == null) {
      return EsoqoCard(
        child: Text(
          _quoteLoading ? 'Working out a price…' : 'Fill in the route for a price.',
          style: small,
        ),
      );
    }
    return EsoqoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(child: Text('Total to pay now', style: small)),
              Opacity(
                opacity: _quoteLoading ? 0.5 : 1,
                child: Text(
                  'KES ${_payableKes.format()}',
                  style: EsoqoTypography.mono(
                    fontSize: EsoqoTypeScale.sectionTitle,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: EsoqoSpacing.s1),
          Text(quote.weightLabel, style: small),
          if (quote.distanceKm != null)
            Text('${quote.distanceKm!.toStringAsFixed(1)} km between the hubs',
                style: small),
          if (_chosenAgent != null)
            Text('Collected from ${_chosenAgent!.name}', style: small),
          if ((quote.coverageFeeKes ?? Money.zero).isPositive)
            Text('Includes KES ${quote.coverageFeeKes!.format()} cover',
                style: small),
          if (_selectedReason != null)
            Text('Your offer: ${_selectedReason!.reason}', style: small),
        ],
      ),
    );
  }

  /// One selectable option row — delivery mode, cover level, price
  /// offer. Same shape in all three places so a choice always looks
  /// like a choice.
  Widget _choiceCard({
    required bool selected,
    required String title,
    required String subtitle,
    String? trailing,
    required VoidCallback onTap,
  }) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(EsoqoRadius.md),
      child: Container(
        padding: const EdgeInsets.all(EsoqoSpacing.s3),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(EsoqoRadius.md),
          border: Border.all(
            color: selected ? scheme.primary : EsoqoColors.line,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              selected ? Icons.check_circle : Icons.circle_outlined,
              size: 20,
              color: selected ? scheme.primary : EsoqoColors.line,
            ),
            const SizedBox(width: EsoqoSpacing.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: EsoqoSpacing.s2),
              Text(
                trailing,
                style: EsoqoTypography.mono(fontWeight: FontWeight.w700),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// "Pin this spot" for the pickup end.
  ///
  /// Optional and never blocking: a denied permission or a phone that
  /// can't see satellites leaves the booking exactly as it was before
  /// pins existed, which is a working booking with a text address.
  Widget _originPinField(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    if (_originPin != null) {
      return EsoqoCard(
        child: Row(
          children: [
            const Icon(Icons.my_location, size: 18),
            const SizedBox(width: EsoqoSpacing.s2),
            Expanded(
              child: Text(
                'Pickup pinned — the courier can navigate straight to it.',
                style: small,
              ),
            ),
            SizedBox(
              width: 72,
              child: EsoqoButton.tertiary(
                label: 'Clear',
                onPressed: () => setState(() => _originPin = null),
              ),
            ),
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        EsoqoButton.secondary(
          label: _pinning ? 'Getting your location…' : 'Pin this pickup spot',
          icon: Icons.my_location,
          expand: false,
          loading: _pinning,
          onPressed: _pinOrigin,
        ),
        const SizedBox(height: EsoqoSpacing.s1),
        Text(
          'Optional, but it is the difference between a courier finding '
          'you and phoning for directions.',
          style: small,
        ),
        if (_pinError != null) ...[
          const SizedBox(height: EsoqoSpacing.s1),
          Text(_pinError!, style: small),
        ],
      ],
    );
  }

  Future<void> _pinOrigin() async {
    setState(() {
      _pinning = true;
      _pinError = null;
    });
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        setState(() => _pinError = 'Location permission denied — the written address still works.');
        return;
      }
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() => _pinError = 'Turn on location services to pin this spot.');
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      if (mounted) setState(() => _originPin = position);
    } catch (_) {
      if (mounted) {
        setState(() => _pinError = 'Could not get your location. The written address still works.');
      }
    } finally {
      if (mounted) setState(() => _pinning = false);
    }
  }

  /// A plain, always-optional zone dropdown — `null` stays selectable
  /// so skipping zone selection entirely is one tap, not a dead end.
  Widget _zoneField({
    required String label,
    required String? value,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String?>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: const Icon(Icons.map_outlined),
      ),
      items: [
        const DropdownMenuItem<String?>(value: null, child: Text('None')),
        for (final z in _zones)
          DropdownMenuItem<String?>(value: z.id, child: Text(z.name)),
      ],
      onChanged: onChanged,
    );
  }

  /// A `DropdownButtonFormField` built by hand rather than through
  /// [EsoqoDropdown] — that shared widget takes an `initialValue`
  /// (uncontrolled, form-field style) that can't be moved
  /// programmatically once built, and weight-driven auto-selection
  /// needs exactly that. The `key: ValueKey(_parcelType)` is what makes
  /// it work: changing the key forces Flutter to treat a weight-driven
  /// change as a brand new field instance and pick up the new value.
  Widget _parcelTypeField() {
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
      decoration: const InputDecoration(
        labelText: 'Parcel type',
        prefixIcon: Icon(Icons.inventory_2_outlined),
      ),
      selectedItemBuilder: (context) => [
        for (final t in parcelTypes) Text(t.$2, overflow: TextOverflow.ellipsis),
      ],
      items: [
        for (final t in parcelTypes)
          DropdownMenuItem(
            value: t.$1,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: EsoqoSpacing.s1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(t.$2, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Builder(builder: (context) {
                    final p = pricingFor(t.$1);
                    if (p == null) return const SizedBox.shrink();
                    return Text(
                      '${p.weightLabel} · KES ${p.minKes.format()}–${p.maxKes.format()}',
                      style: Theme.of(context).textTheme.bodySmall,
                    );
                  }),
                ],
              ),
            ),
          ),
      ],
      onChanged: (v) => setState(() {
        _parcelType = v ?? _parcelType;
        _scheduleQuote();
      }),
    );
  }
}
