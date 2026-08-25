export type JoiningAs = 'me' | 'group' | 'biz';
export type YesNoSoon = 'yes' | 'no' | 'soon';

export interface Form {
  joiningAs: JoiningAs | '';
  officialName: string; knownAs: string;
  orgName: string; orgKnownAs: string; orgRole: string;
  msisdn: string; email: string; county: string; ward: string;
  workRaw: string; segment: string;
  hasRegisteredBusiness: YesNoSoon | ''; registrationNo: string;
  belongsToGroup: 'yes' | 'no' | ''; groupName: string; groupPartyId: string;
  feeCoverage: 'group' | 'self' | '';
  memberCount: string; hasKraPin: 'yes' | 'no' | '';
  ussdSetupChoice: 'now' | 'later' | '';
  paymentChoice: 'paid' | 'stk' | 'later' | '';
  wantsPriceSms: boolean; wantsReceiptSms: boolean; wantsExpirySms: boolean;

  /** Only asked once search-before-create for the group comes up empty
   *  and the joiner chooses to register a brand-new group. */
  orgKind: string;
  orgSubCounty: string; orgDistrict: string;
  /** Segment keys — what most members deal in. */
  orgTags: string[];

  /** Business sub-flow (joiningAs === 'biz'). */
  bizIsRegistered: 'yes' | 'no' | '';
  bizIntendsToRegister: 'yes' | 'no' | '';
  bizPartyId: string;
  bizName: string;
  /** SUPPLIER | WHOLESALER | WAREHOUSE | MALL | '' (defaults to BUSINESS). */
  bizOrgKind: string;
  bizSector: string;
  bizType: string;
  bizTypeOther: string;
  bizEmployeeCount: string;
  bizRevenueGoodKes: string;
  bizRevenueBadKes: string;
  bizBankProvider: string;
  bizPaymentChannels: string[];
}

/**
 * Live phone normalisation for the join flow: keep the field in the
 * canonical E.164 form (+2547XXXXXXXX) as the user types, so what's
 * shown is exactly what gets stored and what the OTP is verified
 * against. Strips spaces and non-digits; converts a leading 0 to +254.
 */
export function normaliseMsisdnLive(raw: string): string {
  let digits = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') digits += ch;
    if (digits.length >= 12) break;
  }
  if (digits.startsWith('254')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return `+254${digits.slice(0, 9)}`;
}

export const EMPTY: Form = {
  joiningAs: '', officialName: '', knownAs: '', orgName: '', orgKnownAs: '', orgRole: 'Treasurer',
  msisdn: '+254 7', email: '', county: 'Nairobi', ward: '', workRaw: '', segment: '',
  hasRegisteredBusiness: '', registrationNo: '', belongsToGroup: '', groupName: '', groupPartyId: '',
  feeCoverage: '',
  memberCount: '', hasKraPin: '', ussdSetupChoice: '', paymentChoice: '',
  wantsPriceSms: false, wantsReceiptSms: true, wantsExpirySms: true,

  orgKind: '', orgSubCounty: '', orgDistrict: '', orgTags: [],

  bizIsRegistered: '', bizIntendsToRegister: '', bizPartyId: '', bizName: '', bizOrgKind: '',
  bizSector: '', bizType: '', bizTypeOther: '', bizEmployeeCount: '',
  bizRevenueGoodKes: '', bizRevenueBadKes: '', bizBankProvider: '', bizPaymentChannels: [],
};
