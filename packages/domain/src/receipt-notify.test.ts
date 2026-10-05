import { describe, it, expect } from 'vitest';
import { smsSegments } from './sms';
import { purchaseReceiptSms } from './receipt-notify';

describe('purchaseReceiptSms', () => {
  it('leads with the store name, states the amount, and carries the verify link', () => {
    const message = purchaseReceiptSms({ storeName: 'Mama Mboga Kitchen', amountKes: 500, receiptCode: 'RC2609298KX3FQ' });
    expect(message).toBe('Mama Mboga Kitchen: KES 500 paid. Receipt RC2609298KX3FQ. View: esoqo.co.ke/verify/RC2609298KX3FQ');
  });

  it('fits one GSM-7 segment at worst case', () => {
    const LONG_NAME = 'Mama Mboga’s Kitchen and Nyama Choma Joint — Thika Road Outlet No. 42';
    const message = purchaseReceiptSms({ storeName: LONG_NAME, amountKes: 9_999_999, receiptCode: 'RC2609298KX3FQ' });
    expect(smsSegments(message)).toBe(1);
  });
});
