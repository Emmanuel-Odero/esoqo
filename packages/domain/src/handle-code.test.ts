import { describe, it, expect } from 'vitest';
import {
  generateSystemHandle, generateHandleCandidates, isSystemHandleShape, HANDLE_DIGIT_LENGTH,
  HANDLE_CANDIDATE_COUNT, buildMnemonic, personHandleCandidates, orgHandleCandidates,
  mintHandle, randomHandleDigits, DIGITS_PER_MNEMONIC,
} from './handle-code';
import { isEsoqoIdShape, extractEsoqoId } from './pay-code';

describe('generateSystemHandle', () => {
  it('always ends with HANDLE_DIGIT_LENGTH digits', () => {
    const handle = generateSystemHandle(['John', 'Mutuku', 'Kamau']);
    const digits = handle.slice(-HANDLE_DIGIT_LENGTH);
    expect(digits).toMatch(/^[0-9]+$/);
    expect(digits).toHaveLength(HANDLE_DIGIT_LENGTH);
  });

  it('is lowercase and contains only letters and digits', () => {
    const handle = generateSystemHandle(['John', 'Mutuku', 'Kamau']);
    expect(handle).toMatch(/^[a-z0-9]+$/);
  });

  it('works with a single name', () => {
    const handle = generateSystemHandle(['Solo']);
    expect(handle).toMatch(/^[a-z]+[0-9]{3}$/);
  });

  it('throws when given no usable names', () => {
    expect(() => generateSystemHandle([])).toThrow();
    expect(() => generateSystemHandle(['', '   '])).toThrow();
  });

  it('never collides across a large sample (birthday-bound sanity check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateSystemHandle(['John', 'Mutuku', 'Kamau']));
    // Not a uniqueness guarantee (that's the DB's job) — just confirms
    // the generator isn't degenerately narrow.
    expect(seen.size).toBeGreaterThan(400);
  });

  it('never exceeds 11 characters — 8 for the name, 3 for the digits', () => {
    const names = ['Wanjiru', 'Nyambura', 'Wambui'];
    for (let i = 0; i < 200; i++) {
      expect(generateSystemHandle(names).length).toBeLessThanOrEqual(11);
    }
  });

  it('still respects the cap for very long legal names', () => {
    const handle = generateSystemHandle(['Nyambura', 'Wanjikuruthi']);
    expect(handle.length).toBeLessThanOrEqual(11);
  });
});

describe('generateHandleCandidates', () => {
  it('returns HANDLE_CANDIDATE_COUNT distinct, validly-shaped candidates', () => {
    const candidates = generateHandleCandidates(['John', 'Mutuku', 'Kamau']);
    expect(candidates).toHaveLength(HANDLE_CANDIDATE_COUNT);
    expect(new Set(candidates).size).toBe(HANDLE_CANDIDATE_COUNT);
    for (const c of candidates) expect(isSystemHandleShape(c)).toBe(true);
  });

  it('honours a smaller requested count', () => {
    expect(generateHandleCandidates(['Solo'], 1)).toHaveLength(1);
  });
});

describe('isSystemHandleShape', () => {
  it('accepts a generated handle', () => {
    expect(isSystemHandleShape(generateSystemHandle(['John', 'Mutuku', 'Kamau']))).toBe(true);
  });

  it('rejects the retired ESK- payment code', () => {
    expect(isSystemHandleShape('ESK-BCUP2K-KE')).toBe(false);
  });

  it('is case-insensitive but rejects punctuation', () => {
    expect(isSystemHandleShape('Mutuku482')).toBe(true);
    expect(isSystemHandleShape('mutuku-482')).toBe(false);
  });
});

describe('isEsoqoIdShape / extractEsoqoId', () => {
  it('accepts a handle and nothing else', () => {
    expect(isEsoqoIdShape('mutukuka482')).toBe(true);
    expect(isEsoqoIdShape('ESK-BCUP2K-KE')).toBe(false);
  });

  it('round-trips a bare handle through extractEsoqoId', () => {
    expect(extractEsoqoId('mutukuka482')).toBe('mutukuka482');
    expect(extractEsoqoId(' MUTUKUKA482 ')).toBe('mutukuka482');
  });

  it('round-trips a handle out of a pay link', () => {
    expect(extractEsoqoId('https://esoqo.com/pay?to=mutukuka482')).toBe('mutukuka482');
    expect(extractEsoqoId('https://esoqo.com/pay/mutukuka482')).toBe('mutukuka482');
  });
});

describe('buildMnemonic', () => {
  // The Go port pins the same budget arithmetic in handlecode_test.ts —
  // if the two disagree, a handle minted on one platform fails the
  // other's shape assumptions.
  it.each([
    ['john', 'mutuku', 'johnmutu'],
    ['solo', '', 'solo'],
    ['christopher', 'wanjiku', 'christwa'],
    ['mutukukimani', 'kamau', 'mutukuka'],
    ['john', 'doe', 'johndoe'],
    ['', 'kamau', 'kamau'],
  ])('buildMnemonic(%j, %j) === %j', (primary, secondary, want) => {
    expect(buildMnemonic(primary as string, secondary as string)).toBe(want);
  });

  it('never exceeds the 8-letter budget', () => {
    for (const [a, b] of [['john', 'mutuku'], ['christopher', 'wanjiku'], ['a', 'b']]) {
      expect(buildMnemonic(a as string, b as string).length).toBeLessThanOrEqual(8);
    }
  });
});

describe('personHandleCandidates', () => {
  it('offers the merged pair first, because it is the more identifying', () => {
    const got = personHandleCandidates(['John', 'Kamau']);
    expect(got[0]).toBe('johnkama');
    expect(got[1]).toBe('kamaujoh');
  });

  // The automatic mint used to pick its mnemonic at random on every
  // retry, so a saturated pair could burn the whole budget re-rolling
  // one name while the other ordering sat free.
  it('escalates instead of retrying one mnemonic blindly', () => {
    const got = personHandleCandidates(['John', 'Kamau']);
    expect(got).toEqual(expect.arrayContaining(['johnkama', 'kamaujoh', 'john', 'kamau']));
  });

  it('handles a single name', () => {
    expect(personHandleCandidates(['Solo'])).toEqual(['solo']);
  });

  it('de-duplicates names that clean to the same token', () => {
    expect(personHandleCandidates(['john', 'JOHN', 'Kamau'])[0]).toBe('johnkama');
  });

  it('keeps every candidate inside the shape bounds', () => {
    for (const m of personHandleCandidates(['Wanjiru', 'Nyambura', 'Wambui'])) {
      expect(m.length).toBeGreaterThanOrEqual(2);
      expect(m.length).toBeLessThanOrEqual(8);
    }
  });

  it.each([[[]], [['']], [['   ']], [['---']]])('produces nothing for %j', (names) => {
    expect(personHandleCandidates(names as string[])).toEqual([]);
  });
});

describe('orgHandleCandidates', () => {
  it.each([
    ['drops the swahili connector', 'Mchama wa Wananchi', '', 'mchama'],
    ['drops english articles', 'The Green Market', '', 'green'],
    ['keeps a known acronym intact rather than padding it', 'KCB 2024 Savings', '', 'kcb'],
    ['long lead stands alone', 'Baraka Farmers Cooperative Society', '', 'baraka'],
    ['case and spacing are irrelevant', '  mCHAMA   wa  wananchi ', '', 'mchama'],
    ['falls back to knownAs', '---', 'Chama Yetu', 'chama'],
    ['an all-stopword name still mints', 'Wa Wa Wa', '', 'wa'],
  ])('%s', (_label, officialName, knownAs, wantFirst) => {
    const got = orgHandleCandidates(officialName as string, knownAs as string);
    expect(got.length).toBeGreaterThan(0);
    expect(got[0]).toBe(wantFirst);
  });

  // A saturated generic lead has to be able to become more specific, or a
  // thousand "chama###" handles would exhaust.
  it('escalates past a generic lead', () => {
    const got = orgHandleCandidates('Chama wa Wananchi');
    expect(got[0]).toBe('chama');
    expect(got[1]).toBe('wananchi');
  });

  // The defect this design exists to prevent: the two-name merge clips a
  // secondary name to two letters, and "Wananchi"[:2] is "wa".
  it('does not lead with the mchamawa stopword leak', () => {
    expect(orgHandleCandidates('Mchama wa Wananchi')[0]).not.toBe('mchamawa');
  });

  it('produces nothing for an unusable name', () => {
    expect(orgHandleCandidates('')).toEqual([]);
    expect(orgHandleCandidates('   ')).toEqual([]);
    expect(orgHandleCandidates('', null)).toEqual([]);
    expect(orgHandleCandidates('!!!', '...')).toEqual([]);
  });
});

describe('mintHandle', () => {
  const candidates = ['chama', 'wananchi'];

  it('escalates through every candidate and then gives up', async () => {
    const tried: string[] = [];
    const [handle, ok] = await mintHandle(candidates, (c) => {
      tried.push(c);
      return false;
    });
    expect(ok).toBe(false);
    expect(handle).toBe('');
    expect(tried).toHaveLength(DIGITS_PER_MNEMONIC * candidates.length);
    expect(tried[0]!.startsWith('chama')).toBe(true);
    expect(tried[DIGITS_PER_MNEMONIC]!.startsWith('wananchi')).toBe(true);
  });

  it('stops as soon as one lands', async () => {
    let n = 0;
    const [handle, ok] = await mintHandle(candidates, () => (++n === 3));
    expect(ok).toBe(true);
    expect(n).toBe(3);
    expect(isSystemHandleShape(handle)).toBe(true);
  });

  it('awaits an async done callback', async () => {
    const [handle, ok] = await mintHandle(candidates, async () => true);
    expect(ok).toBe(true);
    expect(isSystemHandleShape(handle)).toBe(true);
  });

  it('does nothing when there are no candidates', async () => {
    const [handle, ok] = await mintHandle([], () => {
      throw new Error('must not be called');
    });
    expect([handle, ok]).toEqual(['', false]);
  });
});

describe('randomHandleDigits', () => {
  it('is always HANDLE_DIGIT_LENGTH digits', () => {
    for (let i = 0; i < 500; i++) {
      expect(randomHandleDigits()).toMatch(/^[0-9]{3}$/);
    }
  });
});
