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
