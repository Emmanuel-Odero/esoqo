/// Wire types matching core-go's Go struct JSON — see
/// services/core-go/internal/dbx/groups.go and treasury.go.
class GroupSummary {
  GroupSummary({
    required this.id,
    required this.officialName,
    this.knownAs,
    required this.kind,
    required this.county,
    required this.memberCount,
  });

  factory GroupSummary.fromJson(Map<String, dynamic> json) => GroupSummary(
    id: json['ID'] as String,
    officialName: json['OfficialName'] as String,
    knownAs: json['KnownAs'] as String?,
    kind: json['Kind'] as String,
    county: json['County'] as String,
    memberCount: json['MemberCount'] as int? ?? 0,
  );

  final String id;
  final String officialName;
  final String? knownAs;
  final String kind;
  final String county;
  final int memberCount;

  String get displayName =>
      knownAs?.isNotEmpty == true ? knownAs! : officialName;
}

class MemberRow {
  MemberRow({
    required this.membershipId,
    required this.personId,
    required this.name,
    this.msisdn,
    required this.role,
    this.customRole,
    required this.status,
  });

  factory MemberRow.fromJson(Map<String, dynamic> json) => MemberRow(
    membershipId: json['MembershipID'] as String,
    personId: json['PersonID'] as String,
    name: json['Name'] as String,
    msisdn: json['Msisdn'] as String?,
    role: json['Role'] as String,
    customRole: json['CustomRole'] as String?,
    status: json['Status'] as String,
  );

  final String membershipId;
  final String personId;
  final String name;
  final String? msisdn;
  final String role;
  final String? customRole;
  final String status;

  bool get isOfficer =>
      role == 'CHAIRPERSON' || role == 'TREASURER' || role == 'SECRETARY';
  String get roleLabel =>
      role == 'OTHER' ? (customRole ?? 'Other') : _titleCase(role);

  static String _titleCase(String s) => s
      .split('_')
      .map((w) => w.isEmpty ? w : '${w[0]}${w.substring(1).toLowerCase()}')
      .join(' ');
}

class GroupDetail extends GroupSummary {
  GroupDetail({
    required super.id,
    required super.officialName,
    super.knownAs,
    required super.kind,
    required super.county,
    required super.memberCount,
    required this.members,
  });

  factory GroupDetail.fromJson(Map<String, dynamic> json) => GroupDetail(
    id: json['ID'] as String,
    officialName: json['OfficialName'] as String,
    knownAs: json['KnownAs'] as String?,
    kind: json['Kind'] as String,
    county: json['County'] as String,
    memberCount: json['MemberCount'] as int? ?? 0,
    members: ((json['Members'] as List?) ?? const [])
        .map((e) => MemberRow.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final List<MemberRow> members;
}

class ContributionRow {
  ContributionRow({
    required this.id,
    required this.contributorName,
    required this.amountKes,
    required this.status,
    this.method,
    required this.createdAt,
  });

  factory ContributionRow.fromJson(Map<String, dynamic> json) =>
      ContributionRow(
        id: json['ID'] as String,
        contributorName: json['ContributorName'] as String,
        amountKes: json['AmountKES'] as String,
        status: json['Status'] as String,
        method: json['Method'] as String?,
        createdAt:
            DateTime.tryParse(json['CreatedAt'] as String? ?? '') ??
            DateTime.now(),
      );

  final String id;
  final String contributorName;
  final String amountKes;
  final String status;
  final String? method;
  final DateTime createdAt;
}

class SignatureRow {
  SignatureRow({
    required this.signerId,
    required this.signerName,
    required this.decision,
    required this.signedAt,
    required this.valid,
  });

  factory SignatureRow.fromJson(Map<String, dynamic> json) => SignatureRow(
    signerId: json['SignerID'] as String,
    signerName: json['SignerName'] as String,
    decision: json['Decision'] as String,
    signedAt:
        DateTime.tryParse(json['SignedAt'] as String? ?? '') ?? DateTime.now(),
    valid: json['Valid'] as bool? ?? false,
  );

  final String signerId;
  final String signerName;
  final String decision;
  final DateTime signedAt;
  final bool valid;
}

class WithdrawalRow {
  WithdrawalRow({
    required this.id,
    required this.status,
    required this.amountKes,
    required this.purpose,
    required this.payeeName,
    required this.requiredSigners,
    required this.approveCount,
    required this.standbyOpensAt,
    required this.broadcastAt,
    required this.canSign,
    required this.signatures,
  });

  factory WithdrawalRow.fromJson(Map<String, dynamic> json) => WithdrawalRow(
    id: json['ID'] as String,
    status: json['Status'] as String,
    amountKes: json['AmountKES'] as String,
    purpose: json['Purpose'] as String,
    payeeName: json['PayeeName'] as String,
    requiredSigners: json['RequiredSigners'] as int? ?? 1,
    approveCount: json['ApproveCount'] as int? ?? 0,
    standbyOpensAt:
        DateTime.tryParse(json['StandbyOpensAt'] as String? ?? '') ??
        DateTime.now(),
    broadcastAt:
        DateTime.tryParse(json['BroadcastAt'] as String? ?? '') ??
        DateTime.now(),
    canSign: json['CanSign'] as bool? ?? false,
    signatures: ((json['Signatures'] as List?) ?? const [])
        .map((e) => SignatureRow.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String id;
  final String status;
  final String amountKes;
  final String purpose;
  final String payeeName;
  final int requiredSigners;
  final int approveCount;
  final DateTime standbyOpensAt;
  final DateTime broadcastAt;
  final bool canSign;
  final List<SignatureRow> signatures;
}
