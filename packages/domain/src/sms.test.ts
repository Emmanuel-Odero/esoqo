import { describe, expect, it } from 'vitest';

import {
  smsEncoding, smsUnits, smsSegments, gsmSafe, fit, firstName, smsKes, sms,
} from './sms';
import { donorThankYouSms, adminDonationAlertSms } from './donation-notify';
import {
  contributionGapSms, groupInviteSms,
  contributionDeclaredSms, contributionConfirmedSms, withdrawalRequestedSms,
} from './group-alerts-notify';
import { saleReceiptSms } from './store-notify';

describe('encoding and segment counting', () => {
  it('counts plain ASCII as GSM-7', () => {
    expect(smsEncoding('Hello')).toBe('GSM-7');
    expect(smsUnits('Hello')).toBe(5);
    expect(smsSegments('Hello')).toBe(1);
  });

  it('charges two septets for the GSM-7 extension table', () => {
    // '[' is on the extension table, so it costs an escape plus itself.
    expect(smsEncoding('[')).toBe('GSM-7');
    expect(smsUnits('[')).toBe(2);
  });

  it('flips to UCS-2 on a single non-GSM character', () => {
    expect(smsEncoding('Asante - Esoqo')).toBe('GSM-7');
    expect(smsEncoding('Asante — Esoqo')).toBe('UCS-2');
  });

  it('splits GSM-7 at 160 and UCS-2 at 70', () => {
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    expect(smsSegments('—' + 'a'.repeat(69))).toBe(1);
    expect(smsSegments('—' + 'a'.repeat(70))).toBe(2);
  });

  it('counts an astral-plane emoji as two UCS-2 units', () => {
    expect(smsUnits('\u{1F600}')).toBe(2);
  });

  it('is the regression guard for the em-dash sign-off that started this', () => {
    const old = 'Kilimo Cha Wanawake: no contribution recorded in 14 days. '
      + 'A quick nudge to members this week keeps the group on track. — Esoqo';
    expect(smsEncoding(old)).toBe('UCS-2');
    expect(smsSegments(old)).toBeGreaterThan(1);
  });
});

describe('gsmSafe', () => {
  it('transliterates the typography that breaks encoding', () => {
    expect(gsmSafe('a — b')).toBe('a - b');
    expect(gsmSafe('it’s')).toBe("it's");
    expect(gsmSafe('“quoted”')).toBe('"quoted"');
    expect(gsmSafe('wait…')).toBe('wait...');
    expect(gsmSafe('a b')).toBe('a b');
  });

  it('strips accents down to the base letter', () => {
    expect(gsmSafe('Nakuru Café')).toBe('Nakuru Cafe');
    expect(gsmSafe('Müller')).toBe('Müller'); // u-umlaut IS in GSM-7
    expect(gsmSafe('Ākara')).toBe('Akara');
  });

  it('drops what has no honest GSM-7 twin', () => {
    // Character-level transform: the emoji goes, the space around it is
    // left to the composer. `sms` and `fit` both trim and collapse, so
    // nothing downstream ever sees the ragged edge.
    expect(gsmSafe('Karibu \u{1F600}')).toBe('Karibu ');
    expect(sms`Karibu ${'\u{1F600}'}`).toBe('Karibu');
    expect(gsmSafe('​hidden')).toBe('hidden');
  });

  it('always returns something GSM-7 encodable', () => {
    for (const input of ['\u{1F600}—’…', 'Nairobi · Mombasa', '你好']) {
      expect(smsEncoding(gsmSafe(input))).toBe('GSM-7');
    }
  });
});

describe('fit', () => {
  it('leaves short text alone', () => {
    expect(fit('Tumaini Trust', 30)).toBe('Tumaini Trust');
  });

  it('cuts on a word boundary and leaves no dangling punctuation', () => {
    expect(fit('Build the Kibera Community Library Roof', 30)).toBe('Build the Kibera Community');
  });

  it('hard-cuts a single word too long to break', () => {
    expect(fit('Supercalifragilisticexpialidocious', 10)).toHaveLength(10);
  });

  it('collapses whitespace and sanitises in one pass', () => {
    expect(fit('Mama  Njeri’s   Duka', 40)).toBe("Mama Njeri's Duka");
  });
});

describe('firstName', () => {
  it('keeps only the first name', () => {
    expect(firstName('Jane Wanjiku Kamau')).toBe('Jane');
  });
  it('handles a single name and empty input', () => {
    expect(firstName('Otieno')).toBe('Otieno');
    expect(firstName('   ')).toBe('');
  });
});

describe('smsKes', () => {
  it('formats whole shillings with separators', () => {
    expect(smsKes(2500)).toBe('KES 2,500');
    expect(smsKes(1234567)).toBe('KES 1,234,567');
  });
  it('rounds rather than showing cents', () => {
    expect(smsKes(99.6)).toBe('KES 100');
  });
});

describe('the sms tagged template', () => {
  it('collapses source-level line breaks', () => {
    expect(sms`one
      two`).toBe('one two');
  });
  it('sanitises interpolated user data', () => {
    expect(sms`Hi ${'Mama’s \u{1F600}'}`).toBe("Hi Mama's");
  });
});

/**
 * The budget test.
 *
 * Every template is rendered with inputs at the maximum length its
 * validators allow (campaign titles and org names are capped at 160 in
 * jamii.ts and treasury.ts) and loaded with the exact typography that
 * used to break the encoding. If any of these ever needs two segments,
 * the copy is over budget — trim the wording or lower a `fit` budget,
 * do not raise the assertion.
 */
describe('every template fits one GSM-7 segment at worst case', () => {
  const LONG_ORG = 'Tumaini Community Development and Welfare Trust of Greater Nairobi County Chapter Two';
  const LONG_CAMPAIGN = 'Build the Kibera Community Library Roof and Furnish the Childrens Reading Room Before December';
  const LONG_NAME = 'Jane Wanjiku Achieng Kamau Odhiambo';
  const BIG_MONEY = 9_999_999;

  const cases: Array<[string, string]> = [
    ['donorThankYouSms', donorThankYouSms({
      donorName: LONG_NAME, anonymous: false, amountKes: BIG_MONEY,
      campaignTitle: LONG_CAMPAIGN, orgName: LONG_ORG, receiptCode: 'JAM-7K3H92XQ',
    })],
    ['donorThankYouSms (anonymous)', donorThankYouSms({
      donorName: LONG_NAME, anonymous: true, amountKes: BIG_MONEY,
      campaignTitle: LONG_CAMPAIGN, orgName: LONG_ORG, receiptCode: 'JAM-7K3H92XQ',
    })],
    ['adminDonationAlertSms', adminDonationAlertSms({
      donorName: LONG_NAME, anonymous: false, amountKes: BIG_MONEY,
      campaignTitle: LONG_CAMPAIGN, orgName: LONG_ORG, receiptCode: 'JAM-7K3H92XQ',
    })],
    ['adminDonationAlertSms (anonymous)', adminDonationAlertSms({
      donorName: LONG_NAME, anonymous: true, amountKes: BIG_MONEY,
      campaignTitle: LONG_CAMPAIGN, orgName: LONG_ORG, receiptCode: 'JAM-7K3H92XQ',
    })],
    ['contributionGapSms', contributionGapSms({
      officialName: LONG_ORG, daysSinceLastContribution: 365,
    })],
    ['groupInviteSms', groupInviteSms(LONG_ORG)],
    ['groupInviteSms (join fee)', groupInviteSms(LONG_ORG, { joinFeeKes: BIG_MONEY })],
    ['groupInviteSms (with inviter)', groupInviteSms(LONG_ORG, { inviterName: LONG_NAME })],
    ['groupInviteSms (with inviter, join fee)', groupInviteSms(LONG_ORG, { inviterName: LONG_NAME, joinFeeKes: BIG_MONEY })],
    ['contributionDeclaredSms', contributionDeclaredSms({
      amountKes: BIG_MONEY, method: 'MPESA', reference: 'a1b2c3d4',
    })],
    ['contributionConfirmedSms', contributionConfirmedSms({
      amountKes: BIG_MONEY, contributorName: LONG_NAME, orgName: LONG_ORG,
      newBalanceKes: BIG_MONEY, reference: 'a1b2c3d4',
    })],
    ['withdrawalRequestedSms', withdrawalRequestedSms({
      orgName: LONG_ORG, amountKes: BIG_MONEY, purpose: LONG_CAMPAIGN, requesterName: LONG_NAME,
    })],
    ['saleReceiptSms', saleReceiptSms({
      storeName: 'Mama Njeri’s Duka la Mboga na Vyakula',
      receiptNo: 'MAMA-NJERI-D-000147', totalKes: BIG_MONEY,
      etimsSerial: '0100047289000012345678',
    })],
    ['saleReceiptSms (no eTIMS)', saleReceiptSms({
      storeName: 'Mama Njeri’s Duka la Mboga na Vyakula',
      receiptNo: 'MAMA-NJERI-D-000147', totalKes: BIG_MONEY, etimsSerial: null,
    })],
  ];

  it.each(cases)('%s', (_name, message) => {
    expect(smsEncoding(message)).toBe('GSM-7');
    expect(smsSegments(message)).toBe(1);
  });

  it('survives emoji and curly quotes pasted into every field', () => {
    const message = donorThankYouSms({
      donorName: 'Jane’s \u{1F600}', anonymous: false, amountKes: 2500,
      campaignTitle: 'Kibera — Library \u{1F4DA}', orgName: 'Tumaini… Trust',
      receiptCode: 'JAM-7K3H92',
    });
    expect(smsEncoding(message)).toBe('GSM-7');
    expect(smsSegments(message)).toBe(1);
  });
});

describe('copy reads the way it is meant to', () => {
  it('thanks the donor in the organisation voice, with the receipt', () => {
    expect(donorThankYouSms({
      donorName: 'Jane Wanjiku', anonymous: false, amountKes: 2500,
      campaignTitle: 'Kibera Library Roof', orgName: 'Tumaini Trust',
      receiptCode: 'JAM-7K3H92',
    })).toBe('Tumaini Trust: asante Jane! Your KES 2,500 gift to Kibera Library Roof is confirmed. Receipt JAM-7K3H92.');
  });

  it('never names an anonymous donor, to either party', () => {
    const ctx = {
      donorName: 'Jane Wanjiku', anonymous: true, amountKes: 2500,
      campaignTitle: 'Kibera Library Roof', orgName: 'Tumaini Trust',
      receiptCode: 'JAM-7K3H92',
    };
    expect(donorThankYouSms(ctx)).not.toContain('Jane');
    expect(adminDonationAlertSms(ctx)).not.toContain('Jane');
    expect(adminDonationAlertSms(ctx)).toContain('an anonymous supporter');
  });

  it('leads the admin alert with the amount', () => {
    expect(adminDonationAlertSms({
      donorName: 'Jane Wanjiku', anonymous: false, amountKes: 2500,
      campaignTitle: 'Kibera Library Roof', orgName: 'Tumaini Trust',
      receiptCode: 'JAM-7K3H92',
    })).toBe('Our Jamii: KES 2,500 from Jane Wanjiku for Kibera Library Roof. Receipt JAM-7K3H92.');
  });

  it('names the shop on a receipt, which is the whole point of the change', () => {
    const message = saleReceiptSms({
      storeName: 'Mama Njeri Duka', receiptNo: 'MAMA-NJERI-000147',
      totalKes: 1340, etimsSerial: null,
    });
    expect(message).toBe('Mama Njeri Duka: receipt MAMA-NJERI-000147 for KES 1,340. Asante for shopping with us.');
  });

  it('includes the eTIMS serial only when there is a real one', () => {
    const base = {
      storeName: 'Mama Njeri Duka', receiptNo: 'MAMA-NJERI-000147', totalKes: 1340,
    };
    expect(saleReceiptSms({ ...base, etimsSerial: null })).not.toContain('eTIMS');
    expect(saleReceiptSms({ ...base, etimsSerial: '0100047289' })).toContain('eTIMS 0100047289');
  });

  it('gives the group invite exactly one action', () => {
    const message = groupInviteSms('Kilimo Cha Wanawake');
    expect(message).toBe('Karibu! You have been added to Kilimo Cha Wanawake, a savings group on Esoqo. Sign in with this number to see contributions and balances.');
    expect(message).not.toContain(' or ');
  });

  it('names the join fee when one is what keeps a new member pending', () => {
    const free = groupInviteSms('Kilimo Cha Wanawake');
    const paid = groupInviteSms('Kilimo Cha Wanawake', { joinFeeKes: 500 });
    expect(free).not.toContain('join fee');
    expect(paid).toContain('KES 500 join fee');
    expect(paid).toContain('Kilimo Cha Wanawake');
    // A fee of zero is no fee — it must not produce "KES 0 join fee".
    expect(groupInviteSms('Kilimo Cha Wanawake', { joinFeeKes: 0 })).toBe(free);
  });

  it('names the inviter so a stranger is not just told "Esoqo" added them', () => {
    const named = groupInviteSms('Kilimo Cha Wanawake', { inviterName: 'Grace Wambui' });
    expect(named).toBe('Karibu! Grace added you to Kilimo Cha Wanawake, a savings group on Esoqo. Sign in with this number to see contributions and balances.');
    // No inviter on file degrades to the old phrasing rather than "undefined".
    expect(groupInviteSms('Kilimo Cha Wanawake')).not.toContain('undefined');
  });

  it('tells the contributor their declaration is recorded but not yet money', () => {
    const message = contributionDeclaredSms({ amountKes: 2500, method: 'CASH', reference: 'a1b2c3d4' });
    expect(message).toBe("Esoqo: your KES 2,500 contribution (cash) was recorded - ref a1b2c3d4. You'll get a text once it's confirmed.");
    expect(message).toContain('once it');
  });

  it('leads the confirmed broadcast with the amount and ends with the balance', () => {
    expect(contributionConfirmedSms({
      amountKes: 2500, contributorName: 'Jane Wanjiku', orgName: 'Kilimo Cha Wanawake',
      newBalanceKes: 18400, reference: 'a1b2c3d4',
    })).toBe('KES 2,500 from Jane Wanjiku credited to Kilimo Cha Wanawake, new balance KES 18,400 - ref a1b2c3d4');
  });

  it('nudges a quiet group without scolding it', () => {
    expect(contributionGapSms({ officialName: 'Kilimo Cha Wanawake', daysSinceLastContribution: 14 }))
      .toBe('Kilimo Cha Wanawake: no contribution recorded in 14 days. A word to members this week keeps the group moving.');
  });
});
