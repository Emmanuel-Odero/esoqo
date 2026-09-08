/// Wire type matching core-go's dbx.BillRow JSON — see
/// services/core-go/internal/dbx/bills.go. daysUntilDue/overdue/dueSoon
/// are derived on every read, never stored.
class BillRow {
  BillRow({
    required this.id,
    required this.label,
    required this.category,
    this.accountRef,
    this.amountKes,
    required this.cycle,
    required this.nextDueAt,
    required this.reminderDaysBefore,
    required this.status,
    required this.daysUntilDue,
    required this.overdue,
    required this.dueSoon,
    this.targetKes,
    required this.autoPayEnabled,
    required this.raisedKes,
  });

  factory BillRow.fromJson(Map<String, dynamic> json) => BillRow(
    id: json['ID'] as String,
    label: json['Label'] as String,
    category: json['Category'] as String,
    accountRef: json['AccountRef'] as String?,
    amountKes: json['AmountKES'] as String?,
    cycle: json['Cycle'] as String,
    nextDueAt:
        DateTime.tryParse(json['NextDueAt'] as String? ?? '') ?? DateTime.now(),
    reminderDaysBefore: json['ReminderDaysBefore'] as int? ?? 3,
    status: json['Status'] as String,
    daysUntilDue: json['DaysUntilDue'] as int? ?? 0,
    overdue: json['Overdue'] as bool? ?? false,
    dueSoon: json['DueSoon'] as bool? ?? false,
    targetKes: json['TargetKES'] as String?,
    autoPayEnabled: json['AutoPayEnabled'] as bool? ?? false,
    raisedKes: json['RaisedKES'] as String? ?? '0.00',
  );

  final String id;
  final String label;
  final String category;
  final String? accountRef;
  final String? amountKes;
  final String cycle;
  final DateTime nextDueAt;
  final int reminderDaysBefore;
  final String status;
  final int daysUntilDue;
  final bool overdue;
  final bool dueSoon;
  /// Set when this bill accepts real-money funding — see
  /// dbx.ContributeToBill. Null means "reminder only", the original
  /// behaviour.
  final String? targetKes;
  final bool autoPayEnabled;
  final String raisedKes;

  bool get isFunding => targetKes != null;

  double get fundingProgress {
    final target = double.tryParse(targetKes ?? '') ?? 0;
    if (target <= 0) return 0;
    final raised = double.tryParse(raisedKes) ?? 0;
    return (raised / target).clamp(0, 1);
  }
}

/// The guest-safe view a shared "help fund this bill" link resolves
/// to — wire type matching dbx.BillFundingSummary. PII-minimal by
/// design: no accountRef, no owner identity.
class BillFundingSummary {
  BillFundingSummary({
    required this.label,
    required this.category,
    required this.targetKes,
    required this.raisedKes,
    required this.contributorsCount,
    required this.funded,
  });

  factory BillFundingSummary.fromJson(Map<String, dynamic> json) =>
      BillFundingSummary(
        label: json['Label'] as String,
        category: json['Category'] as String,
        targetKes: json['TargetKES'] as String,
        raisedKes: json['RaisedKES'] as String,
        contributorsCount: json['ContributorsCount'] as int? ?? 0,
        funded: json['Funded'] as bool? ?? false,
      );

  final String label;
  final String category;
  final String targetKes;
  final String raisedKes;
  final int contributorsCount;
  final bool funded;

  double get progress {
    final target = double.tryParse(targetKes) ?? 0;
    if (target <= 0) return 0;
    final raised = double.tryParse(raisedKes) ?? 0;
    return (raised / target).clamp(0, 1);
  }
}

/// One line on "who's chipped in" — wire type matching
/// dbx.BillContributionRow.
class BillContributionRow {
  BillContributionRow({
    required this.contributorName,
    required this.amountKes,
    required this.createdAt,
  });

  factory BillContributionRow.fromJson(Map<String, dynamic> json) =>
      BillContributionRow(
        contributorName: json['ContributorName'] as String,
        amountKes: json['AmountKES'] as String,
        createdAt:
            DateTime.tryParse(json['CreatedAt'] as String? ?? '') ??
                DateTime.now(),
      );

  final String contributorName;
  final String amountKes;
  final DateTime createdAt;
}

const billCategories = [
  ('ELECTRICITY', 'Electricity'),
  ('WATER', 'Water'),
  ('PAY_TV', 'Pay TV'),
  ('RENT', 'Rent'),
  ('SCHOOL_FEES', 'School fees'),
  ('INTERNET', 'Internet'),
  ('OTHER', 'Other'),
];

const billCycles = [
  ('MONTHLY', 'Monthly'),
  ('WEEKLY', 'Weekly'),
  ('ONE_TIME', 'One-time'),
];
