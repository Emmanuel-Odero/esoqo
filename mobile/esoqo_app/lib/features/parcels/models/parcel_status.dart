import 'parcel_places.dart';

/// The guest-safe status pill projection — wire type matching Go's
/// dbx.ParcelStatusView. No sender/receiver name or phone: same
/// PII-minimal rule every other public scan result in this app follows.
class ParcelStatusView {
  ParcelStatusView({
    required this.code,
    required this.status,
    required this.originLabel,
    required this.destinationLabel,
    required this.parcelType,
    this.priceKes,
    this.collectionScheduledAt,
    required this.createdAt,
    this.deliveredAt,
    this.cancellationReason,
    this.cancelledAt,
    this.receiptConfirmedAt,
    this.slaDeadlineAt,
    this.deliveryAttempts = 0,
    this.lastAttemptAt,
    this.lastAttemptReason,
    this.lastAttemptText,
    this.podPhotoUrl,
    this.podReceivedByName,
    this.podMethod,
    this.agent,
    this.preLabel = false,
    this.preLabelInfo,
  });

  factory ParcelStatusView.fromJson(Map<String, dynamic> json) =>
      ParcelStatusView(
        code: json['code'] as String,
        status: json['status'] as String,
        originLabel: json['originLabel'] as String,
        destinationLabel: json['destinationLabel'] as String,
        parcelType: json['parcelType'] as String? ?? 'SMALL',
        priceKes: json['priceKes'] as String?,
        collectionScheduledAt: json['collectionScheduledAt'] == null
            ? null
            : DateTime.tryParse(json['collectionScheduledAt'] as String),
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ??
                DateTime.now(),
        deliveredAt: json['deliveredAt'] == null
            ? null
            : DateTime.tryParse(json['deliveredAt'] as String),
        cancellationReason: json['cancellationReason'] as String?,
        cancelledAt: json['cancelledAt'] == null
            ? null
            : DateTime.tryParse(json['cancelledAt'] as String),
        receiptConfirmedAt: json['receiptConfirmedAt'] == null
            ? null
            : DateTime.tryParse(json['receiptConfirmedAt'] as String),
        slaDeadlineAt: json['slaDeadlineAt'] == null
            ? null
            : DateTime.tryParse(json['slaDeadlineAt'] as String),
        deliveryAttempts: (json['deliveryAttempts'] as num?)?.toInt() ?? 0,
        lastAttemptAt: json['lastAttemptAt'] == null
            ? null
            : DateTime.tryParse(json['lastAttemptAt'] as String),
        lastAttemptReason: json['lastAttemptReason'] as String?,
        lastAttemptText: json['lastAttemptText'] as String?,
        podPhotoUrl: json['podPhotoUrl'] as String?,
        podReceivedByName: json['podReceivedByName'] as String?,
        podMethod: json['podMethod'] as String?,
        agent: json['agent'] == null
            ? null
            : ParcelAgentStop.fromJson(json['agent'] as Map<String, dynamic>),
        preLabel: json['preLabel'] as bool? ?? false,
        preLabelInfo: json['preLabelInfo'] == null
            ? null
            : ParcelLabelInfo.fromJson(
                json['preLabelInfo'] as Map<String, dynamic>),
      );

  final String code;
  final String status; // DRAFT_PENDING_PAYMENT | BOOKED | PICKED_UP | IN_TRANSIT | DELIVERED | CANCELLED | LABEL_PRINTED
  final String originLabel;
  final String destinationLabel;
  final String parcelType;
  final String? priceKes;
  final DateTime? collectionScheduledAt;
  final DateTime createdAt;
  final DateTime? deliveredAt;
  final String? cancellationReason;
  final DateTime? cancelledAt;
  final DateTime? receiptConfirmedAt;

  /// The delivery promise, frozen at payment time — what lets the
  /// tracking page say "arriving by 4pm" instead of showing a stepper
  /// with no sense of time.
  final DateTime? slaDeadlineAt;

  // Failed-attempt summary. A receiver who was out needs to know an
  // attempt happened and why far more than they need the status
  // string; without these a FAILED_DELIVERY parcel reads as "stuck"
  // with no explanation and no obvious next step.
  final int deliveryAttempts;
  final DateTime? lastAttemptAt;
  final String? lastAttemptReason;
  final String? lastAttemptText;

  // Proof of delivery — a narrow, deliberate departure from this
  // projection's PII-minimal rule (see dbx.ParcelStatusView): the whole
  // value of POD is that sender and receiver can settle "who actually
  // took it" between themselves, and the tracking code is by design
  // the credential only those two hold.
  final String? podPhotoUrl;
  final String? podReceivedByName;
  final String? podMethod;

  /// Where to collect it, when the parcel is on a pickup point's shelf
  /// (HELD_AT_AGENT). Null for a doorstep delivery.
  final ParcelAgentStop? agent;

  // preLabel/preLabelInfo — a pre-printed label (see
  // dbx.ParcelLabelStock) that was scanned/tracked before ever
  // becoming a real booking. status reads "LABEL_PRINTED" in that
  // case; every other field above is meaningless (blank/zero) except
  // createdAt. preLabelInfo is null until at least an item description
  // has been attached in the field (see the admin "Attach info to a
  // label" screen), even for a genuinely pre-printed (but still blank)
  // label.
  final bool preLabel;
  final ParcelLabelInfo? preLabelInfo;
}

/// The structured info a handler attached to a pre-printed label in
/// the field — wire type matching Go's dbx.ParcelLabelInfo.
class ParcelLabelInfo {
  ParcelLabelInfo({
    required this.itemDescription,
    this.destination,
    this.senderName,
    this.senderMsisdn,
    this.receiverName,
    this.receiverMsisdn,
    this.itemType,
    this.weightRangeKg,
    required this.attachedAt,
  });

  factory ParcelLabelInfo.fromJson(Map<String, dynamic> json) =>
      ParcelLabelInfo(
        itemDescription: json['itemDescription'] as String,
        destination: json['destination'] as String?,
        senderName: json['senderName'] as String?,
        senderMsisdn: json['senderMsisdn'] as String?,
        receiverName: json['receiverName'] as String?,
        receiverMsisdn: json['receiverMsisdn'] as String?,
        itemType: json['itemType'] as String?,
        weightRangeKg: json['weightRangeKg'] as String?,
        attachedAt:
            DateTime.tryParse(json['attachedAt'] as String? ?? '') ??
                DateTime.now(),
      );

  final String itemDescription;
  final String? destination;
  final String? senderName;
  final String? senderMsisdn;
  final String? receiverName;
  final String? receiverMsisdn;
  final String? itemType;
  final String? weightRangeKg;
  final DateTime attachedAt;
}

/// The label projection a handler/courier prints and sticks on the
/// physical parcel — wire type matching dbx.ParcelLabel (GET
/// /v1/parcels/:code/label). Deliberately thin: no phone numbers
/// beyond the last 4 digits, no price, no sender/receiver address —
/// see that struct's own comment for why a label stays PII-minimal.
class ParcelLabel {
  ParcelLabel({
    required this.code,
    required this.status,
    required this.parcelType,
    this.weightKg,
    required this.originLabel,
    required this.destinationLabel,
    required this.receiverName,
    required this.receiverPhoneLast4,
    required this.createdAt,
    this.destinationLat,
    this.destinationLng,
  });

  factory ParcelLabel.fromJson(Map<String, dynamic> json) => ParcelLabel(
    code: json['code'] as String,
    status: json['status'] as String,
    parcelType: json['parcelType'] as String,
    weightKg: (json['weightKg'] as num?)?.toDouble(),
    originLabel: json['originLabel'] as String,
    destinationLabel: json['destinationLabel'] as String,
    receiverName: json['receiverName'] as String,
    receiverPhoneLast4: json['receiverPhoneLast4'] as String? ?? '',
    createdAt:
        DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
    destinationLat: (json['destinationLat'] as num?)?.toDouble(),
    destinationLng: (json['destinationLng'] as num?)?.toDouble(),
  );

  final String code;
  final String status;
  final String parcelType;
  final double? weightKg;
  final String originLabel;
  final String destinationLabel;
  final String receiverName;
  final String receiverPhoneLast4;
  final DateTime createdAt;

  // The destination pin, for the one person who needs to navigate to
  // it. Behind the same custody gate the rest of this projection is —
  // a pin is more precise than the free-text label and has no business
  // on the guest-safe view, or printed in the open on a box.
  final double? destinationLat;
  final double? destinationLng;

  /// True only when both halves are present. Half a pin is not a
  /// location, and offering "navigate" on one would send a courier
  /// somewhere confidently wrong — worse than the written label.
  bool get hasDestinationPin =>
      destinationLat != null && destinationLng != null;
}

const parcelStatusStages = [
  ('BOOKED', 'Booked'),
  ('PICKED_UP', 'Picked up'),
  ('IN_TRANSIT', 'In transit'),
  ('DELIVERED', 'Delivered'),
];

/// Short, human status text. Every list in this app used to render the
/// raw enum — a sender genuinely saw "PKG-X · IN_TRANSIT" in their Sent
/// list while the detail screen beside it showed a written sentence.
/// A status string is a database value; it is never what a person
/// should read. Mirrors apps/web's STATUS_LABEL so the two clients
/// never describe the same parcel differently.
const _parcelStatusLabels = {
  'DRAFT_PENDING_PAYMENT': 'Draft — not paid',
  'BOOKED': 'Booked',
  'PICKED_UP': 'Picked up',
  'IN_TRANSIT': 'In transit',
  'HELD_AT_AGENT': 'Waiting at a pickup point',
  'FAILED_DELIVERY': 'Delivery attempt failed',
  'DELIVERED': 'Delivered',
  'CANCELLED': 'Cancelled',
  'RETURNED_TO_SENDER': 'Returned to sender',
  'LABEL_PRINTED': 'Label printed, not booked',
};

String parcelStatusLabel(String status) => _parcelStatusLabels[status] ?? status;

/// True for a status that isn't a point on [parcelStatusStages].
///
/// The timeline is the happy path. A cancelled or failed parcel has no
/// place on it, and forcing one on would draw a stepper that implies
/// the parcel is still moving.
bool parcelStatusIsOffTimeline(String status) =>
    !parcelStatusStages.any((s) => s.$1 == status);

/// Real, per-status sentences for [ParcelStatusScreen] — replaces a
/// bare enum label with the same "who/what/next step" tone
/// notify.Parcel* uses for SMS, so the in-app copy and the text the
/// sender gets are never at odds with each other.
String parcelStatusMessage(ParcelStatusView status) {
  switch (status.status) {
    case 'DRAFT_PENDING_PAYMENT':
      return 'This booking is still a draft — finish paying to confirm it.';
    case 'BOOKED':
      if (status.collectionScheduledAt != null) {
        return 'Collection is scheduled — someone will come by for it soon.';
      }
      return "Booked and paid. We'll text you once it's on its way.";
    case 'PICKED_UP':
      return 'Picked up and on its way to ${status.destinationLabel}.';
    case 'IN_TRANSIT':
      return 'In transit to ${status.destinationLabel}.';
    case 'DELIVERED':
      return 'Delivered to ${status.destinationLabel}.';
    case 'CANCELLED':
      return status.cancellationReason == null
          ? 'Cancelled — see your SMS for details.'
          : 'Cancelled — ${status.cancellationReason}.';
    case 'LABEL_PRINTED':
      return status.preLabelInfo == null
          ? "This is a pre-printed label — it hasn't been attached to a shipment yet."
          : 'Pre-printed label — attached to: ${status.preLabelInfo!.itemDescription}';
    default:
      return status.status;
  }
}

/// Why a delivery attempt failed. Fixed options rather than free text
/// because these drive what the receiver is told and what the courier
/// is asked to do next — but OTHER always ships with its own free-text
/// field, the same rule every other "Other" choice in this codebase
/// follows.
const parcelAttemptReasons = [
  ('RECEIVER_UNREACHABLE', 'Nobody answered'),
  ('WRONG_ADDRESS', 'Address was wrong'),
  ('RECEIVER_ABSENT', 'Receiver was out'),
  ('REFUSED', 'Receiver refused it'),
  ('ACCESS_BLOCKED', 'Could not get in'),
  ('OTHER', 'Something else'),
];

/// A timestamp as somebody would say it out loud — "12 minutes ago",
/// "yesterday", "on 3 Feb". Null renders as an em dash rather than an
/// empty gap, so a missing time reads as missing rather than broken.
String parcelHumanTime(DateTime? at) {
  if (at == null) return '—';
  final now = DateTime.now();
  final local = at.toLocal();
  final diff = now.difference(local);

  if (diff.isNegative) {
    final ahead = local.difference(now);
    if (ahead.inMinutes < 60) return 'in ${ahead.inMinutes} min';
    if (ahead.inHours < 24) return 'in ${ahead.inHours}h';
    return 'on ${_shortDate(local)}';
  }
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) {
    return '${diff.inMinutes} ${diff.inMinutes == 1 ? 'minute' : 'minutes'} ago';
  }
  if (diff.inHours < 24) {
    return '${diff.inHours} ${diff.inHours == 1 ? 'hour' : 'hours'} ago';
  }
  if (diff.inDays == 1) return 'yesterday';
  if (diff.inDays < 7) return '${diff.inDays} days ago';
  return 'on ${_shortDate(local)}';
}

const _monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _shortDate(DateTime at) {
  final month = _monthNames[at.month - 1];
  final now = DateTime.now();
  if (at.year == now.year) return '${at.day} $month';
  return '${at.day} $month ${at.year}';
}

/// The delivery promise, phrased as one. Null when there's no SLA for
/// the type or the parcel is already closed — "arriving by" on a
/// delivered parcel is noise, and on an overdue one it's worse than
/// noise, so that case gets its own honest wording instead.
String? parcelEtaText(ParcelStatusView status) {
  const closed = {'DELIVERED', 'CANCELLED', 'RETURNED_TO_SENDER'};
  if (closed.contains(status.status) || status.slaDeadlineAt == null) {
    return null;
  }
  if (status.slaDeadlineAt!.isBefore(DateTime.now())) {
    return 'Running later than promised — we\'re on it.';
  }
  return 'Arriving by ${parcelHumanTime(status.slaDeadlineAt)}';
}
