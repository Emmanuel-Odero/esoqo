export type JoiningAs = 'me' | 'group' | 'biz' | 'inst';
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
  paymentChoice: 'paid' | 'later' | '';
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
  bizSector: string;
  bizType: string;
  bizTypeOther: string;
  bizEmployeeCount: string;
  bizRevenueGoodKes: string;
  bizRevenueBadKes: string;
  bizBankProvider: string;
  bizPaymentChannels: string[];
}

export const EMPTY: Form = {
  joiningAs: '', officialName: '', knownAs: '', orgName: '', orgKnownAs: '', orgRole: 'Treasurer',
  msisdn: '+254 7', email: '', county: 'Nairobi', ward: '', workRaw: '', segment: '',
  hasRegisteredBusiness: '', registrationNo: '', belongsToGroup: '', groupName: '', groupPartyId: '',
  feeCoverage: '',
  memberCount: '', hasKraPin: '', ussdSetupChoice: '', paymentChoice: '',
  wantsPriceSms: false, wantsReceiptSms: true, wantsExpirySms: true,

  orgKind: '', orgSubCounty: '', orgDistrict: '', orgTags: [],

  bizIsRegistered: '', bizIntendsToRegister: '', bizPartyId: '', bizName: '',
  bizSector: '', bizType: '', bizTypeOther: '', bizEmployeeCount: '',
  bizRevenueGoodKes: '', bizRevenueBadKes: '', bizBankProvider: '', bizPaymentChannels: [],
};
