/// Wire types matching core-go's Go struct JSON — see
/// services/core-go/internal/dbx/ticketing.go.
class ListingSummary {
  ListingSummary({
    required this.id, required this.slug, required this.title, this.coverUrl,
    required this.vertical, this.venueOrRouteLabel, this.fromPriceKes,
  });

  factory ListingSummary.fromJson(Map<String, dynamic> json) => ListingSummary(
        id: json['ID'] as String,
        slug: json['Slug'] as String,
        title: json['Title'] as String,
        coverUrl: json['CoverURL'] as String?,
        vertical: json['Vertical'] as String,
        venueOrRouteLabel: json['VenueOrRouteLabel'] as String?,
        fromPriceKes: json['FromPriceKES'] as String?,
      );

  final String id;
  final String slug;
  final String title;
  final String? coverUrl;
  final String vertical; // EVENTS | TRANSPORT
  final String? venueOrRouteLabel;
  final String? fromPriceKes;

  bool get isTransport => vertical == 'TRANSPORT';
}

class TicketClass {
  TicketClass({required this.id, required this.name, required this.priceKes, required this.seated, required this.capacity, this.amenities = const []});

  factory TicketClass.fromJson(Map<String, dynamic> json) => TicketClass(
        id: json['ID'] as String,
        name: json['Name'] as String,
        priceKes: json['PriceKES'] as String,
        seated: json['Seated'] as bool? ?? false,
        capacity: json['Capacity'] as int? ?? 0,
        amenities: ((json['Amenities'] as List?) ?? const []).cast<String>(),
      );

  final String id;
  final String name;
  final String priceKes;
  final bool seated;
  final int capacity;
  final List<String> amenities;
}

class ScheduleSummary {
  ScheduleSummary({required this.id, required this.departAt, this.arriveAt, this.gateInfo, required this.status});

  factory ScheduleSummary.fromJson(Map<String, dynamic> json) => ScheduleSummary(
        id: json['ID'] as String,
        departAt: json['DepartAt'] as String,
        arriveAt: json['ArriveAt'] as String?,
        gateInfo: json['GateInfo'] as String?,
        status: json['Status'] as String,
      );

  final String id;
  final String departAt;
  final String? arriveAt;
  final String? gateInfo;
  final String status;
}

class ListingDetail extends ListingSummary {
  ListingDetail({
    required super.id, required super.slug, required super.title, super.coverUrl, required super.vertical,
    super.venueOrRouteLabel, this.description, required this.ticketClasses, required this.schedules,
  });

  factory ListingDetail.fromJson(Map<String, dynamic> json) => ListingDetail(
        id: json['ID'] as String,
        slug: json['Slug'] as String,
        title: json['Title'] as String,
        coverUrl: json['CoverURL'] as String?,
        vertical: json['Vertical'] as String,
        venueOrRouteLabel: json['VenueOrRouteLabel'] as String?,
        description: json['Description'] as String?,
        ticketClasses: ((json['TicketClasses'] as List?) ?? const [])
            .map((e) => TicketClass.fromJson(e as Map<String, dynamic>))
            .toList(),
        schedules: ((json['Schedules'] as List?) ?? const [])
            .map((e) => ScheduleSummary.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String? description;
  final List<TicketClass> ticketClasses;
  final List<ScheduleSummary> schedules;
}

class SeatRow {
  SeatRow({required this.id, required this.label, required this.status, required this.ticketClassId});

  factory SeatRow.fromJson(Map<String, dynamic> json) => SeatRow(
        id: json['ID'] as String,
        label: json['Label'] as String,
        status: json['Status'] as String,
        ticketClassId: json['TicketClassID'] as String,
      );

  final String id;
  final String label;
  final String status; // AVAILABLE | BOOKED
  final String ticketClassId;
}

class TicketRow {
  TicketRow({required this.id, required this.code, required this.className, this.seatLabel, required this.priceKes, required this.status, required this.bookingId});

  factory TicketRow.fromJson(Map<String, dynamic> json) => TicketRow(
        id: json['ID'] as String,
        code: json['Code'] as String,
        className: json['ClassName'] as String,
        seatLabel: json['SeatLabel'] as String?,
        priceKes: json['PriceKES'] as String,
        status: json['Status'] as String,
        bookingId: json['BookingID'] as String,
      );

  final String id;
  final String code;
  final String className;
  final String? seatLabel;
  final String priceKes;
  final String status;
  final String bookingId;
}
