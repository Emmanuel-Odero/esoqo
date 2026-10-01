import { describe, it, expect } from 'vitest';
import { smsEncoding, smsSegments } from './sms';
import { payerPaymentReceiptSms, businessPaymentAlertSms } from './business-payment-notify';

const base = {
  amountKes: 500,
  businessName: 'Mama Mboga Kitchen',
  receiptCode: 'BP-7K3H92XQ',
  mpesaReceiptCode: 'UIQRI7ZKTH',
};

describe('payerPaymentReceiptSms', () => {
  it('names the amount, the business and the Esoqo receipt', () => {
    expect(payerPaymentReceiptSms(base))
      .toBe('Esoqo: KES 500 paid to Mama Mboga Kitchen. Receipt BP-7K3H92XQ. M-Pesa UIQRI7ZKTH.');
  });

  // No PAY link when receiptVerifyCode is absent — the only pay link
  // that exists leads back to the form that asks for money again, so a
  // shopper holding a receipt for a payment they already made would be
  // one tap from starting a second one. Locked here so a well-meaning
  // "let's add a link back" does not quietly undo it.
  it('carries no pay link, because the only pay link asks for money again', () => {
    const message = payerPaymentReceiptSms(base);
    expect(message).not.toContain('http');
    expect(message).not.toContain('Keep');
    expect(message).not.toContain('pay');
    expect(message).toBe('Esoqo: KES 500 paid to Mama Mboga Kitchen. Receipt BP-7K3H92XQ. M-Pesa UIQRI7ZKTH.');
  });

  // A VERIFY link is different — read-only, no amount field, cannot
  // start a second payment — so it's appended whenever the payment
  // minted a Receipt to link to.
  it('appends a verify link when a receiptVerifyCode is given', () => {
    const message = payerPaymentReceiptSms({ ...base, receiptVerifyCode: 'RC2609298KX3FQ' });
    expect(message).toBe('Esoqo: KES 500 paid to Mama Mboga Kitchen. Receipt BP-7K3H92XQ. M-Pesa UIQRI7ZKTH. View: esoqo.co.ke/verify/RC2609298KX3FQ');
  });

  it('omits the verify clause entirely when there is no receiptVerifyCode', () => {
    for (const missing of [null, undefined, '', '   ']) {
      const message = payerPaymentReceiptSms({ ...base, receiptVerifyCode: missing });
      expect(message).not.toContain('verify');
    }
  });

  // The characters the link used to take are now available to the
  // receipt itself, which is what the shopper is actually holding.
  it('spends the freed budget on the receipt, staying in one segment', () => {
    const message = payerPaymentReceiptSms(base);
    expect([...message].length).toBeLessThan(100);
    expect(smsSegments(message)).toBe(1);
  });

  it('quotes both references, ours and Safaricom\'s, because they are not interchangeable', () => {
    expect(payerPaymentReceiptSms(base))
      .toBe('Esoqo: KES 500 paid to Mama Mboga Kitchen. Receipt BP-7K3H92XQ. M-Pesa UIQRI7ZKTH.');
  });

  it('omits the M-Pesa clause entirely when Safaricom sent no code', () => {
    // Console mode never has one, and some callbacks arrive without it.
    // A bare "M-Pesa ." would read as a value that failed to arrive
    // rather than one that was never issued.
    for (const missing of [null, undefined, '', '   ']) {
      const message = payerPaymentReceiptSms({ ...base, mpesaReceiptCode: missing });
      expect(message).not.toContain('M-Pesa');
      expect(message).toBe('Esoqo: KES 500 paid to Mama Mboga Kitchen. Receipt BP-7K3H92XQ.');
    }
  });

  it('clamps an overlong M-Pesa code rather than letting it run the budget', () => {
    const message = payerPaymentReceiptSms({ ...base, mpesaReceiptCode: 'X'.repeat(400) });
    expect(smsSegments(message)).toBe(1);
  });
});

describe('businessPaymentAlertSms', () => {
  it('leads with the amount and carries the payer for replies', () => {
    expect(businessPaymentAlertSms({ ...base, payerMsisdn: '+254712345678' }))
      .toBe('Esoqo: KES 500 received from +254712345678 for Mama Mboga Kitchen. Receipt BP-7K3H92XQ. M-Pesa UIQRI7ZKTH.');
  });

  it('still reads properly with no payer number on file', () => {
    expect(businessPaymentAlertSms({ ...base, payerMsisdn: null }))
      .toBe('Esoqo: KES 500 received for Mama Mboga Kitchen. Receipt BP-7K3H92XQ. M-Pesa UIQRI7ZKTH.');
  });

  it('omits the M-Pesa clause when there is no code', () => {
    expect(businessPaymentAlertSms({ ...base, payerMsisdn: null, mpesaReceiptCode: null }))
      .toBe('Esoqo: KES 500 received for Mama Mboga Kitchen. Receipt BP-7K3H92XQ.');
  });
});

/**
 * The budget test, same contract as sms.test.ts's own block: worst-case
 * inputs, including the typography that used to break the encoding, and
 * exactly one GSM-7 segment. Do not raise the assertion — trim the
 * wording or lower a `fit` budget.
 */
describe('business-payment copy fits one GSM-7 segment at worst case', () => {
  const LONG_NAME = 'Mama Mboga’s Kitchen and Nyama Choma Joint — Thika Road Outlet No. 42';
  const BIG_MONEY = 9_999_999;

  // `base` supplies a real M-Pesa code, so the budget below is measured
  // with the clause present — the longest version of each message.
  const cases: Array<[string, string]> = [
    ['payerPaymentReceiptSms', payerPaymentReceiptSms({
      ...base, amountKes: BIG_MONEY, businessName: LONG_NAME,
    })],
    ['payerPaymentReceiptSms (no M-Pesa code)', payerPaymentReceiptSms({
      ...base, amountKes: BIG_MONEY, businessName: LONG_NAME, mpesaReceiptCode: null,
    })],
    ['payerPaymentReceiptSms (with verify link)', payerPaymentReceiptSms({
      ...base, amountKes: BIG_MONEY, businessName: LONG_NAME, receiptVerifyCode: 'RC2609298KX3FQ',
    })],
    ['businessPaymentAlertSms', businessPaymentAlertSms({
      ...base, amountKes: BIG_MONEY, businessName: LONG_NAME, payerMsisdn: '+254712345678',
    })],
    ['businessPaymentAlertSms (no payer)', businessPaymentAlertSms({
      ...base, amountKes: BIG_MONEY, businessName: LONG_NAME, payerMsisdn: null,
    })],
  ];

  it.each(cases)('%s', (_name, message) => {
    expect(smsEncoding(message)).toBe('GSM-7');
    expect(smsSegments(message)).toBe(1);
  });

  it('survives emoji and curly quotes pasted into the business name', () => {
    const message = payerPaymentReceiptSms({ ...base, businessName: 'Mama Mboga\u{1F600}’s — Kitchen…' });
    expect(smsEncoding(message)).toBe('GSM-7');
    expect(smsSegments(message)).toBe(1);
  });
});
