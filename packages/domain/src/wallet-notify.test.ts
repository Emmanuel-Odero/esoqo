import { describe, it, expect } from 'vitest';
import {
  walletTopUpConfirmedSms, walletWithdrawalConfirmedSms, transferSentSms, transferReceivedSms,
} from './wallet-notify';

const REF = 'WT2609298KX3FQ';

describe('wallet SMS reference codes', () => {
  it('top-up confirmation carries the reference', () => {
    expect(walletTopUpConfirmedSms({ amountKes: 500, referenceCode: REF })).toContain(`Ref ${REF}`);
  });

  it('withdrawal confirmation carries the reference, with and without a fee', () => {
    expect(walletWithdrawalConfirmedSms({ amountKes: 500, feeKes: 20, netPayoutKes: 480, msisdn: '+254712345678', referenceCode: REF }))
      .toContain(`Ref ${REF}`);
    expect(walletWithdrawalConfirmedSms({ amountKes: 500, feeKes: 0, netPayoutKes: 500, msisdn: '+254712345678', referenceCode: REF }))
      .toContain(`Ref ${REF}`);
  });

  it('transfer-sent and transfer-received both carry the reference', () => {
    expect(transferSentSms({ amountKes: 100, counterpartyName: 'Jane', referenceCode: REF })).toContain(`Ref ${REF}`);
    expect(transferReceivedSms({ amountKes: 100, counterpartyName: 'Jane', referenceCode: REF })).toContain(`Ref ${REF}`);
  });

  it('a note still appears ahead of the reference on transfer-received', () => {
    const msg = transferReceivedSms({ amountKes: 100, counterpartyName: 'Jane', note: 'lunch', referenceCode: REF });
    expect(msg.indexOf('"lunch"')).toBeLessThan(msg.indexOf(`Ref ${REF}`));
  });
});
