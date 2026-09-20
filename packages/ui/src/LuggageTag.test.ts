import { describe, expect, it } from 'vitest';
import { shortenPassengerName } from './LuggageTag';

/**
 * These cases are duplicated verbatim in core-go's
 * internal/dbx/luggage_test.go (TestShortenPassengerNameKeepsSurnameAndInitial
 * and friends). Two implementations of one rule exist because the tag
 * must be printable offline while the scan projection is served by Go;
 * keeping the *tests* identical is the cheapest way to notice when the
 * two drift, and the direction they would drift is toward printing more
 * of a passenger's name on something stuck to a bag.
 */
describe('shortenPassengerName', () => {
  it('keeps the surname and a leading initial', () => {
    expect(shortenPassengerName('Mary Wanjiku')).toBe('WANJIKU M.');
    expect(shortenPassengerName('mary wanjiku')).toBe('WANJIKU M.');
    expect(shortenPassengerName('John Kamau Otieno')).toBe('OTIENO J.');
    expect(shortenPassengerName('  Grace   Achieng   ')).toBe('ACHIENG G.');
  });

  it('handles a single name, which a conductor typing fast will enter', () => {
    expect(shortenPassengerName('Wanjiku')).toBe('WANJIKU');
  });

  it('yields nothing for nothing rather than "  ."', () => {
    expect(shortenPassengerName('')).toBe('');
    expect(shortenPassengerName('   ')).toBe('');
  });

  it('drops everything between the first and last name', () => {
    expect(shortenPassengerName('Mary Nyambura Wanjiku Kamau')).toBe('KAMAU M.');
  });
});
