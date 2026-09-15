import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/api/api_exception.dart';
import '../../core/money/money.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_models.dart';
import 'parcels_repository.dart';

/// Everything a courier does at the door, on one screen.
///
/// This replaces a bare [AlertDialog] with a single text field, which
/// was the entire delivery flow: type the receiver's code, done. That
/// had two holes big enough to sink a pilot.
///
/// The first is evidence. A delivery code proves the receiver knew a
/// code; it never proved the parcel physically changed hands, or to
/// whom. A photo, a GPS stamp and the name of whoever actually signed
/// for it (very often a watchman or a shop attendant, not the receiver)
/// are what turn "it says delivered but I never got it" from an
/// argument into a question with an answer.
///
/// The second is failure. There was no way at all to say "I got there
/// and couldn't hand it over" — the courier just kept carrying the
/// parcel while it aged past its SLA and showed up in the admin's
/// overdue KPI as their fault. The three tabs here are the three things
/// that actually happen at a doorstep: it works, it doesn't, or you
/// leave it somewhere the receiver can get it.
class CompleteDeliveryScreen extends ConsumerStatefulWidget {
  const CompleteDeliveryScreen({super.key, required this.parcel});

  final ParcelRow parcel;

  @override
  ConsumerState<CompleteDeliveryScreen> createState() =>
      _CompleteDeliveryScreenState();
}

enum _Outcome { delivered, failed, leftAtAgent }

class _CompleteDeliveryScreenState extends ConsumerState<CompleteDeliveryScreen> {
  _Outcome _outcome = _Outcome.delivered;

  final _deliveryCode = TextEditingController();
  final _receivedBy = TextEditingController();
  final _attemptNote = TextEditingController();
  final _codCollected = TextEditingController();

  String _attemptReason = parcelAttemptReasons.first.$1;
  String? _agentId;
  List<ParcelAgent> _agents = const [];

  XFile? _photo;
  Uint8List? _photoBytes;
  Position? _position;

  bool _busy = false;
  bool _scanning = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Fired once, not awaited: a courier standing at a gate should not
    // wait on a GPS fix before they can type a code. Whatever has
    // arrived by the time they submit is what gets stamped, and nothing
    // fails if none has.
    _locate();
    _loadAgents();
    // Pre-filled with what the buyer owes, because that is what gets
    // collected almost every time — a courier should confirm a number,
    // not compute one at a gate. It stays editable for the short
    // payment that does happen.
    if (widget.parcel.needsCodCollection) {
      _codCollected.text = widget.parcel.codExpectedKes.format();
    }
  }

  @override
  void dispose() {
    _deliveryCode.dispose();
    _receivedBy.dispose();
    _attemptNote.dispose();
    _codCollected.dispose();
    super.dispose();
  }

  Future<void> _locate() async {
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }
      if (!await Geolocator.isLocationServiceEnabled()) return;
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
      );
      if (mounted) setState(() => _position = position);
    } catch (_) {
      // A missing fix weakens the record; it never blocks the delivery.
      // Refusing to let a courier close a parcel because a phone
      // couldn't see satellites inside a stairwell would be worse than
      // the gap it prevents.
    }
  }

  Future<void> _loadAgents() async {
    try {
      final agents = await ref.read(parcelsRepositoryProvider).listAgents();
      if (mounted) {
        setState(() => _agents = agents.where((a) => !a.isFull).toList());
      }
    } on ApiException {
      // No pickup points configured (or unreachable) just means that
      // tab has nothing to offer — the other two still work.
    }
  }

  Future<void> _takePhoto() async {
    try {
      final shot = await ImagePicker().pickImage(
        source: ImageSource.camera,
        // Resized and recompressed on the device rather than shipped at
        // full sensor resolution: this upload happens on a courier's
        // own mobile data, at a gate, on whatever signal exists there.
        // 1600px is still far more than enough to read a door number.
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 70,
      );
      if (shot == null) return;
      final bytes = await shot.readAsBytes();
      if (mounted) {
        setState(() {
          _photo = shot;
          _photoBytes = bytes;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not open the camera.');
    }
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final repo = ref.read(parcelsRepositoryProvider);
    try {
      switch (_outcome) {
        case _Outcome.delivered:
          // A parcel already on an agent's shelf is collected in person
          // at the counter, where the agent has identified the receiver
          // — that's what the shop leg is for, and dbx.DeliverParcel
          // accepts an empty code in exactly that case. Requiring one
          // here anyway would turn away a receiver who walked to the
          // shop because the SMS with their code never arrived.
          if (_deliveryCode.text.trim().isEmpty && !_atAgent) {
            setState(() => _error = 'Ask the receiver for their delivery code.');
            return;
          }
          if (_deliveryCode.text.trim().isEmpty &&
              _receivedBy.text.trim().isEmpty) {
            setState(() => _error = 'Write down who collected it.');
            return;
          }
          Money? codCollected;
          if (widget.parcel.needsCodCollection) {
            codCollected = Money.tryParse(_codCollected.text.trim());
            if (codCollected == null || codCollected.isNegative) {
              setState(() => _error = 'Enter what the buyer paid.');
              return;
            }
          }
          String? photoKey;
          if (_photoBytes != null) {
            photoKey = await repo.uploadPodPhoto(
              code: widget.parcel.code,
              bytes: _photoBytes!,
            );
          }
          await repo.deliver(
            code: widget.parcel.code,
            deliveryCode: _deliveryCode.text.trim(),
            photoKey: photoKey,
            lat: _position?.latitude,
            lng: _position?.longitude,
            receivedByName: _receivedBy.text.trim(),
            codCollectedKes: codCollected,
          );
        case _Outcome.failed:
          if (_attemptReason == 'OTHER' && _attemptNote.text.trim().isEmpty) {
            setState(() => _error = 'Say what happened.');
            return;
          }
          await repo.recordAttempt(
            code: widget.parcel.code,
            reason: _attemptReason,
            note: _attemptNote.text.trim(),
            lat: _position?.latitude,
            lng: _position?.longitude,
          );
        case _Outcome.leftAtAgent:
          if (_agentId == null) {
            setState(() => _error = 'Pick the shop you left it at.');
            return;
          }
          await repo.holdAtAgent(code: widget.parcel.code, agentId: _agentId!);
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// True when this parcel is already sitting on a pickup point's
  /// shelf — the collection-at-the-counter case, where the delivery
  /// code is preferred but not required.
  bool get _atAgent => widget.parcel.status == 'HELD_AT_AGENT';

  String get _submitLabel => switch (_outcome) {
        _Outcome.delivered => 'Confirm delivery',
        _Outcome.failed => 'Record failed attempt',
        _Outcome.leftAtAgent => 'Leave at this shop',
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: EsoqoAppBar(title: widget.parcel.code),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: ListView(
              padding: const EdgeInsets.all(EsoqoSpacing.s4),
              children: [
                Text(
                  'To ${widget.parcel.receiverName}',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                Text(
                  widget.parcel.destinationLabel,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (widget.parcel.deliveryAttempts > 0) ...[
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoInlineNotice(
                    color: EsoqoColors.amber,
                    icon: EsoqoIconName.alertTriangle,
                    message: widget.parcel.deliveryAttempts == 1
                        ? 'This is the second attempt at this parcel.'
                        : 'Already tried ${widget.parcel.deliveryAttempts} times. '
                            'After three, it goes back to the sender.',
                  ),
                ],
                const SizedBox(height: EsoqoSpacing.s4),

                EsoqoSegmentedToggle<_Outcome>(
                  selected: _outcome,
                  onChanged: (v) => setState(() {
                    _outcome = v;
                    _error = null;
                  }),
                  options: const [
                    (_Outcome.delivered, 'Handed over'),
                    (_Outcome.failed, "Couldn't"),
                    (_Outcome.leftAtAgent, 'Left at shop'),
                  ],
                ),
                const SizedBox(height: EsoqoSpacing.s4),

                if (_outcome == _Outcome.delivered) ..._deliveredFields(context),
                if (_outcome == _Outcome.failed) ..._failedFields(context),
                if (_outcome == _Outcome.leftAtAgent) ..._agentFields(context),

                if (_error != null) ...[
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoFormError(message: _error!),
                ],
                const SizedBox(height: EsoqoSpacing.s5),
                EsoqoButton.primary(
                  expand: false,
                  label: _submitLabel,
                  loading: _busy,
                  onPressed: _submit,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// What to collect, shown before anything else on the delivered tab.
  ///
  /// A courier's first question at a COD door is "how much do I ask
  /// for", and getting it from them after they have already handed the
  /// parcel over is too late. The expected figure is stated in full and
  /// broken down, because "KES 2,500" without "2,000 goods + 500
  /// delivery" is exactly the ambiguity that starts an argument on a
  /// doorstep.
  List<Widget> _codFields(BuildContext context) {
    final parcel = widget.parcel;
    if (!parcel.needsCodCollection) return const [];
    final small = Theme.of(context).textTheme.bodySmall;
    final goods = parcel.codAmountKes ?? Money.zero;
    final fee = parcel.codDeliveryFeeKes;
    return [
      EsoqoCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Collect from the buyer', style: small),
            const SizedBox(height: EsoqoSpacing.s1),
            Text(
              'KES ${parcel.codExpectedKes.format()}',
              style: EsoqoTypography.mono(fontSize: EsoqoTypeScale.pageTitle, fontWeight: FontWeight.w700),
            ),
            Text(
              fee.isPositive
                  ? 'KES ${goods.format()} for the goods '
                      '+ KES ${fee.format()} delivery'
                  : 'For the goods. Delivery was already paid.',
              style: small,
            ),
            const SizedBox(height: EsoqoSpacing.s3),
            EsoqoField.amount(
              controller: _codCollected,
              label: 'What did they actually pay?',
              onChanged: (_) => setState(() {}),
            ),
            // The shortfall is named the moment it appears, not
            // discovered at settlement a week later. The seller gets
            // texted the same number.
            Builder(builder: (context) {
              final paid = Money.tryParse(_codCollected.text.trim());
              if (paid == null) return const SizedBox.shrink();
              final short = parcel.codExpectedKes - paid;
              // No epsilon. This used to read `short <= 0.004` because
              // the double subtraction invented shortfalls of ~1e-14 on
              // orders that were paid in full (see money_test.dart's
              // "the 0.004 epsilon workaround is no longer needed").
              // With exact cents, "not short" is exactly `!isPositive`.
              if (!short.isPositive) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(top: EsoqoSpacing.s2),
                child: EsoqoInlineNotice(
                  color: EsoqoColors.amber,
                  icon: EsoqoIconName.alertTriangle,
                  // .format() keeps the cents when there are cents: a
                  // one-cent shortfall used to render "KES 0 short"
                  // through toStringAsFixed(0).
                  message: 'KES ${short.format()} short. '
                      'The delivery fee is covered first, so the seller is paid less. '
                      'They get a text saying so.',
                ),
              );
            }),
          ],
        ),
      ),
      const SizedBox(height: EsoqoSpacing.s4),
    ];
  }

  List<Widget> _deliveredFields(BuildContext context) => [
        ..._codFields(context),
        // Scanning first, typing second. A delivery code is six
        // characters read aloud at a gate; the courier's own app made
        // them retype it by hand while the public web tracker had a QR
        // scanner, which is exactly backwards.
        Row(
          children: [
            Expanded(
              child: EsoqoField.code(
                controller: _deliveryCode,
                label: _atAgent ? 'Delivery code (optional)' : 'Delivery code',
                hint: _atAgent ? 'Or just note who collected it' : 'Ask the receiver',
              ),
            ),
            const SizedBox(width: EsoqoSpacing.s2),
            SizedBox(
              width: 56,
              child: IconButton.filledTonal(
                onPressed: () => setState(() => _scanning = !_scanning),
                icon: Icon(_scanning ? Icons.close : Icons.qr_code_scanner),
                tooltip: _scanning ? 'Close scanner' : 'Scan the code',
              ),
            ),
          ],
        ),
        if (_scanning) ...[
          const SizedBox(height: EsoqoSpacing.s3),
          SizedBox(
            height: 220,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(EsoqoRadius.md),
              child: MobileScanner(
                onDetect: (cap) {
                  final v = cap.barcodes.firstOrNull?.rawValue;
                  if (v == null) return;
                  setState(() {
                    _deliveryCode.text = v.trim().toUpperCase();
                    _scanning = false;
                  });
                },
              ),
            ),
          ),
        ],
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoField.name(
          controller: _receivedBy,
          label: 'Who received it?',
          hint: 'e.g. the watchman, a neighbour',
        ),
        const SizedBox(height: EsoqoSpacing.s3),
        _photoField(context),
        const SizedBox(height: EsoqoSpacing.s2),
        _locationNote(context),
      ];

  List<Widget> _failedFields(BuildContext context) => [
        Text(
          'The receiver gets a text explaining why, so pick the closest reason.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: EsoqoSpacing.s3),
        DropdownButtonFormField<String>(
          initialValue: _attemptReason,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: 'What happened?',
            prefixIcon: Icon(Icons.error_outline),
          ),
          items: [
            for (final r in parcelAttemptReasons)
              DropdownMenuItem(value: r.$1, child: Text(r.$2)),
          ],
          onChanged: (v) => setState(() => _attemptReason = v ?? _attemptReason),
        ),
        // "Something else" always carries a mandatory note — the same
        // rule every other Other choice in this app follows, and here
        // the note is literally what the receiver reads in their SMS.
        if (_attemptReason == 'OTHER') ...[
          const SizedBox(height: EsoqoSpacing.s3),
          EsoqoField.text(
            controller: _attemptNote,
            label: 'Say what happened',
            hint: 'e.g. the gate was locked',
          ),
        ],
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoInlineNotice(
          color: EsoqoColors.navy,
          icon: EsoqoIconName.info,
          message: 'You keep the parcel. It stays in your Holding list so you '
              'can try again or leave it at a shop.',
        ),
        const SizedBox(height: EsoqoSpacing.s2),
        _locationNote(context),
      ];

  List<Widget> _agentFields(BuildContext context) {
    if (_agents.isEmpty) {
      return [
        EsoqoInlineNotice(
          color: EsoqoColors.amber,
          icon: EsoqoIconName.alertTriangle,
          message: 'No pickup points are available right now.',
        ),
      ];
    }
    final chosen = _agents.where((a) => a.id == _agentId).firstOrNull;
    return [
      Text(
        'The receiver gets a text with the shop name, where it is and when '
        "it's open.",
        style: Theme.of(context).textTheme.bodySmall,
      ),
      const SizedBox(height: EsoqoSpacing.s3),
      DropdownButtonFormField<String>(
        initialValue: _agentId,
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: 'Which shop?',
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
        onChanged: (v) => setState(() => _agentId = v),
      ),
      if (chosen != null) ...[
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(chosen.name,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              Text(chosen.locationHint,
                  style: Theme.of(context).textTheme.bodySmall),
              if (chosen.openingHours != null)
                Text('Open ${chosen.openingHours}',
                    style: Theme.of(context).textTheme.bodySmall),
              Text('${chosen.capacity - chosen.parcelsHeld} spaces left',
                  style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ],
    ];
  }

  Widget _photoField(BuildContext context) {
    return EsoqoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('Photo', style: TextStyle(fontWeight: FontWeight.w700)),
              ),
              SizedBox(
                width: 120,
                child: EsoqoButton.secondary(
                  label: _photo == null ? 'Take' : 'Retake',
                  icon: Icons.photo_camera_outlined,
                  expand: false,
                  onPressed: _takePhoto,
                ),
              ),
            ],
          ),
          const SizedBox(height: EsoqoSpacing.s1),
          Text(
            _photo == null
                ? 'Optional, but it settles any argument later.'
                : 'Photo attached.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (_photoBytes != null) ...[
            const SizedBox(height: EsoqoSpacing.s2),
            ClipRRect(
              borderRadius: BorderRadius.circular(EsoqoRadius.sm),
              child: Image.memory(
                _photoBytes!,
                height: 140,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _locationNote(BuildContext context) => Text(
        _position == null
            ? 'Waiting for a location fix — not required.'
            : 'Location will be recorded with this.',
        style: Theme.of(context).textTheme.bodySmall,
      );
}
