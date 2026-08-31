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

  // Labels are "{row}{column}" (e.g. "3B" = row 3, 2nd seat from the
  // left) — the same convention as packages/domain/src/ticketing.ts's
  // columnsForPattern and core-go's seed/demo_ticketing.go. Parsed
  // lazily here rather than carried as separate wire fields, since the
  // label itself is the source of truth on both ends.
  int get row => int.tryParse(RegExp(r'^\d+').stringMatch(label) ?? '') ?? 0;
  String get column => RegExp(r'[A-Za-z]+$').stringMatch(label) ?? '';
}

/// GET /v1/schedules/:id/seats response — "pattern" (e.g. "2+2") tells
/// the client how many seat columns sit on each side of the aisle so it
/// can lay seats out as a real bus/hall shape instead of a flat grid.
class SeatMapResult {
  SeatMapResult({required this.pattern, required this.seats});

  factory SeatMapResult.fromJson(Map<String, dynamic> json) => SeatMapResult(
        pattern: json['pattern'] as String? ?? '2+2',
        seats: ((json['seats'] as List?) ?? const [])
            .map((e) => SeatRow.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String pattern;
  final List<SeatRow> seats;

  /// Column letters on the left of the aisle, e.g. "2+2" → ['A','B'].
  List<String> get leftColumns {
    final left = int.tryParse(pattern.split('+').first) ?? 2;
    return 'ABCDEFG'.split('').take(left).toList();
  }

  /// Column letters on the right of the aisle, e.g. "2+2" → ['C','D'].
  List<String> get rightColumns {
    final parts = pattern.split('+');
    final left = int.tryParse(parts.first) ?? 2;
    final right = parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0;
    return 'ABCDEFG'.split('').skip(left).take(right).toList();
  }

  /// Seats grouped by row number, sorted so the front of the bus/hall
  /// (row 1) renders first.
  Map<int, List<SeatRow>> get byRow {
    final map = <int, List<SeatRow>>{};
    for (final s in seats) {
      map.putIfAbsent(s.row, () => []).add(s);
    }
    for (final row in map.values) {
      row.sort((a, b) => a.column.compareTo(b.column));
    }
    return map;
  }
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
