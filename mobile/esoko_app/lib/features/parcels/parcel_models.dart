/// The guest-safe status pill projection — wire type matching Go's
/// dbx.ParcelStatusView. No sender/receiver name or phone: same
/// PII-minimal rule every other public scan result in this app follows.
class ParcelStatusView {
  ParcelStatusView({
    required this.code,
    required this.status,
    required this.originLabel,
    required this.destinationLabel,
    required this.createdAt,
    this.deliveredAt,
  });

  factory ParcelStatusView.fromJson(Map<String, dynamic> json) =>
      ParcelStatusView(
        code: json['code'] as String,
        status: json['status'] as String,
        originLabel: json['originLabel'] as String,
        destinationLabel: json['destinationLabel'] as String,
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ??
                DateTime.now(),
        deliveredAt: json['deliveredAt'] == null
            ? null
            : DateTime.tryParse(json['deliveredAt'] as String),
      );

  final String code;
  final String status; // BOOKED | PICKED_UP | IN_TRANSIT | DELIVERED
  final String originLabel;
  final String destinationLabel;
  final DateTime createdAt;
  final DateTime? deliveredAt;
}

/// One line on "parcels I sent" or "parcels I'm holding" — wire type
/// matching dbx.ParcelRow. deliveryCode only populates on the sender's
/// own list.
class ParcelRow {
  ParcelRow({
    required this.id,
    required this.code,
    this.deliveryCode,
    required this.senderName,
    required this.receiverName,
    required this.originLabel,
    required this.destinationLabel,
    required this.status,
    required this.createdAt,
    this.deliveredAt,
  });

  factory ParcelRow.fromJson(Map<String, dynamic> json) => ParcelRow(
    id: json['ID'] as String,
    code: json['Code'] as String,
    deliveryCode: json['DeliveryCode'] as String?,
    senderName: json['SenderName'] as String,
    receiverName: json['ReceiverName'] as String,
    originLabel: json['OriginLabel'] as String,
    destinationLabel: json['DestinationLabel'] as String,
    status: json['Status'] as String,
    createdAt:
        DateTime.tryParse(json['CreatedAt'] as String? ?? '') ?? DateTime.now(),
    deliveredAt: json['DeliveredAt'] == null
        ? null
        : DateTime.tryParse(json['DeliveredAt'] as String),
  );

  final String id;
  final String code;
  final String? deliveryCode;
  final String senderName;
  final String receiverName;
  final String originLabel;
  final String destinationLabel;
  final String status;
  final DateTime createdAt;
  final DateTime? deliveredAt;
}

const parcelStatusStages = [
  ('BOOKED', 'Booked'),
  ('PICKED_UP', 'Picked up'),
  ('IN_TRANSIT', 'In transit'),
  ('DELIVERED', 'Delivered'),
];
