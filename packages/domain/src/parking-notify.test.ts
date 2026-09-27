import { describe, it, expect } from 'vitest';
import { smsEncoding, smsSegments } from './sms';
import { parkingCheckInSms, parkingPaidSms } from './parking-notify';
import {
  mintParkingLotCode,
  mintParkingTicketCode,
  isParkingCodeShape,
  normaliseParkingCode,
  buildParkingLink,
  PARKING_LOT_PREFIX,
  PARKING_TICKET_PREFIX,
} from './parking-code';

const lot = {
  lotName: 'Westlands Parking',
  ticketCode: 'PRT-7QW2-4X',
  graceMinutes: 10,
  ratePerHourKes: 50,
};

describe('parking codes', () => {
  it('mints a lot code and a ticket code in the same shape', () => {
    expect(mintParkingLotCode()).toMatch(/^PRK-[A-Z2-9]{4}-[A-Z2-9]{2}$/);
    expect(mintParkingTicketCode()).toMatch(/^PRT-[A-Z2-9]{4}-[A-Z2-9]{2}$/);
  });

  it('never mints an ambiguous character', () => {
    // 0/O and 1/I/L are the characters actually mistyped on a keypad,
    // and a parking code is read aloud at a barrier in the rain.
    for (let i = 0; i < 300; i += 1) {
      for (const code of [mintParkingLotCode(), mintParkingTicketCode()]) {
        expect(code).not.toMatch(/[0O1IL]/);
      }
    }
  });

  it('mints distinct codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) seen.add(mintParkingTicketCode());
    expect(seen.size).toBe(300);
  });

  it('recognises its own shapes and nothing else', () => {
    expect(isParkingCodeShape('PRT-7QW2-4X')).toBe(true);
    expect(isParkingCodeShape('prk-4kx9-2j')).toBe(true);
    expect(isParkingCodeShape('PRT-7QW2')).toBe(false);
    expect(isParkingCodeShape('ESK-HWQHDU-KE')).toBe(false);
    expect(isParkingCodeShape('PRT-7QW2-4X ')).toBe(true);
  });

  // Somebody will print the link rather than the code. The code has to
  // survive the round trip, or a lot's sticker silently stops working.
  it('reads a code back out of a full link', () => {
    const link = buildParkingLink('https://esoqo.co.ke', 'prk-4kx9-2j');
    expect(link).toBe('https://esoqo.co.ke/pay/parking/PRK-4KX9-2J');
    expect(normaliseParkingCode(link)).toBe('PRK-4KX9-2J');
  });

  it('survives a query string and a trailing slash on the base URL', () => {
    expect(normaliseParkingCode('https://esoqo.co.ke/pay/parking/PRT-7QW2-4X?src=qr'))
      .toBe('PRT-7QW2-4X');
    expect(buildParkingLink('https://esoqo.co.ke/', 'PRT-7QW2-4X'))
      .toBe('https://esoqo.co.ke/pay/parking/PRT-7QW2-4X');
  });

  it('rejects a lot code used as a ticket, and vice versa, on prefix', () => {
    // Same shape, different meaning. A ticket code must never be able
    // to check a car out of a lot it was not issued by.
    expect(PARKING_LOT_PREFIX).not.toBe(PARKING_TICKET_PREFIX);
    expect(normaliseParkingCode(`${PARKING_TICKET_PREFIX}-7QW2-4X`)).toBe('PRT-7QW2-4X');
    expect(normaliseParkingCode(`${PARKING_LOT_PREFIX}-7QW2-4X`)).toBe('PRK-7QW2-4X');
  });

  it('returns null for anything that is not a parking code', () => {
    expect(normaliseParkingCode('')).toBeNull();
    expect(normaliseParkingCode('hello')).toBeNull();
    expect(normaliseParkingCode('ESK-HWQHDU-KE')).toBeNull();
    expect(normaliseParkingCode('PRT-7QW2-40')).toBeNull(); // 0 is not in the alphabet
  });
});

describe('parkingCheckInSms', () => {
  it('carries the lot, the ticket and the rate', () => {
    const message = parkingCheckInSms(lot);
    expect(message).toContain('Westlands Parking');
    expect(message).toContain('PRT-7QW2-4X');
    expect(message).toContain('KES 50/hr');
    expect(message).toContain('10 min free');
  });

  it('says "parked" so a code arriving while driving reads as a receipt', () => {
    expect(parkingCheckInSms(lot)).toMatch(/^Esoqo: parked at /);
  });

  it('leaves the grace clause out when there is no grace', () => {
    expect(parkingCheckInSms({ ...lot, graceMinutes: 0 })).not.toContain('min free');
  });

  it('never lets a long name eat the ticket code', () => {
    // The ticket is the only credential the driver has. If the budget
    // ever forced a choice, it is the lot name that gives way.
    const message = parkingCheckInSms({
      ...lot,
      lotName: 'Westlands Parking Mall Underground Level Four Nairobi County',
    });
    expect(message).toContain('PRT-7QW2-4X');
  });

  it('holds the worst case to one GSM-7 segment', () => {
    const message = parkingCheckInSms({
      lotName: 'Westlands Parking Mall Underground Level Four Nairobi'.padEnd(40, 'x'),
      ticketCode: 'PRT-7QW2-4X',
      graceMinutes: 999,
      ratePerHourKes: 9_999_999,
    });
    expect(smsEncoding(message)).toBe('GSM-7');
    expect(smsSegments(message)).toBe(1);
  });
});

describe('parkingPaidSms', () => {
  it('states the amount, the lot and the Esoqo receipt', () => {
    expect(parkingPaidSms({ amountKes: 150, lotName: 'Westlands Parking', receiptCode: 'BP-7K3H92XQ' }))
      .toBe('Esoqo: KES 150 parking paid at Westlands Parking. Receipt BP-7K3H92XQ.');
  });

  it('does not offer a link to a ticket that has already been spent', () => {
    const message = parkingPaidSms({ amountKes: 150, lotName: 'Westlands Parking', receiptCode: 'BP-7K3H92XQ' });
    expect(message).not.toContain('http');
    expect(message).not.toContain('Keep');
  });

  it('holds the worst case to one GSM-7 segment', () => {
    const message = parkingPaidSms({
      amountKes: 9_999_999,
      lotName: 'Westlands Parking Mall Underground Level Four'.padEnd(40, 'x'),
      receiptCode: 'BP-7K3H92XQ-EXTRA',
    });
    expect(smsEncoding(message)).toBe('GSM-7');
    expect(smsSegments(message)).toBe(1);
  });
});
